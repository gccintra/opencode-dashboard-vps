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
import type { WorkerTransport } from './transport';
import type { ClientMessage, ServerMessage } from '../../../pty-worker/src/protocol';

const SHUTDOWN_GRACE_MS = 2000;

type ReadableByteStream = ReadableStream<Uint8Array>;
type WritableByteSink = Bun.FileSink;

export class BunWorkerTransport implements WorkerTransport {
  private proc: Bun.Subprocess | null = null;
  private messageCb: ((msg: ServerMessage) => void) | null = null;
  private exitCb: ((code: number | null) => void) | null = null;
  private buf = '';
  private started = false;

  start(): void {
    if (this.started) return;

    // Resolve the pty-worker from the project root (process.cwd()), which PM2
    // sets via the ecosystem cwd field. This works in both dev (--watch, source
    // files) and prod (bundled dist) modes, unlike import.meta.url-relative
    // paths that differ between the two layouts.
    const workerDir = resolve(process.cwd(), 'apps/pty-worker');
    const workerSrc = resolve(workerDir, 'src/index.ts');
    const tsxBin = resolve(workerDir, 'node_modules/.bin/tsx');

    // Node 18 LTS is REQUIRED for node-pty ABI compatibility (§3, §10).
    // /usr/bin/nodejs is v18.19.1 on Ubuntu 24.04 (apt package).
    const nodeBin = process.env.PTY_NODE_BIN || '/usr/bin/nodejs';

    this.proc = Bun.spawn([nodeBin, tsxBin, workerSrc], {
      cwd: workerDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    this.started = true;

    // Stream worker stderr → server stderr (prefixed for clarity).
    this.pipeStderrToServer(this.proc);

    // Stream worker stdout → JSON line parser.
    void this.readStdoutLoop();

    // Surface worker exit to the manager.
    void this.proc.exited
      .then((code) => {
        if (this.exitCb) this.exitCb(code);
      })
      .catch((err) => {
        console.error('[pty-manager] worker exit promise rejected:', err);
        if (this.exitCb) this.exitCb(null);
      });
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

  private async readStdoutLoop(): Promise<void> {
    if (!this.proc) return;
    const decoder = new TextDecoder();
    const stdout = this.proc.stdout as ReadableByteStream;
    const reader = stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        this.buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = this.buf.indexOf('\n')) !== -1) {
          const line = this.buf.slice(0, nl);
          this.buf = this.buf.slice(nl + 1);
          if (!line.trim() || !this.messageCb) continue;
          try {
            this.messageCb(JSON.parse(line));
          } catch (err) {
            console.error('[pty-manager] invalid JSON from worker:', line, err);
          }
        }
      }
    } catch (err) {
      console.error('[pty-manager] worker stdout read error:', err);
    } finally {
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
