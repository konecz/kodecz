// Detecção de rosto da conferência (S04, G15): YuNet (OpenCV Zoo, MIT) no onnxruntime-node, na CPU, fora do Electron.
// O modelo não fica no repositório: `node conferencia/preparar.ts` baixa uma vez para ~/.cache/motor-video/modelos/ e
// o comando confere o SHA-256 fixado antes de usar (decisão do responsável de 2026-10-30; docs/adr.md, seção 12).
// Entrada do YuNet: BGR em float de 0 a 255, NCHW, altura e largura múltiplas de 32 (preenchidas com zero à direita e
// embaixo), como o FaceDetectorYN do OpenCV. Saída por passo (8, 16, 32): cls, obj, bbox e kps; a decodificação das
// caixas e o NMS são nossos (escritos a partir da descrição do modelo, testados com saída sintética).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Caixa } from "./regras.ts";

export const CACHE = process.env.MOTOR_CACHE ?? join(homedir(), ".cache", "motor-video");
/** O modelo, fixado por commit do opencv_zoo e por hash do arquivo. */
export const MODELO = {
  arquivo: join(CACHE, "modelos", "face_detection_yunet_2026may.onnx"),
  url: "https://github.com/opencv/opencv_zoo/raw/26cc381e4d2594bb9f47a26eb8fd96c94a13660d/models/face_detection_yunet/face_detection_yunet_2026may.onnx",
  sha256: "ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0",
  licenca: "MIT (Copyright (c) 2020 Shiqi Yu), opencv_zoo/models/face_detection_yunet/LICENSE",
};
const PASSOS = [8, 16, 32];
export type Rosto = { caixa: Caixa; nota: number };

export const sha256 = (arquivo: string) => createHash("sha256").update(readFileSync(arquivo)).digest("hex");

/** null se o modelo está no cache e confere; senão, o motivo com a correção. */
export function conferirModelo(): string | null {
  if (!existsSync(MODELO.arquivo)) return `the face model is missing (${MODELO.arquivo}): run ./instalar.sh (or node conferencia/preparar.ts)`;
  const h = sha256(MODELO.arquivo);
  if (h !== MODELO.sha256) return `the face model at ${MODELO.arquivo} does not match (SHA-256 ${h}, expected ${MODELO.sha256}): delete it and run ./instalar.sh`;
  return null;
}

/** Pixels (BGRA ou BGR, linha a linha) → tensor NCHW em BGR float, com largura e altura levadas ao múltiplo de 32. */
export function paraTensor(pixels: Uint8Array, largura: number, altura: number, canais: 3 | 4) {
  const lp = Math.ceil(largura / 32) * 32, ap = Math.ceil(altura / 32) * 32;
  const dados = new Float32Array(3 * lp * ap);
  const plano = lp * ap;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const o = (y * largura + x) * canais, d = y * lp + x;
      dados[d] = pixels[o]; dados[plano + d] = pixels[o + 1]; dados[2 * plano + d] = pixels[o + 2];
    }
  }
  return { dados, lp, ap };
}

type Saidas = Record<string, { data: ArrayLike<number> }>;

/** As caixas de todas as âncoras com nota ≥ limiar (nota = √(cls × obj), cada um preso a [0, 1]). */
export function decodificar(saidas: Saidas, lp: number, ap: number, limiar = 0.8): Rosto[] {
  const rostos: Rosto[] = [];
  const prender = (v: number) => Math.min(1, Math.max(0, v));
  for (const passo of PASSOS) {
    const cls = saidas[`cls_${passo}`].data, obj = saidas[`obj_${passo}`].data, bbox = saidas[`bbox_${passo}`].data;
    const colunas = lp / passo, linhas = ap / passo;
    for (let r = 0; r < linhas; r++) {
      for (let c = 0; c < colunas; c++) {
        const i = r * colunas + c;
        const nota = Math.sqrt(prender(cls[i]) * prender(obj[i]));
        if (nota < limiar) continue;
        const cx = (c + bbox[i * 4]) * passo, cy = (r + bbox[i * 4 + 1]) * passo;
        const w = Math.exp(bbox[i * 4 + 2]) * passo, h = Math.exp(bbox[i * 4 + 3]) * passo;
        rostos.push({ caixa: [cx - w / 2, cy - h / 2, w, h], nota });
      }
    }
  }
  return rostos;
}

const iou = (a: Caixa, b: Caixa) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (a[2] * a[3] + b[2] * b[3] - i);
};

/** Supressão de não máximos: da maior nota para a menor, descarta a caixa que cobre uma já aceita (IoU > limite). */
export function nms(rostos: Rosto[], limite = 0.3): Rosto[] {
  const aceitos: Rosto[] = [];
  for (const r of [...rostos].sort((a, b) => b.nota - a.nota)) if (aceitos.every((a) => iou(a.caixa, r.caixa) <= limite)) aceitos.push(r);
  return aceitos;
}

/** O detector aberto (uma sessão do onnxruntime na CPU, um fio para não disputar a CPU dos sites). */
export class Detector {
  sessao: any;
  ort: any;
  private constructor(sessao: any, ort: any) { this.sessao = sessao; this.ort = ort; }

  static async abrir(arquivo = MODELO.arquivo): Promise<Detector> {
    const ort = (await import("onnxruntime-node")).default;
    const sessao = await ort.InferenceSession.create(arquivo, { executionProviders: ["cpu"], intraOpNumThreads: 1, interOpNumThreads: 1 });
    return new Detector(sessao, ort);
  }

  /** Rostos na imagem, em px dela, da maior nota para a menor. */
  async detectar(pixels: Uint8Array, largura: number, altura: number, canais: 3 | 4, limiar = 0.8): Promise<Rosto[]> {
    const { dados, lp, ap } = paraTensor(pixels, largura, altura, canais);
    const saidas = await this.sessao.run({ input: new this.ort.Tensor("float32", dados, [1, 3, ap, lp]) });
    return nms(decodificar(saidas, lp, ap, limiar)).map((r) => ({ nota: r.nota, caixa: [
      Math.max(0, r.caixa[0]), Math.max(0, r.caixa[1]),
      Math.min(largura, r.caixa[0] + r.caixa[2]) - Math.max(0, r.caixa[0]), Math.min(altura, r.caixa[1] + r.caixa[3]) - Math.max(0, r.caixa[1])] as Caixa }));
  }

  async fechar() { await this.sessao.release?.(); }
}
