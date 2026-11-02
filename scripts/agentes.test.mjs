// The agent distribution files: Agent Skills frontmatter (agentskills.io rules), the Claude Code plugin and
// marketplace manifests, and the MCP registry server.json, kept consistent with each other.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const raiz = new URL("..", import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(join(raiz, p), "utf8"));

/** Minimal YAML frontmatter reader: top-level `key: value` and one level of nested `key:` maps. */
function frontmatter(texto) {
  const m = texto.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md must start with a --- frontmatter block");
  const dados = {};
  let mapa = null;
  for (const linha of m[1].split("\n")) {
    const filho = linha.match(/^ {2}([\w-]+):\s*(.*)$/);
    if (filho && mapa) { dados[mapa][filho[1]] = filho[2]; continue; }
    const topo = linha.match(/^([\w-]+):\s*(.*)$/);
    assert.ok(topo, `frontmatter line not understood: ${linha}`);
    if (topo[2] === "") { mapa = topo[1]; dados[mapa] = {}; } else { mapa = null; dados[topo[1]] = topo[2]; }
  }
  return dados;
}

const skills = readdirSync(join(raiz, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

test("the three skills exist", () => {
  for (const s of ["kodecz", "remotion-to-kodecz", "hyperframes-to-kodecz"]) assert.ok(skills.includes(s), s);
});

for (const s of skills) {
  test(`skills/${s}/SKILL.md follows the Agent Skills format`, () => {
    const texto = readFileSync(join(raiz, "skills", s, "SKILL.md"), "utf8");
    const f = frontmatter(texto);
    assert.equal(f.name, s, "name must match the folder");
    assert.match(f.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(f.name.length <= 64);
    assert.ok(f.description && f.description.length <= 1024, `description: ${f.description?.length} characters`);
    if (f.compatibility) assert.ok(f.compatibility.length <= 500);
    assert.ok(texto.split("\n").length < 500, "keep SKILL.md under 500 lines");
    // Links to files of the skill itself must exist (references/...).
    for (const [, alvo] of texto.matchAll(/`(references\/[^`]+)`/g)) assert.ok(existsSync(join(raiz, "skills", s, alvo)), alvo);
  });
}

test("the repository's own skills stay out of skills.sh installs", () => {
  const f = frontmatter(readFileSync(join(raiz, ".claude/skills/pr/SKILL.md"), "utf8"));
  assert.equal(f.metadata?.internal, "true");
});

test("plugin, marketplace, MCP package and server.json agree", () => {
  const plugin = json(".claude-plugin/plugin.json");
  const mercado = json(".claude-plugin/marketplace.json");
  const pacote = json("mcp/package.json");
  const servidor = json("server.json");
  assert.equal(plugin.name, "kodecz");
  assert.equal(mercado.plugins[0].name, plugin.name);
  assert.equal(mercado.plugins[0].source, "./");
  assert.equal(plugin.license, "Apache-2.0");
  assert.ok(existsSync(join(raiz, plugin.icon)));
  assert.ok(existsSync(join(raiz, plugin.mcpServers.kodecz.args[0].replace("${CLAUDE_PLUGIN_ROOT}/", ""))));
  assert.equal(pacote.mcpName, servidor.name);
  assert.match(servidor.name, /^io\.github\.konecz\//);
  assert.ok(servidor.description.length <= 100, "the MCP registry takes at most 100 characters");
  assert.equal(servidor.packages[0].identifier, pacote.name);
  assert.equal(servidor.packages[0].version, pacote.version);
  assert.equal(servidor.version, pacote.version);
  assert.ok(existsSync(join(raiz, "mcp", pacote.bin["kodecz-mcp"])));
});
