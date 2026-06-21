/**
 * ControlWorkerTransport — tmux control-mode (`tmux -C`) transport for the PTY
 * Manager. A drop-in alternative to {@link BunWorkerTransport} that REMOVES
 * node-pty (and the separate Node 18 worker, pty-sighup-exec, and the CPU
 * spin-monitor) from the data path entirely.
 *
 * ─── Why ────────────────────────────────────────────────────────────────────
 * node-pty 1.1.0 has a Linux bug: when a PTY master fd hangs up it fails to
 * close it and libuv busy-loops on `read()=EAGAIN` at 100% CPU. After the tmux
 * migration the inner process (claude/opencode) runs inside the tmux daemon's
 * PTY; node-pty only ever gave a tty to the thin `tmux attach` CLIENT — and
 * that client's PTY is the only thing that wedges.
 *
 * `tmux -C` (control mode, what iTerm2 uses) drives a session over STDIN/STDOUT
 * pipes with NO PTY. No PTY → no node-pty → the entire wedge class is gone.
 * Validated by the PoC (docs/poc-control-mode-findings.md): byte-exact decode,
 * sub-ms echo latency, no fd leak, ~0 idle/flood CPU.
 *
 * ─── How it slots in ────────────────────────────────────────────────────────
 * It implements the SAME {@link WorkerTransport} interface the manager already
 * speaks, so {@link PtyManager}, the WS handler, REST routes, the status
 * detector, reconcile and reattach logic are all UNCHANGED. The manager still
 * sends `spawn/write/resize/kill/list` ClientMessages and receives
 * `spawned/data/exit/killed/list` ServerMessages — this transport just fulfils
 * them with control clients instead of a node-pty worker.
 *
 * One {@link ControlClient} (one `tmux -C` process) per session. tmux admin
 * commands (kill-session/has-session/list-sessions) still run via `tmux.ts`
 * `execFile` on the SAME default socket, so reconcile/kill see these sessions.
 *
 * ─── Protocol translation ───────────────────────────────────────────────────
 *  spawn  → Bun.spawn(['tmux','-C', ...buildTmuxSpawnArgs() minus leading 'tmux'])
 *  write  → `send-keys -t <pane> -H <hex>` (UTF-8 bytes of the data string)
 *  resize → `refresh-client -C <cols>x<rows>`
 *  kill   → dispose the control client; emit `killed` (tmux kill-session is run
 *           separately by the route layer, exactly as with node-pty)
 *  %output (pane → us) → `data` (base64 of the raw decoded bytes)
 *  %exit / process exit → `exit`
 */

import type { WorkerTransport } from './transport';
import type { ClientMessage, ServerMessage } from '../../../pty-worker/src/protocol';

const LF = 0x0a;
const BACKSLASH = 0x5c;
const PERCENT = 0x25;
const SPACE = 0x20;
/** Cap bytes per `send-keys -H` command so a huge paste can't overrun the tmux command-line limit. */
const SEND_KEYS_CHUNK = 1024;

const ASCII = new TextDecoder(); // parse the ASCII `%` control prefixes (utf-8 safe for these)

/**
 * Un-escape a tmux control-mode `%output` payload (operates on BYTES, not a JS
 * string, so UTF-8 / raw bytes survive). tmux escapes via vis(3) with
 * VIS_OCTAL: control / non-graph bytes become `\NNN` (3 octal digits) and a
 * literal backslash becomes `\\`. Everything else passes through literally.
 */
export function unescapeOutput(buf: Uint8Array, start = 0): Uint8Array {
  const out: number[] = [];
  for (let i = start; i < buf.length; i++) {
    const b = buf[i];
    if (b !== BACKSLASH) {
      out.push(b);
      continue;
    }
    const n = buf[i + 1];
    if (n === BACKSLASH) {
      out.push(BACKSLASH);
      i += 1;
    } else if (n >= 0x30 && n <= 0x37) {
      const o1 = buf[i + 1] - 0x30;
      const o2 = buf[i + 2] - 0x30;
      const o3 = buf[i + 3] - 0x30;
      out.push(((o1 << 6) | (o2 << 3) | o3) & 0xff);
      i += 3;
    } else {
      out.push(BACKSLASH);
    }
  }
  return Uint8Array.from(out);
}

/** Space-separated lowercase hex for `send-keys -H`. */
export function toSendKeysHex(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i++) {
    if (i) s += ' ';
    s += data[i].toString(16).padStart(2, '0');
  }
  return s;
}

interface ControlEvents {
  onSpawned: (pid: number) => void;
  onData: (raw: Uint8Array) => void;
  onExit: (code: number) => void;
  onError: (message: string) => void;
}

