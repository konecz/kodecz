// Gerador de casos (P12/P15): todo caso de classe do manifesto vira Item sem lançar erro, e o Item que o rodador vai
// usar (sem `semOraculo`) monta a partida. Regressão: casos de grau (abaixo, no, acima) de classes cuja especificação
// não tem `graus` derrubavam o rodador do modo 1 no meio da rodada (K-DES-04, 2026-11-01). Sem placa nem navegador:
// um caso por classe e grau, só a montagem da cena.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paraItem } from "./adaptador.ts";
import { deClasse, lerManifesto } from "./expandir.ts";
import { lerEspecificacoes } from "./provas.ts";

test("todo caso de classe vira Item, e o que não é pulado monta a partida", () => {
  const es = lerEspecificacoes(), vistos = new Set<string>(), falhas: string[] = [];
  const pasta = mkdtempSync(join(tmpdir(), "kodecz-adaptador-"));
  try {
    for (const caso of deClasse(lerManifesto())) {
      const chave = `${caso.classe}/${caso.grau}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      try {
        const item = paraItem(caso, es);
        if (item.semOraculo || item.bloqueio) continue;
        const t = join(pasta, caso.id);
        item.preparar(t);
      } catch (err) { falhas.push(`${caso.id} (${chave}): ${(err as Error).message}`); }
    }
  } finally { rmSync(pasta, { recursive: true, force: true }); }
  assert.deepEqual(falhas, []);
});
