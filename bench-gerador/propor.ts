// Kodecz Bench (P12): a geração com auto-verificação. Um modelo barato (Claude Code em modo não interativo, sem
// ferramentas) propõe, para cada classe do catálogo (#79: erro, sintoma, assinatura, eixos), a especificação em dado:
// a mutação em primitivas, o pedido, os graus e a regra (medida dos motores genéricos e limiar). Só entra o que passa
// nas provas (bench-gerador/provas.ts: dois sentidos nos casos pairwise e nos graus); o que falha volta ao modelo com
// as falhas, até 3 tentativas. O custo de cada chamada fica em tmp/bench-provas/propostas/ e há teto em US$.
//
//   node bench-gerador/propor.ts gerar --classes K-IA-01,K-IA-02 [--modelo sonnet] [--paralelo 4] [--teto-usd 20]
//   node bench-gerador/propor.ts provar --classes …       # prova as propostas pendentes (na placa, sob flock -s)
//   node bench-gerador/propor.ts cpu --classes …          # recusa (com as falhas) as que não montam em todo caso
//   node bench-gerador/propor.ts custo                     # o gasto até agora
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { lerCatalogo } from "./catalogo.ts";
import { ACESSORIOS } from "./mundo.ts";
import { MEDIDAS } from "./motores.ts";
import type { Especificacao } from "./mutacoes.ts";
import { CACHE, ESPECIFICACOES, lerEspecificacoes, lerRegras, montaTodos } from "./provas.ts";
import { deClasse, lerManifesto } from "./expandir.ts";
import { provar, resumir } from "./provar.ts";

const PASTA = join(CACHE, "propostas");

const MUNDO = `O mundo do bench: cada caso é uma página web (vídeo por código em linha do tempo declarada) gerada a partir de uma
CENA BASE CORRETA, como modelo de dados (elementos com id, tag, papel, css, texto, de/ate em quadros, animações). A base:
- seções <section class="cena" id="cena-i"> (i = 0…N−1), cortes na grade da batida da trilha e nas pausas da fala;
- cenas pares com o apresentador (vídeo <video data-papel="apresentador" id="take-i">, rosto rotulado na biblioteca),
  cenas ímpares de cobertura (mídia id="cobertura-i" data-papel="cobertura", rótulo da palavra falada na cena), com rótulo
  (id="rotulo-i", data-papel="rotulo") e corpo (id="corpo-i-0", data-papel="corpo");
- na 1.ª cena o título (h1 id="titulo", data-papel="titulo", com uma palavra destacada num <span>);
- faixa nos takes (id="faixa-i", data-papel="faixa", centrada logo acima da legenda);
- legenda em pedaços sincronizados com a fala (id="legenda-k", data-papel="legenda", numa linha, numa placa escura);
- com 3 cenas ou mais, a última é o cartão final (logo id="logo-fim" e chamada id="chamada");
- áudio: <audio id="voz" data-papel="voz"> (tons a 220 Hz, um por palavra) e <audio id="trilha" data-papel="trilha"> (tom de 165 Hz e batidas a 990 Hz) com
  data-volume em pontos «quadro:volume» que abaixa a trilha sob a voz e faz fade de entrada e saída;
- entradas com easing da marca cubic-bezier(0.16, 1, 0.3, 1), escalonadas, cada tipo de elemento com uma animação;
- o motor põe a página no quadro N pela linha do tempo (Web Animations, CSS @keyframes); antes de cada quadro ele espera
  a promessa que window.motor_quadro(n, ms) devolver (o gancho do canvas), as fontes (document.fonts) e as <img>
  (imagem que não carrega derruba o render); o canvas da cobertura só existe com o eixo "midia" = "canvas ou 3D"
  (para garantir em todo caso: "tarefa": {"midia": "canvas ou 3D"}; o campo "tarefa" sobrescreve a tarefa antes de montar
  a base: midia, fundo, trilha, rosto, legenda, plataforma, velocidadeVoz, permitido, transparente, laco);
- cores só da marca (#F7F4EC, #1B1F2A, #E4572E, #2E86AB, #6B6F7A, #FFFFFF); nada sobre o rosto; tudo na zona segura.
Acessórios (peças a mais, feitas do jeito certo, que a classe pode pedir no campo "acessorios"):
${Object.keys(ACESSORIOS).map((a) => `- ${a}`).join("\n")}
(marcadores: dois itens de gráfico com cor e rótulo; numero: um número dos dados com rótulo; efeito: um selo id="selo"
que entra com um efeito sonoro <audio id="efeito"> no mesmo quadro; ambiente: som de ambiente por cena (id="ambiente-i")
que entra 6 quadros antes do corte; decoracao: forma id="forma" que entra num corte; laco: a tarefa é um laço, o último
quadro volta ao primeiro; transparente: a tarefa pede fundo transparente; hdr: a biblioteca tem um clipe HDR e a versão
SDR convertida, a base usa a SDR (id="clipe", src midia/clipe-sdr.mp4); cartao: cartão final mesmo com poucas cenas;
vozRapida: a voz deve tocar a 1,25× (o <audio id="voz"> tem data-velocidade="1.25"); biblioteca: três imagens a mais
rotuladas com palavras que não estão na fala (midia/extra-0.png, -1, -2); transcricao: uma transcrição automática
ruim (saida/transcricao.json) com marcas como [música]; takeHorizontal: o take do apresentador veio 16:9 e o vídeo é
vertical (a base reenquadra pelo rosto com object-position); deslize: uma transição pensada no 1.º corte (a cena sai
para a esquerda, a próxima entra pela direita); revisao: pedido de revisão, só o título (id="titulo") pode mudar.)`;

