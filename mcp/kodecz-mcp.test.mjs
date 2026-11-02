// Tests of the Kodecz MCP server with a fake `kodecz` command (no GPU, no browser).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { argsFor, callTool, handle, lastJson, TOOLS } from "./kodecz-mcp.mjs";

const dir = mkdtempSync(join(tmpdir(), "kodecz-mcp-"));
after(() => rmSync(dir, { recursive: true, force: true }));

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const fake = join(dir, "kodecz.mjs");
writeFileSync(fake, `
import { writeFileSync, mkdirSync } from "node:fs";
const [cmd, folder, id, ...rest] = process.argv.slice(2);
const out = ${JSON.stringify(dir)};
if (cmd === "preview") {
  const frames = rest[rest.indexOf("--frame") + 1].split(",");
  const map = {};
  for (const f of frames) { map[f] = out + "/frame-" + f + ".png"; writeFileSync(map[f], Buffer.from(${JSON.stringify(PNG.toString("base64"))}, "base64")); }
  console.log(JSON.stringify({ ok: true, frames: map }));
} else if (cmd === "check") {
  mkdirSync(out + "/check", { recursive: true });
  writeFileSync(out + "/check/" + id + "-G17-30.png", Buffer.from(${JSON.stringify(PNG.toString("base64"))}, "base64"));
  writeFileSync(out + "/check/Other-G17-1.png", "x");
  console.error("G17 frame 30: caption on 2 lines");
  console.log(JSON.stringify({ ok: false, failures: { G17: 1 }, folder: out + "/check" }));
  process.exit(4);
} else if (cmd === "render") {
  if (folder.endsWith("broken")) { console.error("error: no index.html"); process.exit(1); }
  console.log(JSON.stringify({ ok: true, args: process.argv.slice(2) }));
}
`);
const env = { ...process.env, KODECZ_BIN: fake };

test("tools: render, preview and check, with schemas", () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ["render", "preview", "check"]);
  for (const t of TOOLS) assert.equal(t.inputSchema.type, "object");
});

test("arguments use the English command names and resolve paths", () => {
  assert.deepEqual(argsFor("render", { folder: "v", id: "A", output: "o.mp4", cpu: true, alpha: true, from: 10, frames: 5 }, "/w"),
    ["render", "/w/v", "A", "/w/o.mp4", "--cpu", "--alpha", "--from", "10", "--frames", "5"]);
  assert.deepEqual(argsFor("preview", { folder: "/v", id: "A", frames: [0, 45] }), ["preview", "/v", "A", "--frame", "0,45"]);
  assert.deepEqual(argsFor("check", { folder: "/v", id: "A" }), ["check", "/v", "A"]);
  assert.throws(() => argsFor("preview", { folder: "/v", id: "A", frames: [-1] }), /frames/);
  assert.throws(() => argsFor("render", { folder: "/v", id: "A" }), /output/);
});

test("lastJson takes the last JSON line", () => {
  assert.deepEqual(lastJson("progress\n{\"a\":1}\n{\"ok\":true}\n"), { ok: true });
  assert.equal(lastJson("no json"), null);
});

test("preview returns the frames as images", async () => {
  const r = await callTool("preview", { folder: "/v", id: "A", frames: [0, 45] }, env);
  assert.equal(r.isError, false);
  assert.equal(r.content.filter((c) => c.type === "image").length, 2);
  assert.equal(r.structuredContent.ok, true);
});

test("check: a broken rule is a result, with the pictures of this composition only", async () => {
  const r = await callTool("check", { folder: "/v", id: "A" }, env);
  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /G17 frame 30/);
  const imgs = r.content.filter((c) => c.type === "image");
  assert.equal(imgs.length, 1);
});

test("render: a failure is a tool error with the stderr", async () => {
  const r = await callTool("render", { folder: "/v/broken", id: "A", output: "/o.mp4" }, env);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /no index\.html/);
  const missing = await callTool("render", { folder: "/v", id: "A", output: "/o.mp4" }, { ...process.env, KODECZ_BIN: join(dir, "nothing-here") });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /kodecz not found/);
});

test("JSON-RPC: initialize, tools/list, unknown method, notification", async () => {
  const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.ok(init.result.capabilities.tools);
  const odd = await handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(odd.result.protocolVersion, "2025-11-25");
  assert.equal((await handle({ jsonrpc: "2.0", id: 3, method: "tools/list" })).result.tools.length, 3);
  assert.equal((await handle({ jsonrpc: "2.0", id: 4, method: "nope" })).error.code, -32601);
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("stdio: the server answers over stdin and stdout", async () => {
  const child = spawn(process.execPath, [new URL("./kodecz-mcp.mjs", import.meta.url).pathname], { env, stdio: ["pipe", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "check", arguments: { folder: "/v", id: "A" } } }) + "\n");
  await new Promise((ok) => { const t = setInterval(() => { if (out.split("\n").filter(Boolean).length >= 2) { clearInterval(t); ok(); } }, 20); });
  child.stdin.end();
  const [a, b] = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(a.result.serverInfo.name, "kodecz");
  assert.equal(b.id, 2);
  assert.equal(b.result.structuredContent.ok, false);
});
