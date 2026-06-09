/**
 * node-pty + Bun compatibility validation script.
 *
 * Spawns a real bash PTY, sends `echo "hello from pty"`, and verifies the
 * expected text appears in the captured output. Exits 0 on success, 1 on failure.
 *
 * Usage:
 *   bun run apps/server/scripts/validate-pty.ts
 *   # or from apps/server:
 *   bun run scripts/validate-pty.ts
 *
 * This script is a one-off validation for Task 08 — Sprint 1. It will be
 * removed/archived once the PTY manager is implemented in Sprint 2.
 */

import * as pty from 'node-pty';

const MARKER = 'hello from pty';
const TIMEOUT_MS = 1500;

interface ValidationResult {
  success: boolean;
  bunVersion: string;
  nodePtyVersion: string;
  platform: NodeJS.Platform;
  output: string;
  durationMs: number;
  error?: string;
}

async function main(): Promise<ValidationResult> {
  const startedAt = Date.now();
  const bunVersion = (typeof Bun !== 'undefined' && Bun.version) || 'unknown';
  const nodePtyVersion: string =
    // node-pty doesn't expose version at runtime; read from package.json
    await import('node-pty/package.json', { with: { type: 'json' } })
      .then((m) => (m as { default: { version: string } }).default.version)
      .catch(() => 'unknown');

  let output = '';
  let ptyProcess: pty.IPty | null = null;

  return new Promise<ValidationResult>((resolve) => {
    try {
      ptyProcess = pty.spawn('bash', [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      resolve({
        success: false,
        bunVersion,
        nodePtyVersion,
        platform: process.platform,
        output: '',
        durationMs: Date.now() - startedAt,
        error: `pty.spawn failed: ${(err as Error).message}`,
      });
      return;
    }

    const timer = setTimeout(() => {
      const success = output.includes(MARKER);
      try {
        ptyProcess?.kill();
      } catch {
        // ignore kill errors
      }
      resolve({
        success,
        bunVersion,
        nodePtyVersion,
        platform: process.platform,
        output,
        durationMs: Date.now() - startedAt,
      });
    }, TIMEOUT_MS);

    ptyProcess.onData((data: string) => {
      output += data;
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      clearTimeout(timer);
      const success = output.includes(MARKER);
      resolve({
        success,
        bunVersion,
        nodePtyVersion,
        platform: process.platform,
        output,
        durationMs: Date.now() - startedAt,
        error: `pty exited prematurely (code=${exitCode}, signal=${signal ?? 'none'})`,
      });
    });

    // Send the test command. PTYs expect \r (CR), not \n (LF).
    ptyProcess.write(`echo "${MARKER}"\r`);
  });
}

const result = await main();

console.log('=== node-pty + Bun Validation ===');
console.log(`Bun version:        ${result.bunVersion}`);
console.log(`node-pty version:   ${result.nodePtyVersion}`);
console.log(`Platform:           ${result.platform}`);
console.log(`Duration:           ${result.durationMs}ms`);
console.log(`Output length:      ${result.output.length} bytes`);
console.log(`Output preview:     ${JSON.stringify(result.output.slice(0, 200))}`);
console.log(`Marker found:       ${result.output.includes('hello from pty')}`);
console.log('================================');

if (result.success) {
  console.log('\n[PASS] node-pty is compatible with Bun. pty-worker fallback NOT needed.');
  process.exit(0);
} else {
  console.log('\n[FAIL] node-pty did not produce expected output on Bun.');
  if (result.error) console.log(`Reason: ${result.error}`);
  process.exit(1);
}