const VARIACOES = `A cena muda com os eixos do caso (a mutação tem de valer em TODOS os casos da classe):
- com "cenas" = 1 e apresentador, a única cena é um take (sem cobertura, rótulo nem corpo; tem título, faixa e legenda);
- com "rosto" = "sem rosto" (e nos tipos sem apresentador: dados, lyric, slide, vinheta, demo), não há apresentador nem
  faixa: todas as cenas são de cobertura (cena 0 com o título no lugar do rótulo);
- com "trilha" = "sem trilha" não há <audio id="trilha"> (use "substituir": {"trilha": {"sem trilha": "trilha baixa"}}
  se a classe precisa da trilha; o mesmo vale para outro eixo: "substituir": {eixo: {valor: valorUsado}});
- o cartão final só existe com 3 cenas ou mais (ou com o acessório "cartao");
- o <span> destacado do título está dentro do HTML do h1 (não é elemento selecionável);
- use "ou" no seletor para alternativas: {"papel":"cobertura","ou":[{"papel":"apresentador"}]}.
As contas "=…" são só numéricas (variáveis, números, + - * / ( ) e Math.*); para texto use "{=conta}" dentro do texto.`;

const PRIMITIVAS = `Primitivas da mutação (lista em ordem; "alvo" é um seletor {id?, papel?, tag?, cena?: número|"ultima"|"meio"|"A"|"B",
pai?, n?: número|"ultimo", texto?: true, todos?: true}; sem "todos" pega o primeiro):
- {"op":"estilo","alvo":…,"css":{"prop":"valor"}}            muda o CSS (valor "" remove)
- {"op":"texto","alvo":…,"texto"?:…,"html"?:…,"acrescentar"?:…,"trocar"?:[de,para],"quebrarAntesDaUltima"?:true,"maiusculas"?:true,"destacar"?:"#cor"}
- {"op":"animar","alvo":…,"anim":{"chaves":[{css},…],"iniS":s,"durS":s,"easing":"…","iter":n|-1,"fill":"both","alternar"?:true}}
- {"op":"anims","alvo":…,"easing"?,"dur"?:s,"ini"?:s,"deslocar"?:s,"iter"?,"fill"?,"chaves"?,"remover"?:true}   muda as animações do alvo
- {"op":"tempo","alvo":…,"deslocar"?:s,"de"?:s|null,"ate"?:s|null,"fracao"?:true}   muda quando o alvo aparece/some
- {"op":"cortes","deslocar":s}                                  desloca todos os cortes de cena
- {"op":"inserir","el":{"id","tag","papel"?,"texto"?,"html"?,"css":{…},"attrs":{…},"de"?:quadro,"ate"?:quadro,"anims"?:[…]},"pai"?:"cena-1"}
- {"op":"remover","alvo":…}
- {"op":"attrs","alvo":…,"attrs":{"data-volume":"…"}}         atributos (null remove)
- {"op":"midia","arquivo":"midia/x.png","receita":{"tipo":"imagem","largura":…,"altura":…,"c0":"#…","c1":"#…"},"rotulo"?:{…}}
- {"op":"script","js":"…"}, {"op":"css","regra":"…"}, {"op":"head","css":"@font-face …"}
- {"op":"dados","kb":n}                                          embute n KB de dados num script da página
- {"op":"texto","alvo":…,"palavras":n}                          troca o texto por n palavras da fala (texto demais)
- {"op":"declaracao","quadros"?:…,"largura"?:…,"altura"?:…,"id"?:…}
- {"op":"entrega","ffmpeg":["-vf","…","-c:v","libx264",…]}     processa o MP4 entregue (tarefas que pedem o arquivo)
- {"op":"sobreRosto","alvo":…}                                  põe o alvo sobre o rosto do apresentador
- {"op":"fundoPagina","cor":"…"}
Valores: número, texto, ou "=conta" (o texto inteiro) / "{=conta}px" (trecho), com as variáveis g (intensidade do grau),
L, A, S (lado menor), qps, quadros, segundos, rostoX, rostoY, rostoW, rostoH, falaFim, falaUltimaIni, corte0, cortes,
m (margem), yTitulo, yLegenda, yFaixa, fsTitulo, fsCorpo, fsLegenda, batida, grade, trilhaGanho, enfaseIni, enfaseFim
e as funções Math.* e cinza(luminanciaDoFundo, razaoDeContraste).`;

