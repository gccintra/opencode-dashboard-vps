// Live integration: drives the REAL PtyManager + ControlWorkerTransport against
// a real tmux (Bun runtime). Validates the protocol translation end-to-end:
// spawn → stream(data) → write → resize → list → kill.
//
// Run: PTY_BACKEND=control bun scripts/poc-control-mode/integration.ts
//
// Uses the same default tmux socket as the app (so tmux.ts admin commands see
// the sessions); cleans up its own `alf_` sessions on exit.

import { PtyManager } from "../../apps/server/src/pty/manager";
import { ControlWorkerTransport } from "../../apps/server/src/pty/control";
import { buildTmuxSpawnArgs, SPAWN_WRAPPER, tmuxKillSession } from "../../apps/server/src/pty/tmux";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

const id = `itest-${Date.now().toString(36)}`;
const mgr = new PtyManager({ transport: new ControlWorkerTransport(), timeoutMs: 8000 });

let out = "";
mgr.start();

try {
  // ── spawn ──
  const pid = await mgr.spawnSession(
    id,
    process.cwd(),
    SPAWN_WRAPPER,
    buildTmuxSpawnArgs(id, 80, 24, "exec bash --norc -i"),
  );
  check("spawn resolves with a pid", typeof pid === "number" && pid > 0, `pid=${pid}`);
  check("status active after spawn", mgr.getSessionStatus(id) === "active");

  mgr.onSessionData(id, (chunk) => (out += chunk));
  await sleep(700);

  // ── write → echo ──
  out = "";
  mgr.writeToSession(id, "echo HELLO_ALF\r");
  await sleep(500);
  check("write reaches the pane (echo seen)", out.includes("HELLO_ALF"), JSON.stringify(out.replace(/\s+/g, " ").trim().slice(0, 50)));

  // ── data buffer accumulates ──
  check("session buffer is populated", mgr.getSessionBuffer(id).length > 0);

  // ── resize ──
  out = "";
  mgr.resizeSession(id, 120, 40);
  await sleep(300);
  mgr.writeToSession(id, "tput cols\r");
  await sleep(500);
  check("resize applied (tput cols = 120)", out.includes("120"), JSON.stringify(out.replace(/\s+/g, " ").trim().slice(0, 40)));

  // ── list ──
  const list = await mgr.listSessions();
  check("list includes the session", list.includes(id), `list=${JSON.stringify(list)}`);

  // ── UTF-8 round-trip ──
  out = "";
  mgr.writeToSession(id, "printf 'X\\xc2\\xa9Y\\n'\r");
  await sleep(500);
  check("utf-8 (©) survives write→echo→output", out.includes("©") || out.includes("X©Y"), JSON.stringify(out.replace(/\s+/g, " ").trim().slice(0, 40)));

  // ── kill ──
  await tmuxKillSession(id); // route layer kills the tmux session first
  await mgr.killSession(id); // then the manager tears down the control client
  check("status killed after kill", mgr.getSessionStatus(id) === "killed");
} catch (err) {
  check(`no exception (${(err as Error).message})`, false);
} finally {
  await tmuxKillSession(id);
  await mgr.shutdown();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
