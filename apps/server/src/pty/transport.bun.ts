/**
 * BunWorkerTransport — production transport for the PTY Manager.
 *
 * Spawns the pty-worker as a Bun subprocess using Node 18 LTS explicitly
 * (`/usr/bin/nodejs`) to avoid the Node 22 ABI mismatch with node-pty's
 * prebuilt binary (§3, §10). The worker's tsx runner is resolved from
 * its own `node_modules/.bin/tsx`.
 *
 * Worker location: resolved relative to this file (apps/server/src/pty/)
 * to the sibling apps/pty-worker workspace. We `cwd` the spawned process
 * to the worker's own directory so node-pty can be required correctly.
 *
 * Error policy:
 *   - Invalid JSON from the worker is logged and skipped (not fatal).
 *   - Worker stdout read errors are logged and the read loop exits
 *     cleanly. The worker's `exited` promise resolves separately and
 *     triggers `onExit` — the manager will treat that as a crash.
 *   - Worker stderr is forwarded to the server's stderr for visibility.
 *   - `shutdown()` sends `{type:'shutdown'}` and waits up to 2s for the
 *     worker to exit before force-killing the process.
 *
 * Note on type assertions:
 *   `Bun.Subprocess.{stdin,stdout,stderr}` are typed as
 *   `number | FileSink/ReadableStream | undefined` because passing a
 *   numeric fd produces a number. Since we always pass `'pipe'`, the
 *   values are guaranteed to be streams, but TypeScript can't narrow
 *   that. We assert the stream types once at the call site.
 */

import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import type { WorkerTransport } from './transport';
import type { ClientMessage, ServerMessage } from '../../../pty-worker/src/protocol';

const PORT = parseInt(process.env.SERVER_PORT || '3001', 10);
const WORKER_PID_FILE = `/tmp/pty-worker-${PORT}.pid`;

function killPreviousWorker(): void {
  try {
    const pid = parseInt(readFileSync(WORKER_PID_FILE, 'utf8').trim(), 10);
    if (pid && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already dead */
      }
    }
  } catch {
    /* no pid file */
  }
  try {
    unlinkSync(WORKER_PID_FILE);
  } catch {
    /* ok */
  }
}

function writeWorkerPid(pid: number): void {
  try {
    writeFileSync(WORKER_PID_FILE, String(pid));
  } catch {
    /* non-fatal */
  }
}

/** Resolve Node 18 binary. Prefers PTY_NODE_BIN env var, then tries common paths. */
function resolveNodeBin(): string {
  if (process.env.PTY_NODE_BIN) return process.env.PTY_NODE_BIN;
  // Ubuntu/Debian: nodejs = system Node (v18), node may be nvm/n override.
  // Check both so the right v18 ABI binary is used regardless of distro.
  for (const p of ['/usr/bin/nodejs', '/usr/bin/node', '/usr/local/bin/node']) {
    if (existsSync(p)) return p;
  }
  return 'node'; // last resort: PATH lookup
}

const SHUTDOWN_GRACE_MS = 2000;

type ReadableByteStream = ReadableStream<Uint8Array>;
type WritableByteSink = Bun.FileSink;

/** USER_HZ — clock ticks per second for /proc/<pid>/stat utime/stime. Always 100 on Linux. */
const USER_HZ = 100;

/**
 * Read a process's cumulative CPU time (utime + stime, all threads) from
 * /proc/<pid>/stat, in clock ticks. Returns null if unreadable. The `comm`
 * field (index 2) can contain spaces and parens, so we slice after the LAST
 * ')' and index the remaining whitespace-separated fields: rest[0] = state
 * (field 3), so utime (field 14) = rest[11] and stime (field 15) = rest[12].
 */
function readProcCpuTicks(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const utime = parseInt(afterComm[11], 10);
    const stime = parseInt(afterComm[12], 10);
    if (Number.isNaN(utime) || Number.isNaN(stime)) return null;
    return utime + stime;
  } catch {
    return null;
  }
}

