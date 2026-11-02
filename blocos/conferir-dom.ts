// S02: roda as checagens de DOM dos blocos (o conferencia.json de cada um) numa página em linha do tempo declarada,
// quadro a quadro, sem render: o CEF na CPU (a casca do captura/cef/) põe o quadro N como o motor e lê o DOM
// (conferir-dom.cjs). Os blocos da página são os `data-bloco="<nome>"` dela. É o teste dos blocos, não a conferência do
// S04 (que olha também o quadro capturado e o rosto); o S04 pode reaproveitar as checagens.
// Uso: node blocos/conferir-dom.ts <pasta servida> <página.html>  → JSON { achados } no stdout; sai com 1 se há P0.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Recursos } from "../cli/processos.ts";
import { CAMINHOS } from "../cli/regras.ts";

export const BLOCOS = new URL(".", import.meta.url).pathname;

export type Checagem = { id: string; prioridade: "P0" | "P1"; seletor: string; quando: string; medida: string;
  maximo?: number; minimo?: number; margem?: string; propriedade?: string; mensagem: string };
export type Achado = { id: string; prioridade: string; quadro: number; onde: string; valor: number; mensagem: string };
export type Resultado = { declaracao: { id: string; largura: number; altura: number; qps: number; quadros: number };
  quadros: number; achados: Achado[]; medidas: Record<string, unknown[]> | null };
/** Uma regra do bloco.css que anima, com as variáveis sem padrão de que a animação depende (fora o --fps e o antigo --qps). */
export type Animacao = { bloco: string; seletor: string; variaveis: string[] };

/** Os nomes dos blocos usados na página (atributo data-bloco), na ordem em que aparecem, sem repetir. */
export function blocosDaPagina(html: string): string[] {
  return [...new Set([...html.matchAll(/data-bloco="([a-z0-9-]+)"/g)].map((m) => m[1]))];
}

/** As checagens do conferencia.json de um bloco (vazio se o bloco não tem). */
export function checagensDoBloco(nome: string): Checagem[] {
  const arquivo = join(BLOCOS, nome, "conferencia.json");
  if (!existsSync(join(BLOCOS, nome, "KODECZ.md"))) throw new Error(`bloco desconhecido: ${nome} (sem blocos/${nome}/KODECZ.md)`);
  return existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, "utf8")).checagens : [];
}

/**
 * As regras do bloco.css que declaram `animation`, cada uma com as variáveis usadas sem padrão (`var(--fim)`, não
 * `var(--x, 1)`) na animação; as variáveis que o próprio bloco define (`--kz-t: calc(var(--inicio) …)`) são trocadas
 * pelas de que dependem. Sem uma delas a declaração inteira fica inválida e a animação não roda (pagina.animacao).
 */
export function animacoesDoBloco(nome: string): Animacao[] {
  const arquivo = join(BLOCOS, nome, "bloco.css");
  if (!existsSync(arquivo)) return [];
  const css = readFileSync(arquivo, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@(keyframes|property)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const regras = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ seletor: m[1].trim(), corpo: m[2] }));
  const definidas = new Map<string, string>();
  for (const r of regras) for (const d of r.corpo.matchAll(/(--[\w-]+)\s*:\s*([^;]*)/g)) definidas.set(d[1], `${definidas.get(d[1]) ?? ""} ${d[2]}`);
  const semPadrao = (texto: string, vistas: Set<string>): string[] => [...texto.matchAll(/var\((--[\w-]+)\)/g)].flatMap(([, v]) => {
    if (vistas.has(v)) return [];
    vistas.add(v);
    return definidas.has(v) ? semPadrao(definidas.get(v)!, vistas) : [v];
  });
  return regras.filter((r) => !r.seletor.includes("::")).flatMap((r) => {
    const animacao = r.corpo.split(";").filter((d) => /^\s*animation\s*:/.test(d));
    if (!animacao.length) return [];
    const vistas = new Set<string>();
    return [{ bloco: nome, seletor: r.seletor, variaveis: animacao.flatMap((d) => semPadrao(d, vistas)).filter((v) => v !== "--fps" && v !== "--qps") }];
  });
}

