// Testes da detecção de rosto (S04): decodificação das âncoras do YuNet com saída sintética, NMS, e o modelo de verdade
// no retrato de domínio público (preparar.ts) e numa imagem sem rosto. Sem o modelo ou o retrato no cache, os dois
// últimos são pulados com a instrução.
// Rodar: node --test "conferencia/*.test.ts"
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirModelo, decodificar, Detector, nms, paraTensor } from "./rosto.ts";
import { RETRATO } from "./preparar.ts";

/** Saída sintética do YuNet para uma imagem lp × ap: tudo zero, menos as âncoras pedidas. */
function saidaSintetica(lp: number, ap: number, ancoras: { passo: number; r: number; c: number; cls: number; obj: number; bbox: number[] }[]) {
  const s: Record<string, { data: Float32Array }> = {};
  for (const passo of [8, 16, 32]) {
    const n = (lp / passo) * (ap / passo);
    s[`cls_${passo}`] = { data: new Float32Array(n) };
    s[`obj_${passo}`] = { data: new Float32Array(n) };
    s[`bbox_${passo}`] = { data: new Float32Array(n * 4) };
  }
  for (const a of ancoras) {
    const i = a.r * (lp / a.passo) + a.c;
    s[`cls_${a.passo}`].data[i] = a.cls;
    s[`obj_${a.passo}`].data[i] = a.obj;
    s[`bbox_${a.passo}`].data.set(a.bbox, i * 4);
  }
  return s;
}

test("decodificação: centro e tamanho pela âncora e pelo passo; nota √(cls × obj) com limiar", () => {
  const s = saidaSintetica(64, 64, [
    { passo: 16, r: 1, c: 2, cls: 0.9, obj: 1, bbox: [0.5, 0.25, Math.log(2), Math.log(3)] },
    { passo: 8, r: 0, c: 0, cls: 0.5, obj: 0.5, bbox: [0, 0, 0, 0] }, // nota 0,5: abaixo do limiar
    { passo: 32, r: 0, c: 0, cls: 2, obj: 1.5, bbox: [0, 0, 0, 0] }, // fora de [0, 1]: presos a 1
  ]);
  const r = decodificar(s, 64, 64, 0.8);
  assert.equal(r.length, 2);
  const a = r.find((x) => x.nota < 1)!;
  // cx = (2 + 0,5) × 16 = 40; cy = (1 + 0,25) × 16 = 20; w = 2 × 16; h = 3 × 16.
  [24, -4, 32, 48].forEach((v, i) => assert.ok(Math.abs(a.caixa[i] - v) < 1e-4, `${a.caixa}`));
  assert.ok(Math.abs(a.nota - Math.sqrt(0.9)) < 1e-6);
  // Passo 32, âncora (0, 0), deslocamento e escala zero: caixa de 32 px centrada na origem, nota presa a 1.
  assert.deepEqual(r.find((x) => x.nota === 1)!.caixa, [-16, -16, 32, 32]);
});

test("NMS junta caixas repetidas e mantém as separadas", () => {
  const r = nms([
    { caixa: [0, 0, 100, 100], nota: 0.9 }, { caixa: [5, 5, 100, 100], nota: 0.95 }, { caixa: [300, 0, 100, 100], nota: 0.85 },
  ]);
  assert.deepEqual(r.map((x) => x.nota), [0.95, 0.85]);
});

test("tensor: BGR em NCHW, preenchido até o múltiplo de 32", () => {
  const px = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
  const { dados, lp, ap } = paraTensor(px, 2, 1, 4);
  assert.deepEqual([lp, ap], [32, 32]);
  assert.deepEqual([dados[0], dados[1], dados[1024], dados[1025], dados[2048], dados[2049], dados[2]], [1, 4, 2, 5, 3, 6, 0]);
});

const motivo = conferirModelo() ?? (existsSync(RETRATO.reduzido) ? null : `falta o retrato de teste: node conferencia/preparar.ts`);

function bgr(arquivo: string, largura: number) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", arquivo, "-vf", `scale=${largura}:-2`, "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], { maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, String(r.stderr));
  const px = new Uint8Array(r.stdout);
  return { px, altura: px.length / 3 / largura };
}

test("modelo: o retrato de domínio público dá um rosto na região anotada; imagem sem rosto dá zero", { skip: motivo ?? false }, async () => {
  const d = await Detector.abrir();
  try {
    for (const largura of [640, 320]) {
      const { px, altura } = bgr(RETRATO.reduzido, largura);
      const r = await d.detectar(px, largura, altura, 3);
      assert.equal(r.length, 1, `${largura} px: ${JSON.stringify(r)}`);
      // Região anotada à mão no retrato (frações da imagem): o rosto, das sobrancelhas ao queixo.
      const [x, y, w, h] = r[0].caixa.map((v, i) => v / (i % 2 ? altura : largura));
      assert.ok(x > 0.48 && x + w < 0.74 && y > 0.12 && y + h < 0.42 && w > 0.1 && h > 0.1, JSON.stringify([x, y, w, h]));
    }
    const cinza = new Uint8Array(640 * 360 * 4).fill(128);
    assert.deepEqual(await d.detectar(cinza, 640, 360, 4), []);
  } finally { await d.fechar(); }
});