/**
 * One `tmux -C` control client = one session. Holds the stdin FileSink, parses
 * the `%` line protocol off stdout, and exposes write/resize/dispose.
 */
export class ControlClient {
  private proc: import('bun').Subprocess<'pipe', 'pipe', 'pipe'> | null = null;
  private writer: import('bun').FileSink | null = null;
  paneId: string | null = null;
  private carry = new Uint8Array(0);
  private readonly enc = new TextEncoder();
  /** Writes that arrive before the pane id is known are queued and flushed once it is. */
  private pendingInput: Uint8Array[] = [];
  private exited = false;

  constructor(
    readonly id: string,
    private readonly ev: ControlEvents,
  ) {}

  /**
   * @param tmuxArgs the args produced by buildTmuxSpawnArgs — i.e. starting with
   *                 the literal `'tmux'`, then `-f <conf> new-session -A …`.
   * @param cwd      working directory for the control client. tmux `new-session`
   *                 (no `-c`) uses the CLIENT's cwd as the session's start
   *                 directory, so this must be the project dir — otherwise the
   *                 session inherits the server process's cwd (e.g. apps/server).
   */
  spawn(tmuxArgs: string[], cwd?: string): void {
    if (tmuxArgs[0] !== 'tmux') {
      this.ev.onError(`control transport requires a tmux spawn (got: ${tmuxArgs[0]})`);
      return;
    }
    // Insert `-C` as a global client flag (before the `new-session` command).
    const argv = ['tmux', '-C', ...tmuxArgs.slice(1)];
    const proc = Bun.spawn(argv, { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    this.proc = proc;
    this.writer = proc.stdin;
    this.pumpStdout();
    this.pumpStderr();
    proc.exited.then((code) => this.handleProcExit(code ?? 0));
    // pid is available synchronously — ack the spawn immediately (mirrors the
    // node-pty worker returning the attach client's pid).
    this.ev.onSpawned(proc.pid);
  }

  private async pumpStdout(): Promise<void> {
    const reader = (this.proc!.stdout as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.feed(value);
      }
    } catch (err) {
      this.ev.onError(`stdout read error: ${(err as Error).message}`);
    }
  }

  private async pumpStderr(): Promise<void> {
    const reader = (this.proc!.stderr as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.ev.onError(`stderr: ${ASCII.decode(value).trim()}`);
      }
    } catch {
      /* stderr closed — ignore */
    }
  }

  /** Accumulate bytes, split on LF, dispatch each complete control line. */
  private feed(chunk: Uint8Array): void {
    let data: Uint8Array;
    if (this.carry.length) {
      data = new Uint8Array(this.carry.length + chunk.length);
      data.set(this.carry, 0);
      data.set(chunk, this.carry.length);
    } else {
      data = chunk;
    }
    let start = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === LF) {
        this.line(data.subarray(start, i)); // line excludes the LF
        start = i + 1;
      }
    }
    this.carry = start < data.length ? data.slice(start) : new Uint8Array(0);
  }

  private line(line: Uint8Array): void {
    // Non-`%` lines are command-reply body (%begin..%end) — ignored in this PoC-
    // derived transport (we send no commands that need their replies parsed).
    if (line.length === 0 || line[0] !== PERCENT) return;

    let sp = 0;
    while (sp < line.length && line[sp] !== SPACE) sp++;
    const verb = ASCII.decode(line.subarray(0, sp));

    if (verb === '%output') {
      // %output %<paneId> <escaped data>
      const i = sp + 1;
      let j = i;
      while (j < line.length && line[j] !== SPACE) j++;
      if (!this.paneId) {
        this.paneId = ASCII.decode(line.subarray(i, j));
        this.flushPendingInput();
      }
      this.ev.onData(unescapeOutput(line, j + 1));
      return;
    }
    if (verb === '%exit') {
      this.handleProcExit(0);
      return;
    }
    if (verb === '%error') {
      this.ev.onError(ASCII.decode(line).trim());
      return;
    }
    // %begin/%end/%layout-change/%window-add/%session-changed/... — ignored.
  }

  private send(cmd: string): void {
    if (!this.writer) return;
    try {
      this.writer.write(this.enc.encode(cmd.endsWith('\n') ? cmd : cmd + '\n'));
      this.writer.flush();
    } catch (err) {
      this.ev.onError(`stdin write failed: ${(err as Error).message}`);
    }
  }

  private flushPendingInput(): void {
    const queued = this.pendingInput;
    this.pendingInput = [];
    for (const data of queued) this.write(data);
  }

  write(data: Uint8Array): void {
    if (data.length === 0) return;
    if (!this.paneId) {
      this.pendingInput.push(data);
      return;
    }
    // Chunk so a large paste never overruns tmux's command-line length limit.
    for (let off = 0; off < data.length; off += SEND_KEYS_CHUNK) {
      const slice = data.subarray(off, off + SEND_KEYS_CHUNK);
      this.send(`send-keys -t ${this.paneId} -H ${toSendKeysHex(slice)}`);
    }
  }

  resize(cols: number, rows: number): void {
    // refresh-client -C sets the control client's viewport; tmux reflows the
    // pane to match (the conf has window-size latest + aggressive-resize).
    this.send(`refresh-client -C ${cols}x${rows}`);
  }

  private handleProcExit(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.ev.onExit(code);
  }

  /** Tear down the control client process. Does NOT kill the tmux session. */
  dispose(): void {
    this.exited = true; // suppress the exit event for an intentional teardown
    try {
      this.proc?.kill();
    } catch {
      /* already gone */
    }
    this.proc = null;
    this.writer = null;
  }

  pid(): number | undefined {
    return this.proc?.pid;
  }
}

