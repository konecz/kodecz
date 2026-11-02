// Measures one render command the way docs/medidas.md does (R05), for any renderer: the command runs once in its own
// systemd user scope with the usual containment (contencao.mjs: nice 19, idle I/O, a cap of RENDER_NUCLEOS cores),
// and the scope's cgroup gives the CPU time (user + system of the whole process tree, including every browser
// process the renderer starts) and the peak memory. Wall time is from start to exit. `nvidia-smi dmon -s u` samples
// the GPU while it runs (the whole card, which is shared: sm/enc/dec are not this command's alone).
//
// Usage: node ferramentas/medir-render.mjs [--rotulo x] [--json out.jsonl] [--log out.log] -- <command...>
// Prints one JSON line; with --json, also appends it to that file. With --log, the command's output goes there.
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prefixoContencao } from "./contencao.mjs";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 0 || sep === argv.length - 1) {
  console.error("usage: node medir-render.mjs [--rotulo x] [--json out.jsonl] [--log out.log] -- <command...>");
  process.exit(2);
}
const opt = {};
for (let i = 0; i < sep; i += 2) opt[argv[i].replace(/^--/, "")] = argv[i + 1];
const command = argv.slice(sep + 1);

const dir = mkdtempSync(join(tmpdir(), "medir-render-"));
const stat = join(dir, "cgroup");
// The sh runs inside the scope: after the command, it reads its own cgroup's cpu.stat and memory.peak.
const sh = `"$@"; s=$?; cg=/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup); cat "$cg/cpu.stat" "$cg/memory.peak" > "${stat}"; exit $s`;
const prefix = prefixoContencao();
if (prefix[0] !== "systemd-run") throw new Error("no systemd-run --user: the CPU time could not be read");

let dmon = null;
const samples = [];
try {
  dmon = spawn("nvidia-smi", ["dmon", "-s", "u"], { stdio: ["ignore", "pipe", "ignore"] });
  dmon.on("error", () => {});
  let rest = "";
  dmon.stdout.on("data", (d) => {
    const lines = (rest + d).split("\n");
    rest = lines.pop();
    for (const l of lines) if (!l.startsWith("#") && l.trim()) {
      const [, sm, , enc, dec] = l.trim().split(/\s+/).map(Number);
      samples.push({ sm, enc, dec });
    }
  });
} catch { /* no NVIDIA tools: no GPU samples */ }

const loadBefore = readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).join(" ");
const out = opt.log ? openSync(opt.log, "a") : "inherit";
const t0 = process.hrtime.bigint();
const child = spawn(prefix[0], [...prefix.slice(1), "sh", "-c", sh, "sh", ...command], {
  stdio: ["ignore", out, out],
  env: { ...process.env, RENDER_CONTIDO: "1" },
});
const code = await new Promise((ok) => child.on("close", ok));
const wall = Number(process.hrtime.bigint() - t0) / 1e9;
dmon?.kill();
if (code !== 0) {
  rmSync(dir, { recursive: true, force: true });
  console.error(`[${opt.rotulo ?? "render"}] command exited with ${code}`);
  process.exit(1);
}

const txt = readFileSync(stat, "utf8").trim().split("\n");
rmSync(dir, { recursive: true, force: true });
const field = (n) => Number(txt.find((l) => l.startsWith(n)).split(" ")[1]);
const mean = (k) => (samples.length ? samples.reduce((t, a) => t + a[k], 0) / samples.length : null);
const r = {
  rotulo: opt.rotulo ?? "render",
  cpu: +((field("user_usec") + field("system_usec")) / 1e6).toFixed(2),
  parede: +wall.toFixed(2),
  memGB: +(Number(txt.at(-1)) / 2 ** 30).toFixed(2),
  sm: mean("sm"), enc: mean("enc"), dec: mean("dec"),
  carga: loadBefore,
  comando: command.join(" "),
};
console.log(JSON.stringify(r));
if (opt.json) appendFileSync(opt.json, `${JSON.stringify(r)}\n`);