const MEDIDAS_DOC = () => Object.entries(MEDIDAS).map(([n, m]) => `- ${n} (${m.motor}): ${m.descricao}`).join("\n");

const FORMATO = `Responda SÓ com um objeto JSON (sem texto fora dele):
{"classe":"K-…","origem":"modelo","pedido":"o pedido ao agente, em português: uma alteração sobre a composição já pronta (que está certa), do jeito que leva ao erro da classe, sem dizer qual é a armadilha",
 "pedidoRevisao"?:"pedido de revisão, para os graus","acessorios"?:[…],"tarefa"?:{…},"certa"?:[primitivas do jeito certo, se o pedido muda algo],
 "errada":[primitivas que injetam o erro da classe na base],"graus"?:{"padrao":g,"abaixo":g,"no":g,"acima":g,"unidade":"…","fonte":"…"},
 "regra":{"medida":"…","p":{…},"op":">"|">="|"<"|"<="|"="|"!=","limite":n},"calibrar"?:true}
Regras: a regra acusa a errada (erro quando "valor op limite") e passa a base e a certa; com graus, "abaixo" fica do lado
certo do limiar, "no" é o menor erro além dele e "acima" bem além; a mesma mutação vale em todos os eixos da classe; a
regra só lê o que sai da página, do render, da biblioteca rotulada e da tarefa (nunca o nome da mutação); a mutação é
o erro desta classe e só ele (não pode disparar as regras de outras classes: não mexa em cor, posição, tempo ou som
além do necessário).`;

function prompt(classe: any, exemplos: Especificacao[], falhas?: string[]) {
  return `${MUNDO}\n\n${VARIACOES}\n\n${PRIMITIVAS}\n\nMedidas dos motores de oráculo (a regra escolhe uma, com parâmetros "p"):\n${MEDIDAS_DOC()}\n\n` +
    `Exemplos de especificação aceita:\n${exemplos.map((e) => JSON.stringify(e)).join("\n")}\n\n${FORMATO}\n\n` +
    `A classe:\n${JSON.stringify({ id: classe.id, titulo: classe.titulo, erro: classe.erro, sintoma: classe.sintoma, causa: classe.causa, assinatura: classe.assinatura, eixos: classe.eixos, verificador: classe.verificador })}` +
    (falhas?.length ? `\n\nA proposta anterior falhou nas provas:\n${falhas.slice(0, 12).join("\n")}\nCorrija a mutação ou a regra.` : "");
}

