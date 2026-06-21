// PoC server: serves an xterm page and bridges one tmux -C control session per
// WebSocket. Run: bun scripts/poc-control-mode/server.ts
//
// Env:
//   PORT       (default 4599)
//   INNER_CMD  (default "claude; exec zsh 2>&1 || exec bash")
//   TMUX_CONF  (default apps/pty-worker/tmux.conf)

import { TmuxControlSession } from "./control";

const PORT = Number(process.env.PORT ?? 4599);
const INNER_CMD = process.env.INNER_CMD ?? "claude; exec zsh 2>&1 || exec bash";
const TMUX_CONF =
  process.env.TMUX_CONF ?? new URL("../../apps/pty-worker/tmux.conf", import.meta.url).pathname;

const HTML = await Bun.file(new URL("./index.html", import.meta.url)).text();

interface WsData {
  session?: TmuxControlSession;
  name: string;
}

const server = Bun.serve<WsData>({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const name = `poc_${Math.random().toString(36).slice(2, 8)}`;
      if (srv.upgrade(req, { data: { name } })) return;
      return new Response("upgrade failed", { status: 400 });
    }
    return new Response(HTML, { headers: { "content-type": "text/html" } });
  },
  websocket: {
    open(ws) {
      const session = new TmuxControlSession(ws.data.name, TMUX_CONF, {
        onData: (raw) => ws.send(raw), // binary frame of raw decoded bytes
        onExit: (reason) => {
          ws.send(JSON.stringify({ type: "exit", reason }));
          try { ws.close(); } catch {}
        },
        onPane: (pane) => console.log(`[${ws.data.name}] pane=${pane}`),
        onLog: (line) => console.log(`[${ws.data.name}] ${line}`),
      });
      ws.data.session = session;
      // initial size is sent by the client right after open via a resize msg;
      // start at a sane default.
      session.spawn(80, 24, INNER_CMD);
    },
    message(ws, msg) {
      const s = ws.data.session;
      if (!s) return;
      if (typeof msg === "string") {
        // control frame: {"resize":[cols,rows]}
        try {
          const obj = JSON.parse(msg);
          if (obj.resize) s.resize(obj.resize[0], obj.resize[1]);
        } catch {}
        return;
      }
      // binary frame: raw keystroke bytes
      s.write(new Uint8Array(msg as ArrayBuffer));
    },
    close(ws) {
      // PoC: control client (and its tmux session) torn down on disconnect so we
      // can soak create/destroy cycles. Real app keeps the tmux session alive.
      ws.data.session?.kill();
    },
  },
});

console.log(`PoC control-mode server: http://localhost:${server.port}`);
console.log(`  inner: ${INNER_CMD}`);
console.log(`  conf:  ${TMUX_CONF}`);