export class BunWorkerTransport implements WorkerTransport {
  private proc: Bun.Subprocess | null = null;
  private messageCb: ((msg: ServerMessage) => void) | null = null;
  private exitCb: ((code: number | null) => void) | null = null;
  private buf = '';
  private started = false;
  /** Output bytes received from the worker since the last CPU-monitor sample. */
  private bytesSinceSample = 0;
  /** Server-side CPU-spin monitor (see {@link startCpuMonitor}). */
  private cpuMonitor: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.started) return;

    // Kill any leftover worker from a previous hot-reload or crash.
    killPreviousWorker();

    // Resolve the pty-worker relative to the project root. PM2 sets cwd to
    // the project root, but dev runs from apps/server/ — fall back two levels.
    let workerDir = resolve(process.cwd(), 'apps/pty-worker');
    if (!existsSync(workerDir)) {
      workerDir = resolve(process.cwd(), '../../apps/pty-worker');
    }
    const workerSrc = resolve(workerDir, 'src/index.ts');
    const tsxBin = resolve(workerDir, 'node_modules/.bin/tsx');

    // Node 18 LTS is REQUIRED for node-pty ABI compatibility (§3, §10).
    const nodeBin = resolveNodeBin();

    // Capture the spawned process in a local so async handlers (stdout loop,
    // stderr pipe, exited) can detect when they have been superseded by a
    // restart() and bail out instead of clobbering the newer worker's state.
    const proc = Bun.spawn([nodeBin, tsxBin, workerSrc], {
      cwd: workerDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    this.proc = proc;

    writeWorkerPid(proc.pid);
    this.started = true;
    this.buf = '';
    console.error(`[pty-transport] worker started pid=${proc.pid}`);

    // Protect worker from OOM killer — it holds all live PTY state.
    try {
      writeFileSync(`/proc/${proc.pid}/oom_score_adj`, '-1000');
    } catch {
      // Non-fatal: might lack permissions in some environments.
    }

    // Stream worker stderr → server stderr (prefixed for clarity).
    this.pipeStderrToServer(proc);

    // Stream worker stdout → JSON line parser.
    void this.readStdoutLoop(proc);

    // Watch for the node-pty CPU busy-loop from OUTSIDE the worker. The
    // worker's own JS watchdog cannot fire once libuv spins in a tight C read()
    // loop (timers and SIGTERM are both starved), so the Bun server — whose
    // event loop is unaffected — force-kills the wedged worker with SIGKILL.
    this.startCpuMonitor(proc);

    // Surface worker exit to the manager. Reset state so start() can
    // respawn the worker when ensureStarted() is called on next request.
    void this.proc.exited
      .then((code) => {
        this.handleProcExit(proc, code);
      })
      .catch((err) => {
        console.error('[pty-manager] worker exit promise rejected:', err);
        this.handleProcExit(proc, null);
      });
  }

  /**
   * Tear down the current worker and spawn a fresh one, preserving the
   * registered callbacks. Self-heal path for a wedged worker (e.g. a dead
   * stdout read loop) — without this, every request would time out forever
   * until someone manually restarted the worker process.
   */
  restart(): void {
    console.error('[pty-transport] worker RESTART requested (self-heal)');
    const old = this.proc;
    this.proc = null;
    this.started = false;
    this.buf = '';
    if (old) {
      // Force-kill the (possibly wedged) old worker. Its `exited` handler is
      // guarded by handleProcExit's identity check, so it won't clobber the
      // fresh worker we spawn below.
      try {
        void old.kill();
      } catch {
        /* already dead */
      }
    }
    this.start();
  }

  /**
   * Server-side CPU-spin watchdog. Samples the worker's /proc CPU time every
   * few seconds; if it pegs ~a full core while emitting almost no output (the
   * node-pty hung-up-fd busy-loop signature — the worker only marshals IPC and
   * never legitimately pegs a core), the worker is SIGKILLed. SIGKILL cannot be
   * ignored even by a process spinning in a C syscall loop, and the normal exit
   * path (`exited` → handleProcExit → exitCb → manager worker-lost handler) then
   * reattaches every tmux session onto a fresh worker with no data loss.
   *
   * This lives in the Bun server, NOT the worker: a fully pegged libuv loop in
   * the worker can't run its own JS watchdog timer.
   */
  private startCpuMonitor(proc: Bun.Subprocess): void {
    this.stopCpuMonitor();
    const pid = proc.pid;
    const SAMPLE_MS = 3000;
    const CPU_THRESHOLD = 0.9; // fraction of one core
    const MAX_BYTES = 256 * 1024; // output above this = real work, not a spin
    const STRIKES_TO_KILL = 2; // ~6s sustained
    const GRACE_MS = 10_000; // ignore the startup window

    const startedAt = Date.now();
    let lastTicks = readProcCpuTicks(pid);
    let lastTs = Date.now();
    let strikes = 0;
    this.bytesSinceSample = 0;

    this.cpuMonitor = setInterval(() => {
      // Stop if this worker was superseded.
      if (this.proc !== proc) {
        this.stopCpuMonitor();
        return;
      }
      const ticks = readProcCpuTicks(pid);
      const ts = Date.now();
      const bytes = this.bytesSinceSample;
      this.bytesSinceSample = 0;
      const elapsedMs = ts - lastTs;
      const prevTicks = lastTicks;
      lastTicks = ticks;
      lastTs = ts;

      if (ticks === null || prevTicks === null || elapsedMs <= 0) return;
      if (ts - startedAt < GRACE_MS) return;

      const cpuFrac = (ticks - prevTicks) / USER_HZ / (elapsedMs / 1000);
      if (cpuFrac > CPU_THRESHOLD && bytes < MAX_BYTES) {
        strikes += 1;
        console.error(
          `[pty-transport] worker hot+quiet ${strikes}/${STRIKES_TO_KILL} ` +
            `cpu=${(cpuFrac * 100).toFixed(0)}% bytes=${bytes} pid=${pid}`,
        );
        if (strikes >= STRIKES_TO_KILL) {
          console.error(
            `[pty-transport] worker wedged (CPU spin, no output) — SIGKILL pid=${pid}; ` +
              'tmux sessions survive and will be reattached',
          );
          this.stopCpuMonitor();
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* already dead */
          }
          // Do NOT respawn here: the `exited` promise → handleProcExit → exitCb
          // → manager worker-lost handler drives the lossless reattach, which
          // calls ensureStarted() and spawns a fresh worker.
        }
      } else {
        strikes = 0;
      }
    }, SAMPLE_MS);
    this.cpuMonitor.unref?.();
  }

  private stopCpuMonitor(): void {
    if (this.cpuMonitor !== null) {
      clearInterval(this.cpuMonitor);
      this.cpuMonitor = null;
    }
  }

  /**
   * Handle a worker process exit. Guarded by an identity check so a stale
   * exit (from a worker superseded by restart()) is ignored and never resets
   * the live worker's state.
   */
  private handleProcExit(proc: Bun.Subprocess, code: number | null): void {
    if (this.proc !== null && this.proc !== proc) {
      console.error(`[pty-transport] ignoring stale exit from superseded worker pid=${proc.pid}`);
      return;
    }
    this.stopCpuMonitor();
    console.error(`[pty-transport] worker exited code=${code} pid=${proc.pid}`);
    try {
      unlinkSync(WORKER_PID_FILE);
    } catch {
      /* ok */
    }
    this.proc = null;
    this.started = false;
    this.buf = '';
    if (this.exitCb) this.exitCb(code);
  }

  send(msg: ClientMessage): void {
    if (!this.proc) {
      throw new Error('[BunWorkerTransport] transport not started');
    }
    const line = JSON.stringify(msg) + '\n';
    // We passed 'pipe' for stdin, so this is always a FileSink.
    const stdin = this.proc.stdin as WritableByteSink;
    // Bun's FileSink.write returns `number | Promise<number>` depending on
    // backpressure. Wrap in Promise.resolve so .catch always works.
    Promise.resolve(stdin.write(line)).catch((err: unknown) => {
      console.error('[pty-manager] failed to write to worker stdin:', err);
    });
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.messageCb = cb;
  }

  onExit(cb: (code: number | null) => void): void {
    this.exitCb = cb;
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return;
    this.stopCpuMonitor();
    const proc = this.proc;
    this.proc = null;
    this.started = false;

    // Ask the worker to shut down cleanly. If its stdin is already closed
    // (e.g. crash recovery), this throws and we fall through to kill.
    try {
      const stdin = proc.stdin as WritableByteSink | undefined;
      if (stdin) {
        stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n');
      }
    } catch {
      // ignore — we're about to force-kill anyway
    }

    // Wait for graceful exit, then force-kill as a fallback.
    try {
      await Promise.race([
        proc.exited,
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
      ]);
    } catch {
      // ignore
    }

    try {
      await proc.kill();
    } catch {
      // process may already be dead
    }
  }

  // ── Internals ───────────────────────────────────────────────────

  private async readStdoutLoop(proc: Bun.Subprocess): Promise<void> {
    const decoder = new TextDecoder();
    const stdout = proc.stdout as ReadableByteStream;
    const reader = stdout.getReader();
    let lineCount = 0;
    let crashed = false;
    console.error('[pty-transport] readStdoutLoop STARTED');
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.error('[pty-transport] readStdoutLoop DONE (stream ended)');
          return;
        }
        // Drop output from a worker that has been superseded by restart().
        if (this.proc !== proc) {
          console.error('[pty-transport] readStdoutLoop superseded, exiting');
          return;
        }
        this.bytesSinceSample += value.byteLength;
        this.buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = this.buf.indexOf('\n')) !== -1) {
          const line = this.buf.slice(0, nl);
          this.buf = this.buf.slice(nl + 1);
          lineCount++;
          if (!line.trim() || !this.messageCb) continue;
          try {
            this.messageCb(JSON.parse(line));
          } catch (err) {
            console.error('[pty-manager] invalid JSON from worker:', line, err);
          }
        }
      }
    } catch (err) {
      // The read loop died while the worker is (probably) still alive. Without
      // recovery this silently wedges the transport: the worker keeps running,
      // `started` stays true, so every future spawn/kill times out forever and
      // only a manual worker restart recovers. Force-kill the worker so its
      // `exited` handler fires and the standard exit → respawn path runs.
      crashed = true;
      console.error(
        '[pty-manager] worker stdout read error (LOOP DEAD), killing worker to recover:',
        err,
      );
      if (this.proc === proc) {
        try {
          void proc.kill();
        } catch {
          /* already dead */
        }
      }
    } finally {
      console.error(
        `[pty-transport] readStdoutLoop EXITED linesProcessed=${lineCount} crashed=${crashed}`,
      );
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
  }

  private pipeStderrToServer(proc: Bun.Subprocess): void {
    const decoder = new TextDecoder();
    const stderr = proc.stderr as ReadableByteStream;
    void (async () => {
      const reader = stderr.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          const text = decoder.decode(value, { stream: true });
          // Use process.stderr to bypass any captured console and ensure
          // the output reaches the server's actual stderr stream.
          process.stderr.write(`[pty-worker] ${text}`);
        }
      } catch {
        // worker stderr closed; nothing to do
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // already released
        }
      }
    })();
  }
}