type Chamada = { classe: string; tentativa: number; custo: number; segundos: number; resposta: string; espec: Especificacao | null; erro?: string };

function chamar(texto: string, modelo: string): Promise<{ custo: number; resposta: string; segundos: number }> {
  const dir = join(tmpdir(), "kodecz-propor");
  mkdirSync(dir, { recursive: true });
  const t0 = performance.now();
  return new Promise((ok) => {
    const p = spawn("claude", ["-p", "--model", modelo, "--output-format", "json", "--tools", "", "--setting-sources", "", "--strict-mcp-config",
      "--no-session-persistence", "--max-budget-usd", "1", "--system-prompt", "Você escreve especificações em JSON para um gerador de casos de teste. Responda só com o JSON pedido."],
      { cwd: dir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } });
    let out = "";
    p.stdout.on("data", (b) => (out += b));
    p.stdin.end(texto);
    p.on("close", () => {
      let custo = 0, resposta = out;
      try { const j = JSON.parse(out); custo = j.total_cost_usd ?? 0; resposta = String(j.result ?? ""); } catch { /* resposta crua */ }
      ok({ custo, resposta, segundos: +((performance.now() - t0) / 1000).toFixed(1) });
    });
  });
}

const extrair = (s: string): Especificacao | null => {
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
};

const historico = (c: string): Chamada[] => existsSync(join(PASTA, `${c}.json`)) ? JSON.parse(readFileSync(join(PASTA, `${c}.json`), "utf8")) : [];
export const gasto = () => existsSync(PASTA) ? readdirSync(PASTA).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(join(PASTA, f), "utf8")) as Chamada[]).reduce((s, x) => s + x.custo, 0) : 0;

/** Valida a forma da proposta antes de gastar placa. */
export function validar(e: any, classe: string): string | null {
  if (!e || typeof e !== "object") return "não é JSON";
  if (e.classe !== classe) return `classe ${e.classe} ≠ ${classe}`;
  if (!Array.isArray(e.errada) || !e.errada.length) return "sem errada";
  if (!e.regra || !MEDIDAS[e.regra.medida]) return `medida desconhecida: ${e.regra?.medida}`;
  if (typeof e.regra.limite !== "number") return "limite não numérico";
  for (const a of e.acessorios ?? []) if (!(a in ACESSORIOS)) return `acessório desconhecido: ${a}`;
  return null;
}

async function gerar(classes: string[], o: { modelo: string; paralelo: number; teto: number }) {
  const cat = lerCatalogo(), exemplosIds = ["K-DES-07", "K-EDI-01", "K-AUD-01"];
  const es = lerEspecificacoes();
  const exemplos = exemplosIds.map((x) => es[x]).filter(Boolean);
  mkdirSync(PASTA, { recursive: true });
  const fila = [...classes];
  const trabalhar = async () => {
    while (fila.length) {
      const c = fila.shift()!;
      if (gasto() >= o.teto) { process.stderr.write(`teto de US$ ${o.teto} atingido; parado antes de ${c}\n`); return; }
      const h = historico(c), classe = cat.classes.find((x: any) => x.id === c);
      if ((h.at(-1) as any)?.aceita) continue;
      if (h.length >= 3) { process.stderr.write(`${c}: 3 tentativas, fica para a mão\n`); continue; }
      const falhas = h.at(-1)?.erro ? [h.at(-1)!.erro!] : (h.at(-1) as any)?.falhas;
      const r = await chamar(prompt(classe, exemplos, falhas), o.modelo);
      const espec = extrair(r.resposta);
      const erro = validar(espec, c) ?? undefined;
      h.push({ classe: c, tentativa: h.length + 1, custo: r.custo, segundos: r.segundos, resposta: r.resposta.slice(0, 20000), espec: erro ? null : espec, ...(erro ? { erro } : {}) });
      writeFileSync(join(PASTA, `${c}.json`), JSON.stringify(h, null, 1));
      process.stderr.write(`${c}: tentativa ${h.length}, US$ ${r.custo.toFixed(3)}, ${r.segundos} s${erro ? `, inválida (${erro})` : ""}\n`);
    }
  };
  await Promise.all(Array.from({ length: o.paralelo }, trabalhar));
  process.stderr.write(`gasto total: US$ ${gasto().toFixed(2)}\n`);
}

