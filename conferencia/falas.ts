// As falas da composição no tempo do vídeo (S04, decisão de 2026-10-30): a página publica
// window.motor_falas = [{ t, ini, fim, bloco }], com o texto do roteiro (com a pontuação) e o tempo do Whisper (G11),
// já com o deslocamento dos blocos e a velocidade aplicados pela própria composição. O --falas arquivo.json, no mesmo
// formato, vale por cima. Aqui só a conferência do esquema.
import type { Fala } from "./regras.ts";

/** Confere e devolve as falas; sem falas (undefined ou null), lista vazia. Lança com a palavra e o campo errados. */
export function lerFalas(valor: unknown): Fala[] {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) throw new Error("motor_falas must be a list of { t, ini, fim, bloco }");
  let anterior = -Infinity;
  return valor.map((p: any, i: number) => {
    const erro = (m: string) => new Error(`motor_falas, word ${i} (${JSON.stringify(p).slice(0, 60)}): ${m}`);
    if (p === null || typeof p !== "object") throw erro("must be an object { t, ini, fim, bloco }");
    if (typeof p.t !== "string" || !p.t.trim()) throw erro("«t» is empty or not a string");
    for (const c of ["ini", "fim"]) if (typeof p[c] !== "number" || !Number.isFinite(p[c]) || p[c] < 0) throw erro(`«${c}» must be a number ≥ 0 (seconds into the video)`);
    if (p.fim < p.ini) throw erro("«fim» is before «ini»");
    if (typeof p.bloco !== "number" && typeof p.bloco !== "string") throw erro("«bloco» must be a number or a string");
    if (p.ini < anterior) throw erro("out of order (each word must start after the previous one starts)");
    anterior = p.ini;
    return { t: p.t, ini: p.ini, fim: p.fim, bloco: p.bloco };
  });
}
