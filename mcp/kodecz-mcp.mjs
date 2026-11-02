#!/usr/bin/env node
// Kodecz MCP server: the render, preview and check commands as MCP tools, over stdio.
//
// No dependencies: MCP over stdio is newline-delimited JSON-RPC 2.0, and this server only needs initialize,
// tools/list, tools/call and ping. Each tool runs the `kodecz` command installed on the machine (or KODECZ_BIN) with
// an argument list, never through a shell. Logs go to stderr; stdout carries only protocol messages.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const VERSION = "0.1.0";
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_IMAGES = 6;

const folderAndId = {
  folder: { type: "string", description: "Video folder (the one with index.html), absolute or relative to the working directory" },
  id: { type: "string", description: "The id in the page's <script type=\"application/json\" id=\"kodecz\"> block" },
};

export const TOOLS = [
  {
    name: "render",
    title: "Render a Kodecz video",
    description: "Encode the final video file. Use it last: `preview` to look at frames while writing, `check` to catch layout problems, then `render`. Writes `output` atomically (a partial file renamed at the end), replacing a file already there. Takes seconds per few hundred frames on an NVIDIA GPU, several times longer on the CPU (1080p, 150 frames: about 3 s on an RTX 5090, about 7 s on 8 CPU cores). Returns one JSON object: `ok`, `saida` (output path), `modo` (`placa` = GPU or `cpu`), `quadros` (frames), `codec`, `bytes` and `parede` (wall seconds); on failure, the error and the stderr.",
    inputSchema: {
      type: "object",
      properties: {
        ...folderAndId,
        output: { type: "string", description: "Output file (.mp4; .hevc with alpha)" },
        cpu: { type: "boolean", description: "Render on the CPU even when there is a GPU" },
        hevc: { type: "boolean", description: "HEVC instead of H.264 (GPU only)" },
        alpha: { type: "boolean", description: "Transparent layer as raw HEVC with alpha (GPU only, no audio)" },
        from: { type: "integer", minimum: 0, description: "First frame to render" },
        frames: { type: "integer", minimum: 1, description: "How many frames to render from `from`" },
      },
      required: ["folder", "id", "output"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "preview",
    title: "Preview frames",
    description: "Look at specific frames while writing a video, instead of guessing: draws them as lossless PNGs with the same pixels the render will produce and returns them as images (one to two seconds for a few frames, no MP4). Use `check` for automatic rule checks over every frame and `render` only for the final file. Frame numbers must be below the composition's frame count; otherwise the call fails and says the valid range. The PNGs are also written under the Kodecz install's tmp/previa/<id>/.",
    inputSchema: {
      type: "object",
      properties: {
        ...folderAndId,
        frames: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 24, description: "Frame numbers, e.g. [0, 45, 149]" },
      },
      required: ["folder", "id", "frames"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "check",
    title: "Check a video",
    description: "Verify a video before rendering it: runs the automatic layout rules on every frame without encoding (text over a face, captions on one line, social safe area, contrast, zoom timing). Use it after editing and before `render`; use `preview` to see a specific frame. Returns JSON with `ok` and each problem with its frame, plus images of the worst frames; it writes conferencia.json and those images to tmp/conferencia in the working directory. `ok: false` means a rule was broken: fix the page and run `check` again.",
    inputSchema: { type: "object", properties: { ...folderAndId }, required: ["folder", "id"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

/** The command that runs Kodecz: KODECZ_BIN (an executable, or a .ts/.js/.mjs script run by this Node) or `kodecz`. */
export function command(env = process.env) {
  const bin = env.KODECZ_BIN || "kodecz";
  return [".ts", ".js", ".mjs"].includes(extname(bin)) ? [process.execPath, [bin]] : [bin, []];
}

/** Arguments for one tool call. Throws on invalid input, with a message for the agent. */
export function argsFor(name, input, cwd = process.cwd()) {
  const need = (key, type) => {
    if (typeof input?.[key] !== type || (type === "string" && !input[key])) throw new Error(`\`${key}\` is required (${type})`);
    return input[key];
  };
  const path = (p) => (isAbsolute(p) ? p : resolve(cwd, p));
  const folder = path(need("folder", "string")), id = need("id", "string");
  if (name === "render") {
    const a = ["render", folder, id, path(need("output", "string"))];
    if (input.cpu) a.push("--cpu");
    if (input.hevc) a.push("--hevc");
    if (input.alpha) a.push("--alpha");
    for (const k of ["from", "frames"]) {
      if (input[k] === undefined) continue;
      if (!Number.isInteger(input[k]) || input[k] < (k === "from" ? 0 : 1)) throw new Error(`\`${k}\` must be an integer`);
      a.push(`--${k}`, String(input[k]));
    }
    return a;
  }
  if (name === "preview") {
    const frames = input.frames;
    if (!Array.isArray(frames) || !frames.length || frames.some((f) => !Number.isInteger(f) || f < 0)) {
      throw new Error("`frames` must be a list of frame numbers ≥ 0");
    }
    return ["preview", folder, id, "--frame", frames.join(",")];
  }
  if (name === "check") return ["check", folder, id];
  throw new Error(`unknown tool: ${name}`);
}

function run(args, env = process.env) {
  const [bin, pre] = command(env);
  return new Promise((done) => {
    const child = spawn(bin, [...pre, ...args], { stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => { stderr += d; if (stderr.length > 200_000) stderr = stderr.slice(-100_000); });
    child.on("error", (e) => done({ code: -1, stdout, stderr: e.code === "ENOENT" ? `kodecz not found (${bin}). Install Kodecz (https://github.com/konecz/kodecz) or set KODECZ_BIN.` : e.message }));
    child.on("close", (code, signal) => done({ code: code ?? 128, signal, stdout, stderr }));
  });
}

/** The last JSON line of the command's stdout, or null. */
export function lastJson(stdout) {
  for (const line of stdout.trim().split("\n").reverse()) {
    try { return JSON.parse(line); } catch { /* not JSON */ }
  }
  return null;
}

/**
 * Every .png path among the string values of a JSON value, and the .png files whose name starts with `prefix`
 * inside its directory values (the check writes one picture per problem into its output folder).
 */
export function pngsIn(value, { cwd = process.cwd(), prefix = "" } = {}, found = []) {
  if (typeof value === "string" && value.includes("/")) {
    const p = isAbsolute(value) ? value : resolve(cwd, value);
    if (p.endsWith(".png")) found.push(p);
    else {
      try {
        if (statSync(p).isDirectory()) {
          for (const f of readdirSync(p).sort()) if (f.endsWith(".png") && basename(f).startsWith(prefix)) found.push(join(p, f));
        }
      } catch { /* not a folder */ }
    }
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) pngsIn(v, { cwd, prefix }, found);
  }
  return [...new Set(found)];
}

function images(paths) {
  const out = [];
  for (const p of paths.slice(0, MAX_IMAGES)) {
    try { out.push({ type: "text", text: p }, { type: "image", data: readFileSync(p).toString("base64"), mimeType: "image/png" }); } catch { /* gone */ }
  }
  return out;
}

const tail = (s, n = 4000) => (s.length > n ? "…" + s.slice(-n) : s).trim();

/** Runs one tool call and returns an MCP CallToolResult. */
export async function callTool(name, input, env = process.env) {
  let args;
  try { args = argsFor(name, input ?? {}); } catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
  const r = await run(args, env);
  const json = lastJson(r.stdout);
  const text = [json ? JSON.stringify(json) : tail(r.stdout), r.stderr && `stderr:\n${tail(r.stderr)}`].filter(Boolean).join("\n\n");
  // check: exit 4 = a rule was broken; that is a result for the agent to act on, not a tool failure.
  const ok = r.code === 0 || (name === "check" && r.code === 4);
  const content = [{ type: "text", text: text || `exit ${r.code}` }];
  if (ok && name !== "render" && json) content.push(...images(pngsIn(json, { prefix: name === "check" ? `${input.id}-` : "" })));
  return { isError: !ok, content, ...(json && { structuredContent: json }) };
}

/** Handles one JSON-RPC message; returns the response, or null for notifications. */
export async function handle(msg, env = process.env) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (id === undefined || id === null) return null; // notifications (initialized, cancelled...)
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "kodecz", title: "Kodecz", version: VERSION },
        instructions: "Kodecz renders a web page (a folder with index.html and a <script type=\"application/json\" id=\"kodecz\"> block) into an MP4. Loop: write the page, `preview` key frames and look at them, `check`, fix, `render`.",
      });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === params?.name)) return fail(-32602, `unknown tool: ${params?.name}`);
      return reply(await callTool(params.name, params.arguments, env));
    }
    default: return fail(-32601, `method not found: ${method}`);
  }
}

function serve() {
  const write = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  const lines = createInterface({ input: process.stdin });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
    try {
      const res = await handle(msg);
      if (res) write(res);
    } catch (e) {
      write({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: String(e?.message ?? e) } });
    }
  });
  lines.on("close", () => process.exit(0));
}

const isMain = () => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) serve();