/** Prova a última proposta válida de cada classe; aceita (grava em especificacoes.json, origem «modelo») se tudo passa. */
async function provarPropostas(classes: string[], max: number) {
  for (const c of classes) {
    const h = historico(c), ult = h.at(-1);
    if (!ult?.espec) { process.stderr.write(`${c}: sem proposta válida\n`); continue; }
    if ((ult as any).provada) { process.stderr.write(`${c}: já provada (${(ult as any).aceita ? "aceita" : "recusada"})\n`); continue; }
    let r;
    const naCpu = montaTodos(ult.espec, deClasse(lerManifesto()).filter((x) => x.classe === c));
    if (naCpu.length) r = { total: 1, ok: 0, falhas: naCpu.slice(0, 6) };
    else try { r = resumir(await provar({ ...ult.espec, origem: "modelo" }, { max, graus: true })); } catch (e) { r = { total: 0, ok: 0, falhas: [`as provas falharam: ${(e as Error).message}`] }; }
    const aceita = r.total > 0 && r.ok === r.total;
    Object.assign(ult, { provada: true, aceita, falhas: r.falhas, placar: `${r.ok}/${r.total}` });
    writeFileSync(join(PASTA, `${c}.json`), JSON.stringify(h, null, 1));
    if (aceita) {
      // O arquivo inteiro (com as regras só da conferência), para não perdê-las ao gravar.
      const es = lerRegras() as Record<string, Especificacao>;
      if (es[c]?.origem !== "mao") { es[c] = { ...ult.espec, origem: "modelo", ...(es[c]?.conferencia ? { conferencia: es[c].conferencia } : {}) }; writeFileSync(ESPECIFICACOES, JSON.stringify(es, null, 1) + "\n"); }
    }
    process.stderr.write(`${c}: ${aceita ? "ACEITA" : "recusada"} ${r.ok}/${r.total}${aceita ? "" : ` — ${r.falhas.slice(0, 2).join(" | ")}`}\n`);
  }
}

/** Na CPU: a última proposta de cada classe monta em todos os casos? As que não montam ficam recusadas, com as falhas
 * (que voltam ao modelo na próxima tentativa). Devolve as recusadas. */
function conferirNaCpu(classes: string[]): string[] {
  const casos = deClasse(lerManifesto()), recusadas: string[] = [];
  for (const c of classes) {
    const h = historico(c), ult = h.at(-1) as any;
    if (!ult?.espec || ult.provada) continue;
    const f = montaTodos(ult.espec, casos.filter((x) => x.classe === c));
    if (!f.length) continue;
    Object.assign(ult, { provada: true, aceita: false, falhas: f.slice(0, 6), placar: `não monta em ${f.length} casos` });
    writeFileSync(join(PASTA, `${c}.json`), JSON.stringify(h, null, 1));
    recusadas.push(c);
  }
  return recusadas;
}

async function principal() {
  const [cmd] = process.argv.slice(2);
  const { values: v } = parseArgs({ args: process.argv.slice(3), options: { classes: { type: "string" }, modelo: { type: "string", default: "sonnet" },
    paralelo: { type: "string", default: "4" }, "teto-usd": { type: "string", default: "20" }, max: { type: "string", default: "4" } } });
  const classes = (v.classes ?? "").split(",").filter(Boolean);
  if (cmd === "gerar") await gerar(classes, { modelo: v.modelo!, paralelo: Number(v.paralelo), teto: Number(v["teto-usd"]) });
  else if (cmd === "provar") await provarPropostas(classes, Number(v.max));
  else if (cmd === "cpu") process.stdout.write(`${conferirNaCpu(classes).join(",")}\n`);
  else process.stdout.write(`${JSON.stringify({ gastoUsd: +gasto().toFixed(3) })}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