/** As famílias de fonte dos tokens `--font-<nome>: "Família"` de um CSS de marca, sem repetir. */
export function familiasDaMarca(css: string): string[] {
  return [...new Set([...css.matchAll(/--font-[a-z0-9]+:\s*"([^"]+)"/g)].map((m) => m[1]))];
}

/**
 * As famílias que o fontconfig (de onde o Chromium tira as fontes do sistema no Linux) não acha: o fc-match devolve
 * outra no lugar. Sem o fc-match, todas faltam. Com fonte trocada, as medidas de texto (linhas, transborda, zona
 * segura) não valem.
 */
export function fontesQueFaltam(familias: string[]): string[] {
  return familias.filter((f) => {
    try {
      const achada = execFileSync("fc-match", ["-f", "%{family}", f], { encoding: "utf8" });
      return !achada.split(",").some((x) => x.trim().toLowerCase() === f.toLowerCase());
    } catch {
      return true;
    }
  });
}

/**
 * Abre `pagina` (caminho relativo a `raiz`, que é servida por HTTP local) e roda as checagens nos quadros pedidos
 * (padrão: todos). `medir` lê valores soltos para os testes: [quadro, seletor, propriedade CSS ou "caixa"]. O Electron
 * sobe num grupo de processos próprio, que morre inteiro no fim e no estouro de `limiteMs` (padrão 180 s), com os
 * processos do Chromium (cli/processos.ts). `electron` troca o executável (testes).
 */
export async function conferirPagina(raiz: string, pagina: string, opcoes: { checagens?: Checagem[]; quadros?: number[];
  medir?: [number, string, string][]; electron?: string; limiteMs?: number } = {}): Promise<Resultado> {
  raiz = resolve(raiz);
  const blocos = blocosDaPagina(readFileSync(join(raiz, pagina), "utf8"));
  const checagens = opcoes.checagens ?? blocos.flatMap(checagensDoBloco);
  const animacoes = blocos.flatMap(animacoesDoBloco);
  const limite = opcoes.limiteMs ?? 180000;
  const recursos = new Recursos({ espera: 1000 });
  // O grupo do Electron não recebe o Ctrl+C do terminal nem o SIGTERM mandado ao Node: no sinal, mata o grupo e sai.
  const SINAIS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
  const aoSinal = (sinal: NodeJS.Signals) => {
    for (const g of recursos.grupos) { try { process.kill(-g, "SIGKILL"); } catch { /* já morreu */ } }
    process.exit(SINAIS[sinal as keyof typeof SINAIS]);
  };
  for (const s of Object.keys(SINAIS)) process.on(s, aoSinal);
  try {
    if (!opcoes.electron && !existsSync(CAMINHOS.hostCef)) throw new Error(`falta o host do CEF (${CAMINHOS.hostCef}): captura/cef/montar.sh`);
    const pasta = recursos.pasta("blocos-dom-");
    const arquivo = join(pasta, "pedido.json");
    writeFileSync(arquivo, JSON.stringify({ checagens, animacoes, quadros: opcoes.quadros, medir: opcoes.medir }));
    // Pelo CEF (o mesmo host da captura, na CPU): o conferir-dom.cjs roda no Node com o `electron` trocado pela casca
    // (captura/cef/ganchos.ts). `opcoes.electron` troca o executável (testes do grupo de processos).
    const [cmd, ...antes] = opcoes.electron ? [opcoes.electron] : [process.execPath, "--import", CAMINHOS.ganchosCef];
    const p = recursos.iniciar(cmd, [...antes, ...(opcoes.electron ? [] : [join(BLOCOS, "conferir-dom.cjs")]), "--no-sandbox",
      "--ozone-platform=headless", "--disable-gpu", ...(opcoes.electron ? [join(BLOCOS, "conferir-dom.cjs")] : []), raiz, pagina, arquivo],
      // M04_SAIDA: a pasta do host (FIFOs, quadro) fica dentro da temporária, apagada na liberação mesmo no estouro.
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, M04_SAIDA: pasta } });
    let saida = "", erros = "";
    p.stdout!.setEncoding("utf8").on("data", (d: string) => { saida += d; });
    p.stderr!.setEncoding("utf8").on("data", (d: string) => { erros += d; });
    // Quando o Electron sai, o resto do grupo (um processo do Chromium segurando o stdout) morre, e o «close» chega.
    p.on("exit", () => { try { process.kill(-p.pid!, "SIGKILL"); } catch { /* o grupo já acabou */ } });
    let relogio: NodeJS.Timeout | undefined;
    const fim = await Promise.race([
      new Promise<number | null>((ok, falha) => {
        p.on("close", (codigo) => ok(codigo));
        p.on("error", (e) => falha(new Error(`o navegador não abriu (${opcoes.electron ?? CAMINHOS.hostCef}): ${e.message}`)));
      }),
      new Promise<"estouro">((ok) => { relogio = setTimeout(() => ok("estouro"), limite); }),
    ]);
    clearTimeout(relogio);
    if (fim === "estouro") throw new Error(`o Electron estourou ${limite / 1000} s sem responder (grupo de processos encerrado):\n${erros.slice(-800)}`);
    const linha = saida.split("\n").filter((l) => l.startsWith("dom ")).pop();
    if (!linha) throw new Error(`o Electron não respondeu (saiu com ${fim}):\n${erros.slice(-800)}`);
    const j = JSON.parse(linha.slice(4));
    if (j.erro) throw new Error(j.erro);
    return j;
  } finally {
    await recursos.liberar();
    for (const s of Object.keys(SINAIS)) process.off(s, aoSinal);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [raiz, pagina] = process.argv.slice(2);
  if (!raiz || !pagina) {
    process.stderr.write("uso: node blocos/conferir-dom.ts <pasta servida> <página.html>\n");
    process.exit(2);
  }
  const r = await conferirPagina(raiz, pagina);
  process.stdout.write(`${JSON.stringify({ quadros: r.quadros, achados: r.achados }, null, 2)}\n`);
  process.exit(r.achados.some((a) => a.prioridade === "P0") ? 1 : 0);
}
