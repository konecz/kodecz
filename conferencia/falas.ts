// As falas da composição no tempo do vídeo (S04, decisão de 2026-10-30): a página publica
// window.motor_falas = [{ t, ini, fim, bloco }], com o texto do roteiro (com a pontuação) e o tempo do Whisper (G11),
// já com o deslocamento dos blocos e a velocidade aplicados pela própria composição. O --falas arquivo.json, no mesmo
// formato, vale por cima. Aqui só a conferência do esquema.
import type { Fala } from "./regras.ts";

/** Confere e devolve as falas; sem falas (undefined ou null), lista vazia. Lança com a palavra e o campo errados. */
export function lerFalas(valor: unknown): Fala[] {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) throw new Error("motor_falas tem de ser uma lista de { t, ini, fim, bloco }");
  let anterior = -Infinity;
  return valor.map((p: any, i: number) => {
    const erro = (m: string) => new Error(`motor_falas, palavra ${i} (${JSON.stringify(p).slice(0, 60)}): ${m}`);
    if (p === null || typeof p !== "object") throw erro("tem de ser um objeto { t, ini, fim, bloco }");
    if (typeof p.t !== "string" || !p.t.trim()) throw erro("«t» vazio ou não é texto");
    for (const c of ["ini", "fim"]) if (typeof p[c] !== "number" || !Number.isFinite(p[c]) || p[c] < 0) throw erro(`«${c}» tem de ser número ≥ 0 (segundos do vídeo)`);
    if (p.fim < p.ini) throw erro("fim antes do início");
    if (typeof p.bloco !== "number" && typeof p.bloco !== "string") throw erro("«bloco» tem de ser número ou texto");
    if (p.ini < anterior) throw erro("fora de ordem (cada palavra começa depois do início da anterior)");
    anterior = p.ini;
    return { t: p.t, ini: p.ini, fim: p.fim, bloco: p.bloco };
  });
}