export class ControlWorkerTransport implements WorkerTransport {
  private readonly clients = new Map<string, ControlClient>();
  private messageCb: ((msg: ServerMessage) => void) | null = null;
  private started = false;

  start(): void {
    this.started = true;
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.messageCb = cb;
  }

  // No single worker process to lose, so this never fires. The manager's
  // worker-lost reattach path is therefore inert under control mode; a server
  // restart is instead recovered by boot reconcile (re-adopts live tmux
  // sessions). Individual session exits arrive as `exit` messages.
  onExit(_cb: (code: number | null) => void): void {
    /* intentionally unused */
  }

  // Nothing global to restart — there is no shared worker. A wedged control
  // client cannot happen (no PTY), and a per-session failure surfaces as that
  // session's `exit`. No-op keeps the manager's self-heal path harmless.
  restart(): void {
    /* no-op */
  }

  send(msg: ClientMessage): void {
    switch (msg.type) {
      case 'spawn':
        this.handleSpawn(msg.id, msg.command, msg.args ?? [], msg.cwd);
        break;
      case 'write': {
        this.clients.get(msg.id)?.write(new TextEncoder().encode(msg.data));
        break;
      }
      case 'resize': {
        this.clients.get(msg.id)?.resize(msg.cols, msg.rows);
        break;
      }
      case 'kill': {
        this.clients.get(msg.id)?.dispose();
        this.clients.delete(msg.id);
        // Always ack so the manager's pending kill resolves, even if the
        // control client had already exited (e.g. tmux kill-session ran first).
        this.emit({ type: 'killed', id: msg.id });
        break;
      }
      case 'list':
        this.emit({ type: 'list', sessions: [...this.clients.keys()] });
        break;
      case 'shutdown':
        for (const c of this.clients.values()) c.dispose();
        this.clients.clear();
        break;
    }
  }

  async shutdown(): Promise<void> {
    for (const c of this.clients.values()) c.dispose();
    this.clients.clear();
    this.started = false;
  }

  // ── Internals ──────────────────────────────────────────────────────

  private handleSpawn(id: string, command: string, args: string[], cwd?: string): void {
    // node-pty path runs `pty-sighup-exec tmux …`; the tmux invocation we need
    // is in `args` (built by buildTmuxSpawnArgs, starting with 'tmux'). If for
    // some reason the spawn isn't tmux-based, surface an error to the manager.
    if (args[0] !== 'tmux') {
      this.emit({ type: 'error', id, message: `control transport needs a tmux spawn (command=${command})` });
      return;
    }
    // Replace any existing client for this id (reattach reuses the same id).
    this.clients.get(id)?.dispose();

    const client = new ControlClient(id, {
      onSpawned: (pid) => this.emit({ type: 'spawned', id, pid }),
      onData: (raw) =>
        this.emit({ type: 'data', id, chunk: Buffer.from(raw).toString('base64'), encoding: 'base64' }),
      onExit: (code) => {
        this.clients.delete(id);
        this.emit({ type: 'exit', id, code });
      },
      onError: (message) => {
        // Render errors are logged, not fatal; only spawn-time failures need to
        // reject the pending spawn (handled by the manager's onError → it only
        // rejects if a spawn is pending). Forward as an id-scoped error.
        console.error(`[control:${id}] ${message}`);
      },
    });
    this.clients.set(id, client);
    client.spawn(args, cwd);
  }

  private emit(msg: ServerMessage): void {
    this.messageCb?.(msg);
  }
}
