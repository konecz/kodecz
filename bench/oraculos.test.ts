// Kodecz Bench (P12): cada oráculo testado nos dois sentidos. Para cada item, a solução errada (o erro real,
// recriado à mão) tem de ser acusada e a certa tem de passar; sem isso o item não vale. Abre o Electron da coleta
// (CPU) e, nos itens que leem o render, a placa: cada render pega a trava da placa sozinho (bench/coletar.ts), então
// não rodar o teste inteiro dentro de flock -x (travaria); cada render usa a trava compartilhada (flock -s).
//   node --test bench/oraculos.test.ts
// BENCH_ITENS=e1,m5 limita aos itens dados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { avaliar } from "./avaliar.ts";
import { readFileSync } from "node:fs";
import { CLASSIFICACAO, FORA, ITENS } from "./itens.ts";
import { duasLuminancias, frases, razaoContraste } from "./oraculos.ts";

const so = process.env.BENCH_ITENS?.split(",").filter(Boolean);
const escolhidos = so ? ITENS.filter((i) => so.some((p) => i.id.startsWith(p))) : ITENS;

test("catálogo: 27 erros, cada um no bench ou fora com motivo, ids únicos", () => {
  assert.equal(ITENS.length + FORA.length, 27);
  const ids = [...ITENS.map((i) => i.id), ...FORA.map((f) => f.id)];
  assert.equal(new Set(ids).size, ids.length);
  for (const i of ITENS) assert.ok(i.pedido.length > 20 && i.erro && i.regra, i.id);
  for (const f of FORA) assert.ok(f.motivo.length > 20, f.id);
});

test("catálogo: cada erro numa classe da taxonomia do #79 (docs/pesquisa/erros-de-agentes.json)", () => {
  const classes = new Set(JSON.parse(readFileSync(new URL("../docs/pesquisa/erros-de-agentes.json", import.meta.url), "utf8")).classes.map((c: { id: string }) => c.id));
  for (const id of [...ITENS.map((i) => i.id), ...FORA.map((f) => f.id)]) {
    const c = CLASSIFICACAO[id];
    assert.ok(c, `${id} sem classificação`);
    assert.ok(classes.has(c.classe), `${id}: ${c.classe} não está no #79`);
  }
  assert.equal(Object.keys(CLASSIFICACAO).length, 27);
});

test("frases: a pontuação fecha a frase; vírgula não", () => {
  const f = frases([{ t: "Isto", ini: 0, fim: 0.3, bloco: 1 }, { t: "muda,", ini: 0.3, fim: 0.6, bloco: 1 }, { t: "tudo.", ini: 0.6, fim: 1, bloco: 1 },
    { t: "Veja", ini: 1.5, fim: 1.8, bloco: 1 }]);
  assert.deepEqual(f.map((x) => [x.ini, x.fim, x.palavras.length]), [[0, 1, 3], [1.5, 1.8, 1]]);
});

test("contraste: branco sobre céu claro fica abaixo de 3:1; branco sobre tinta, acima", () => {
  const [a, b] = duasLuminancias([0.95, 0.96, 1, 1, 0.94]);
  assert.ok(razaoContraste(a, b) < 1.2);
  const [c, d] = duasLuminancias([0.02, 0.03, 1, 1, 0.02]);
  assert.ok(razaoContraste(c, d) > 10);
});

for (const item of escolhidos) {
  test(`${item.id}: o oráculo acusa a errada e passa a certa`, { timeout: 600_000 }, async () => {
    const raiz = mkdtempSync(join(tmpdir(), `kodecz-bench-${item.id}-`));
    try {
      const r: Record<string, Awaited<ReturnType<typeof avaliar>>> = {};
      for (const lado of ["errada", "certa"] as const) {
        const t = join(raiz, lado);
        mkdirSync(join(t, "saida"), { recursive: true });
        item.preparar(t);
        item[lado](t);
        r[lado] = await avaliar(item, t);
      }
      assert.equal(r.errada.status, "erro", `errada: ${r.errada.status} — ${r.errada.motivo}`);
      assert.equal(r.certa.status, "certo", `certa: ${r.certa.status} — ${r.certa.motivo}`);
      process.stderr.write(`  ${item.id}: errada → ${r.errada.motivo} | certa → ${r.certa.motivo}\n`);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
}
