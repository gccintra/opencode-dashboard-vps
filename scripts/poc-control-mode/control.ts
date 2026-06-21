// PoC: tmux control-mode (-C) transport. Throwaway — validates the approach in
// docs/plan-tmux-control-mode.md before wiring into apps/server.
//
// A `tmux -C` client speaks a line protocol on stdin/stdout (NO PTY). This
// module spawns one control client per session, parses the line protocol, and
// exposes spawn/write/resize/kill + an onData callback of RAW decoded bytes.

import { spawn, type Subprocess } from "bun";

const LF = 0x0a;
const BACKSLASH = 0x5c;

/**
 * Un-escape a tmux control-mode `%output` payload (operates on bytes, not a JS
 * string, so UTF-8 / raw bytes survive).
 *
 * tmux escapes via vis(3) with VIS_OCTAL: control / non-graph bytes become
 * `\NNN` (3 octal digits) and a literal backslash becomes `\\`. Everything else
 * is passed through literally.
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
      // \NNN octal escape
      const o1 = buf[i + 1] - 0x30;
      const o2 = buf[i + 2] - 0x30;
      const o3 = buf[i + 3] - 0x30;
      out.push(((o1 << 6) | (o2 << 3) | o3) & 0xff);
      i += 3;
    } else {
      // lone backslash (shouldn't happen from tmux, but be safe)
      out.push(BACKSLASH);
    }
  }
  return Uint8Array.from(out);
}

/** Hex-encode raw input bytes for `send-keys -H` (space-separated hex). */
export function toSendKeysHex(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i++) {
    if (i) s += " ";
    s += data[i].toString(16).padStart(2, "0");
  }
  return s;
}

const ASCII = new TextDecoder("latin1"); // for parsing the % control prefixes

export interface ControlEvents {
  onData?: (raw: Uint8Array) => void;
  onExit?: (reason: string) => void;
  onPane?: (paneId: string) => void;
  onLog?: (line: string) => void;
}

export class TmuxControlSession {
  proc?: Subprocess<"pipe", "pipe", "pipe">;
  paneId?: string; // e.g. "%0"
  private writer?: import("bun").FileSink; // Bun stdin:"pipe" yields a FileSink
  private enc = new TextEncoder();
  private carry = new Uint8Array(0);

  constructor(
    private readonly name: string,
    private readonly conf: string,
    private readonly ev: ControlEvents = {},
    // Dedicated socket so the PoC never touches the real `default` socket (which
    // may host a wedged production server). Mirrors how a real deploy would
    // isolate, and keeps soak/kill safe.
    private readonly socket: string = "alf_poc",
  ) {}

  spawn(cols: number, rows: number, innerCmd: string, env: Record<string, string> = {}) {
    const args = [
      "-L", this.socket,
      "-f", this.conf,
      "-C",
      "new-session", "-A",
      "-s", this.name,
      "-x", String(cols),
      "-y", String(rows),
    ];
    for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
    args.push(innerCmd);

    this.ev.onLog?.(`spawn: tmux ${args.join(" ")}`);
    this.proc = spawn(["tmux", ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.writer = this.proc.stdin;
    this.pump();
    this.pumpStderr();
    this.proc.exited.then((code) => this.ev.onExit?.(`process exited code=${code}`));
  }

  private async pump() {
    const reader = (this.proc!.stdout as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) this.feed(value);
    }
  }

  private async pumpStderr() {
    const reader = (this.proc!.stderr as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) this.ev.onLog?.(`stderr: ${ASCII.decode(value).trim()}`);
    }
  }

  /** Accumulate bytes, split on LF, dispatch each complete line. */
  private feed(chunk: Uint8Array) {
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

  private line(line: Uint8Array) {
    // A control line either starts with '%' (notification/output) or is part of
    // a %begin..%end command-reply block (which we mostly ignore in the PoC).
    if (line.length === 0 || line[0] !== 0x25 /* % */) return;

    // Peek the verb (up to first space) as ASCII.
    let sp = 0;
    while (sp < line.length && line[sp] !== 0x20) sp++;
    const verb = ASCII.decode(line.subarray(0, sp));

    if (verb === "%output") {
      // %output %<paneId> <escaped data>
      let i = sp + 1; // after the space
      // paneId token
      let j = i;
      while (j < line.length && line[j] !== 0x20) j++;
      const pane = ASCII.decode(line.subarray(i, j));
      if (!this.paneId) {
        this.paneId = pane;
        this.ev.onPane?.(pane);
      }
      const raw = unescapeOutput(line, j + 1);
      this.ev.onData?.(raw);
      return;
    }
    if (verb === "%exit") {
      this.ev.onExit?.(ASCII.decode(line).trim());
      return;
    }
    if (verb === "%error") {
      this.ev.onLog?.(ASCII.decode(line).trim());
      return;
    }
    // %begin/%end/%layout-change/%window-add/%session-changed/... — log only.
    this.ev.onLog?.(ASCII.decode(line).trim());
  }

  private send(cmd: string) {
    if (!this.writer) return;
    this.writer.write(this.enc.encode(cmd.endsWith("\n") ? cmd : cmd + "\n"));
    this.writer.flush();
  }

  write(data: Uint8Array) {
    if (!this.paneId || data.length === 0) return;
    this.send(`send-keys -t ${this.paneId} -H ${toSendKeysHex(data)}`);
  }

  resize(cols: number, rows: number) {
    this.send(`refresh-client -C ${cols}x${rows}`);
  }

  async kill() {
    // Admin path (mirrors the real app): run `kill-session` as a SEPARATE tmux
    // command on the same socket, not through the control client's stdin — a
    // SIGTERM to the control client only detaches it, leaving the session alive.
    try {
      await spawn(["tmux", "-L", this.socket, "kill-session", "-t", this.name]).exited;
    } catch {}
    this.proc?.kill();
  }

  pid() {
    return this.proc?.pid;
  }
}
