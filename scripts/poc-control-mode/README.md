# PoC — tmux control mode (`tmux -C`)

Throwaway validation for `docs/plan-tmux-control-mode.md`. NOT wired into the app.
Findings: `docs/poc-control-mode-findings.md`.

## Run headless validation (no browser)

```bash
bun scripts/poc-control-mode/probe.ts
```

Runs: unescape unit vectors, live echo-latency round-trip, resize check, output-
flood fd/CPU check, and a 20× create/destroy fd-leak soak. Uses a dedicated tmux
socket (`-L alf_poc`) — never touches the real `default` socket.

## Run interactive (browser)

```bash
bun scripts/poc-control-mode/server.ts          # → http://localhost:4599
# INNER_CMD="exec bash --norc -i" bun ...        # shell instead of claude
```

Open the URL, type. HUD (top-right) shows live echo p50/p99.

## Files

- `control.ts` — `TmuxControlSession`: spawn/parse/write/resize/kill, no PTY.
- `server.ts` — Bun WS bridge + serves `index.html`.
- `index.html` — xterm.js client (CDN), binary input frames, JSON resize frames.
- `probe.ts` — headless checks.

## Cleanup

```bash
tmux -L alf_poc kill-server   # nuke any PoC sessions
```
