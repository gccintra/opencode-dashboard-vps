// Headless validation for the control-mode PoC. No browser needed.
// Run: bun scripts/poc-control-mode/probe.ts
//
// Checks:
//   1. unescapeOutput correctness (octal/backslash/UTF-8 vectors)
//   2. live round-trip: spawn shell, send keystrokes, observe echo latency
//   3. resize: refresh-client -C reaches the pane
//   4. fd / CPU sanity across create/destroy cycles (Linux /proc)

import { unescapeOutput, toSendKeysHex, TmuxControlSession } from "./control";

const CONF = new URL("../../apps/pty-worker/tmux.conf", import.meta.url).pathname;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assertEq(name: string, got: Uint8Array, want: number[]) {
  const ok = got.length === want.length && want.every((b, i) => got[i] === b);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`   got=[${[...got]}] want=[${want}]`);
  return ok;
}

// ---- 1. unescape unit vectors -------------------------------------------------
function unitTests() {
  console.log("== unescape unit vectors ==");
  const A = (s: string) => [...new TextEncoder().encode(s)];
  // "%output %0 " prefix is stripped by the parser; here we feed payload-only.
  // ESC [ 3 1 m R E D ESC [ 0 m   from \033[31mRED\033[0m
  assertEq(
    "ansi-color",
    unescapeOutput(new TextEncoder().encode("\\033[31mRED\\033[0m")),
    [0x1b, ...A("[31mRED"), 0x1b, ...A("[0m")],
  );
  assertEq("tab", unescapeOutput(new TextEncoder().encode("a\\011b")), [...A("a"), 0x09, ...A("b")]);
  assertEq(
    "crlf",
    unescapeOutput(new TextEncoder().encode("x\\015\\012")),
    [...A("x"), 0x0d, 0x0a],
  );
  assertEq("backslash", unescapeOutput(new TextEncoder().encode("a\\\\b")), [...A("a"), 0x5c, ...A("b")]);
  assertEq("plain", unescapeOutput(new TextEncoder().encode("hello")), A("hello"));
  // high byte octal \302\251 = © (UTF-8)
  assertEq("utf8-octal", unescapeOutput(new TextEncoder().encode("\\302\\251")), [0xc2, 0xa9]);
  console.log("hex(write):", toSendKeysHex(new Uint8Array([0x1b, 0x5b, 0x41])), "(expect 1b 5b 41)");
  console.log();
}

// ---- /proc helpers ------------------------------------------------------------
async function fdCount(pid?: number) {
  if (!pid) return -1;
  try {
    const { readdir } = await import("node:fs/promises");
    return (await readdir(`/proc/${pid}/fd`)).length;
  } catch {
    return -1;
  }
}
async function cpuJiffies(pid?: number) {
  if (!pid) return -1;
  try {
    const stat = await Bun.file(`/proc/${pid}/stat`).text();
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    // utime=field 14, stime=15 (1-indexed after comm); here index 11,12
    return Number(f[11]) + Number(f[12]);
  } catch {
    return -1;
  }
}

// ---- 2/3. live round-trip -----------------------------------------------------
async function liveTest() {
  console.log("== live round-trip (shell) ==");
  let pane = "";
  let buf = "";
  const echoes: number[] = [];
  let sentAt = 0;

  const s = new TmuxControlSession(`probe_${Date.now().toString(36)}`, CONF, {
    onData: (raw) => {
      buf += new TextDecoder().decode(raw);
      if (sentAt) { echoes.push(performance.now() - sentAt); sentAt = 0; }
    },
    onPane: (p) => (pane = p),
    onExit: (r) => console.log("   exit:", r),
    onLog: () => {},
  });

  s.spawn(80, 24, "exec bash --norc -i");
  await sleep(800);
  console.log("pane captured:", pane || "(none!)");

  // send a marker command, observe echo
  for (let i = 0; i < 30; i++) {
    sentAt = performance.now();
    s.write(new Uint8Array([0x78])); // 'x'
    await sleep(40);
  }
  s.write(new TextEncoder().encode("\r")); // newline
  await sleep(300);

  const sorted = [...echoes].sort((a, b) => a - b);
  const p = (q: number) => sorted.length ? sorted[Math.floor(sorted.length * q)].toFixed(1) : "n/a";
  console.log(`echo latency: p50=${p(0.5)}ms p99=${p(0.99)}ms n=${echoes.length}`);
  console.log(`buffer contains 'x' echoes: ${buf.includes("x")}`);

  // resize check: ask the shell its size after a refresh-client
  buf = "";
  s.resize(120, 40);
  await sleep(200);
  s.write(new TextEncoder().encode("tput cols\r"));
  await sleep(400);
  console.log(`resize → tput cols output includes 120: ${buf.includes("120")}  (raw: ${JSON.stringify(buf.replace(/\s+/g, " ").trim().slice(0, 60))})`);

  // CPU/fd while idle then under flood
  const pid = s.pid();
  const fd0 = await fdCount(pid);
  const c0 = await cpuJiffies(pid);
  await sleep(1000);
  const cIdle = await cpuJiffies(pid);
  buf = "";
  s.write(new TextEncoder().encode("yes | head -100000\r"));
  await sleep(1500);
  const cFlood = await cpuJiffies(pid);
  const fd1 = await fdCount(pid);
  console.log(`fd count: start=${fd0} afterFlood=${fd1}`);
  console.log(`cpu jiffies: idle(1s)=${cIdle - c0} flood(1.5s)=${cFlood - cIdle}`);

  await s.kill();
  await sleep(200);
  console.log();
  return { pid };
}

// ---- 4. create/destroy fd-leak soak ------------------------------------------
async function soak(n: number) {
  console.log(`== create/destroy soak (${n} cycles) ==`);
  const selfFd0 = await fdCount(process.pid);
  for (let i = 0; i < n; i++) {
    const s = new TmuxControlSession(`soak_${i}_${Date.now().toString(36)}`, CONF, { onLog: () => {} });
    s.spawn(80, 24, "exec bash --norc -i");
    await sleep(120);
    await s.kill();
    await sleep(80);
  }
  const selfFd1 = await fdCount(process.pid);
  console.log(`server-process fd: before=${selfFd0} after=${selfFd1} (delta=${selfFd1 - selfFd0})`);
  console.log();
}

if (import.meta.main) {
  unitTests();
  await liveTest();
  await soak(20);
  console.log("done. (tmux sessions cleaned via kill-session)");
  process.exit(0);
}
