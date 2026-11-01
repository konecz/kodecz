// O aviso de piscada sobre a série de brilho do render (cli/brilho.ts; docs/formatos/brilho.md). Sem placa: a série é
// dada; a medida na placa está em nativo/src/brilho.rs e no cli/render.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { arquivoDoBrilho, gravarBrilho, LIMITE_PISCADA, maiorPico, picosIsolados } from "./brilho.ts";

test("piscada: o clarão de um quadro (o vídeo reprovado do S04, pico de ~131) acusa; o quadro preto também", () => {
  const clarao = [60, 61, 192.2, 61, 60];
  assert.deepEqual(picosIsolados(clarao), [{ quadro: 2, pico: 131.2, brilho: 192.2, antes: 61, depois: 61 }]);
  const preto = [120, 121, 16, 120, 119];
  assert.deepEqual(picosIsolados(preto, LIMITE_PISCADA, 100).map((p) => [p.quadro, p.pico]), [[102, 104]]);
});

test("piscada: o que os vídeos aprovados têm (cortina de ~30, corte, rampa, quadro parado) não acusa", () => {
  // Cortina de transição: pico isolado de ~30 (o maior nos aprovados da calibração).
  assert.deepEqual(picosIsolados([80, 80, 110.3, 80, 80]), []);
  // Corte seco para uma cena mais clara: um salto só, sem volta.
  assert.deepEqual(picosIsolados([40, 40, 200, 200, 200]), []);
  // Clarão de dois quadros (não é a piscada de um quadro perdido) e rampa.
  assert.deepEqual(picosIsolados([40, 200, 200, 40]), []);
  assert.deepEqual(picosIsolados([20, 80, 140, 200]), []);
  // Repetidos e série curta.
  assert.deepEqual(picosIsolados([50, 50, 50]), []);
  assert.deepEqual(picosIsolados([16, 235]), []);
});

test("piscada: o limite é estrito (60 não acusa, 60,01 acusa) e o pico é o menor dos dois saltos", () => {
  assert.deepEqual(picosIsolados([100, 160, 100]), []);
  assert.equal(picosIsolados([100, 160.01, 100])[0].pico, 60.01);
  // Salto de 150 e volta de 70: o pico é 70.
  assert.equal(picosIsolados([100, 250, 180])[0].pico, 70);
  assert.deepEqual(maiorPico([10, 30, 10, 12, 50, 12]), { quadro: 4, pico: 38 });
  assert.equal(maiorPico([1, 2, 3]), null);
});

test("brilho: a série vai para o arquivo ao lado da saída, no formato documentado", () => {
  const pasta = mkdtempSync(join(tmpdir(), "brilho-"));
  try {
    const saida = join(pasta, "video.mp4");
    assert.equal(arquivoDoBrilho(saida), join(pasta, "video.brilho.json"));
    assert.equal(arquivoDoBrilho(join(pasta, "camada.hevc")), join(pasta, "camada.brilho.json"));
    const r = gravarBrilho(saida, [60, 61.234, 192.2, 61, 60], [0, 1.2, 130.9, 131.1, 1], { qps: 30, de: 10, msBrilho: 0.05 });
    assert.deepEqual(r, { arquivo: join(pasta, "video.brilho.json"), medio: 86.89, minimo: 60, maximo: 192.2, maiorPico: { quadro: 12, pico: 130.97 },
      maiorMudanca: 131.1, limitePiscada: 60, piscadas: [{ quadro: 12, pico: 130.97, brilho: 192.2, antes: 61.23, depois: 61 }], msBrilho: 0.05 });
    const j = JSON.parse(readFileSync(r.arquivo, "utf8"));
    assert.equal(j.formato, 1);
    assert.equal(j.qps, 30);
    assert.equal(j.de, 10);
    assert.equal(j.limitePiscada, 60);
    assert.deepEqual(j.brilho, [60, 61.23, 192.2, 61, 60]);
    assert.deepEqual(j.mudanca, [0, 1.2, 130.9, 131.1, 1]);
    assert.equal(j.piscadas.length, 1);
    // Camada com alfa (M05): a série sai, sem procurar piscada.
    const camada = gravarBrilho(join(pasta, "camada.hevc"), [16, 16, 200, 16, 16], [0, 0, 184, 184, 0], { qps: 30, de: 0, msBrilho: null, alfa: true });
    assert.deepEqual([camada.piscadas, camada.limitePiscada], [[], null]);
    assert.deepEqual(JSON.parse(readFileSync(camada.arquivo, "utf8")).brilho, [16, 16, 200, 16, 16]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
