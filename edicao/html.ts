// Small helpers for the montar.ts of the blocks (blocos/<name>/montar.ts): escaped text, the inline `style` with the
// block's CSS variables, and the frames of an item. Pure.
import type { ContextoMontagem, Gatilho } from "./tipos.ts";

/** Text or attribute value, escaped for HTML. */
export function esc(texto: unknown): string {
  return String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A CSS string literal ('R$ ' → "R$ "), for --prefixo and --sufixo. */
export function textoCss(texto: unknown): string {
  return `"${String(texto).replace(/[\\"]/g, "\\$&").replace(/\r?\n|\r/g, "\\a ")}"`;
}

/** A CSS variable value from the edit: a number, or text without characters that would leave the declaration. */
function valorCss(nome: string, v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() && !/[;{}<>]/.test(v)) return v.trim();
  throw new Error(`CSS variable --${nome}: ${JSON.stringify(v)} is not a number or a plain CSS value`);
}

/**
 * The `style` attribute: `--name: value` for each defined entry, then the item's free `variaveis`
 * ({ "barras-topo": "36%" } → `--barras-topo: 36%`), which can set any variable the block's CSS reads.
 */
export function estilo(vars: Record<string, unknown>, livres?: unknown): string {
  const partes: string[] = [];
  for (const [n, v] of Object.entries(vars)) if (v !== undefined && v !== null) partes.push(`--${n}: ${valorCss(n, v)}`);
  if (livres !== undefined) {
    if (!livres || typeof livres !== "object" || Array.isArray(livres)) throw new Error(`«variaveis» must be an object of CSS variables, like { "titulo-topo": "7%" }`);
    for (const [n, v] of Object.entries(livres)) {
      if (!/^[a-z][a-z0-9-]*$/.test(n)) throw new Error(`«variaveis»: «${n}» is not a CSS variable name (lowercase, digits and hyphens, without the leading --)`);
      partes.push(`--${n}: ${valorCss(n, v)}`);
    }
  }
  return esc(partes.join("; "));
}

/** The item's `de` and `ate` in frames (undefined when the item leaves them out and inherits its scene's). */
export function quadros(item: Record<string, unknown>, ctx: ContextoMontagem): { inicio?: number; fim?: number } {
  const r = (g: unknown) => (g === undefined ? undefined : ctx.q(ctx.tempo(g as Gatilho)));
  return { inicio: r(item.de), fim: r(item.ate) };
}

/** A required text parameter. */
export function texto(item: Record<string, unknown>, campo: string, bloco: string): string {
  const v = item[campo];
  if (typeof v !== "string" || !v.trim()) throw new Error(`${bloco}: «${campo}» (text) is missing`);
  return v;
}

/** An optional number parameter. */
export function numeroOpcional(item: Record<string, unknown>, campo: string, bloco: string, inteiro = false): number | undefined {
  const v = item[campo];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || (inteiro && !Number.isInteger(v))) {
    throw new Error(`${bloco}: «${campo}» must be ${inteiro ? "an integer" : "a number"}, got ${JSON.stringify(v)}`);
  }
  return v;
}
