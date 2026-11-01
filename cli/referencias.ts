// Quadros de referência (S05): quadros aprovados de uma composição, comparados a cada render para pegar regressão.
//
//   node cli/referencias.ts aprovar  <entrada> [<composição>] [--lista 0,30,59 | --cada N] [--placa | --cpu] ...
//   node cli/referencias.ts conferir <entrada> [<composição>] [--placa | --cpu] [--cruzado] ...
//   (node cli/referencias.ts --ajuda lista as opções)
//
// Os dois renderizam pelo `cli/render.ts --gravar` (sem mexer no laço de render) só o trecho que vai do menor ao maior
// quadro pedido (o quadro N não depende de onde o render começa, R03 e P10.4). `aprovar` grava cada quadro em PNG sem
// perda (cli/quadros.ts) e o referencias.json; `conferir` compara pela régua do R03 e, no que falha, salva a imagem da
// diferença ampliada e o quadro atual. Formato em docs/formatos/referencias.md.
//
// Saída: resumo no stderr; no stdout, uma linha JSON. Códigos: 0 aprovado / passou; 1 regressão; 2 uso (inclusive
// referência ausente ou de outro modo sem --cruzado); 3 o render não saiu (placa ausente ou ocupada, render falhou).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CAMINHOS, ErroDeUso, lerDeclaracao, SEM_REMOTION, type Declaracao } from "./regras.ts";
import { amostrar, dePng, dentroDaRegua, diferenca, imagemDiferenca, marcosDaLinha, paraPng, REGUA_CRUZADA, REGUA_R03,
  ssim, type Regua } from "./quadros.ts";

const RENDER = new URL("./render.ts", import.meta.url).pathname;
const FORMATO = 1;

export const USO = `uso: node cli/referencias.ts <aprovar | conferir> <entrada> [<composição>] [opções]

  aprovar        renderiza os quadros escolhidos e grava as referências (PNG sem perda + referencias.json); refaz as
                 do mesmo modo, se já houver
  conferir       renderiza os quadros das referências e compara pela régua do R03 (igual, ou até 2 níveis por canal
                 com SSIM ≥ 0,999); no que falha, salva a diferença ampliada e o quadro atual
  <entrada>      como no cli/render.ts: a linha do tempo (pasta com index.html e o bloco motor-video)
  <composição>   id da composição; opcional (vem do bloco)

  --lista <0,30,59>   (aprovar) estes quadros; sem ela, amostragem automática: o primeiro, o último, um a cada
                      --cada e, na linha do tempo, o início e o fim de cada animação com valores literais
  --cada <N>          (aprovar) intervalo da amostragem (padrão: o maior entre o qps e duração ÷ 30)
  --por <nome>        (aprovar) quem aprovou (padrão: user.name do git, ou o usuário)
  --placa | --cpu     o modo do render (sem nenhum, o do cli/render.ts). As referências guardam o modo; cada modo
                      tem as suas
  --cruzado           (conferir) sem referência do modo do render, compara com a do outro pela régua cruzada (só SSIM
                      ≥ 0,997, sobre preto): placa e CPU rasterizam diferente
  --referencias <pasta>  onde ficam (padrão <pasta da entrada>/referencias/<composição>)
  --diferencas <pasta>   (conferir) onde vão as imagens das falhas (padrão tmp/referencias/<composição>-<data> do motor)
  --sem-contencao     passado ao cli/render.ts
  -h, --ajuda

Saída: resumo no stderr; no stdout, uma linha JSON. Códigos: 0 passou (ou aprovado); 1 regressão; 2 uso, referência
ausente ou de outro modo sem --cruzado; 3 o render não saiu (placa ausente ou ocupada, falha do render).`;

type QuadroRef = { n: number; arquivo: string; sha256: string; bytes: number };
type ModoRef = { motor: string; data: string; aprovadoPor: string; quadros: QuadroRef[] };
export type Referencias = {
  formato: number; composicao: string; formatoEntrada: string; largura: number; altura: number; qps: number | null;
  props: string; modos: Partial<Record<"placa" | "cpu", ModoRef>>;
};
type Opcoes = {
  comando: "aprovar" | "conferir"; entrada: string; composicao: string;
  declaracao: Declaracao; html: string; lista: number[] | null; cada: number | null; por: string | null;
  modo: "placa" | "cpu" | null; cruzado: boolean; referencias: string; diferencas: string | null;
  repassar: string[];
};

class ErroDeRender extends Error {
  codigo: number;
  constructor(m: string, codigo = 3) { super(m); this.codigo = codigo; }
}
const avisar = (t: string) => process.stderr.write(`referencias: ${t}\n`);

export function lerOpcoes(argv: string[]): Opcoes {
  let r;
  try {
    r = parseArgs({
      args: argv, allowPositionals: true, strict: true, options: {
        lista: { type: "string" }, cada: { type: "string" }, por: { type: "string" },
        placa: { type: "boolean" }, cpu: { type: "boolean" }, cruzado: { type: "boolean" }, referencias: { type: "string" },
        diferencas: { type: "string" }, "sem-contencao": { type: "boolean" }, ajuda: { type: "boolean", short: "h" },
      },
    });
  } catch (e) { throw new ErroDeUso(`${(e as Error).message}\n\n${USO}`); }
  const o = r.values, [comando, entradaTexto, composicaoTexto, ...sobra] = r.positionals;
  if (o.ajuda) throw new ErroDeUso(USO, 0);
  if (comando !== "aprovar" && comando !== "conferir") throw new ErroDeUso(`subcomando tem de ser aprovar ou conferir: ${comando ?? "(nenhum)"}\n\n${USO}`);
  if (!entradaTexto) throw new ErroDeUso(`falta a entrada\n\n${USO}`);
  if (sobra.length) throw new ErroDeUso(`argumentos a mais: ${sobra.join(" ")}`);
  if (o.placa && o.cpu) throw new ErroDeUso("--placa e --cpu juntos");
  if (comando === "conferir") {
    for (const x of ["lista", "cada", "por"] as const) if (o[x] !== undefined) throw new ErroDeUso(`--${x} é só do aprovar (o conferir usa o que as referências guardam)`);
  } else for (const x of ["cruzado", "diferencas"] as const) if (o[x] !== undefined) throw new ErroDeUso(`--${x} é só do conferir`);
  const entrada = resolve(entradaTexto);
  if (!existsSync(entrada)) throw new ErroDeUso(`entrada não existe: ${entrada}`);
  const html = statSync(entrada).isDirectory() && existsSync(join(entrada, "index.html")) ? readFileSync(join(entrada, "index.html"), "utf8") : null;
  const declaracao = html === null ? null : lerDeclaracao(html);
  // Só a linha do tempo: o pacote e o projeto do Remotion saíram do motor (docs/adr.md, seção 16).
  if (!html || !declaracao) throw new ErroDeUso(`${entrada}: falta index.html com o bloco <script id="motor-video">; ${SEM_REMOTION}`);
  const composicao = composicaoTexto ?? declaracao.id;
  if (composicao !== declaracao.id) throw new ErroDeUso(`a composição declarada é «${declaracao.id}», não «${composicao}»`);
  const inteiroOuErro = (x: string, nome: string, min: number) => {
    if (!/^\d+$/.test(x) || Number(x) < min) throw new ErroDeUso(`${nome}: inteiro ≥ ${min}: ${x}`);
    return Number(x);
  };
  let lista: number[] | null = null;
  if (o.lista !== undefined) {
    if (!/^\d+(,\d+)*$/.test(o.lista)) throw new ErroDeUso(`--lista: quadros separados por vírgula, como 0,30,59: ${o.lista}`);
    lista = [...new Set(o.lista.split(",").map(Number))].sort((a, b) => a - b);
    if (lista.at(-1)! >= declaracao.quadros) throw new ErroDeUso(`--lista: a composição tem ${declaracao.quadros} quadros (0…${declaracao.quadros - 1})`);
  }
  if (lista && o.cada !== undefined) throw new ErroDeUso("--lista e --cada juntos: a lista já diz os quadros");
  const repassar: string[] = [];
  if (o["sem-contencao"]) repassar.push("--sem-contencao");
  return {
    comando, entrada, composicao, declaracao, html, lista, cada: o.cada === undefined ? null : inteiroOuErro(o.cada, "--cada", 1),
    por: o.por ?? null, modo: o.placa ? "placa" : o.cpu ? "cpu" : null, cruzado: !!o.cruzado,
    referencias: resolve(o.referencias ?? join(entrada, "referencias", composicao)),
    diferencas: o.diferencas === undefined ? null : resolve(o.diferencas), repassar,
  };
}

type Render = { modo: "placa" | "cpu"; largura: number; altura: number; qps: number | null; duracao: number | null; pasta: string; tmp: string };

/** Um render pelo cli/render.ts, gravando os quadros `quadros` (ou nenhum, só para saber a duração). */
function renderizar(o: Opcoes, quadros: number[], modo: "placa" | "cpu" | null): Render {
  const tmp = mkdtempSync(join(tmpdir(), "motor-referencias-"));
  const pasta = join(tmp, "quadros");
  const de = quadros.length ? quadros[0] : 0, ate = quadros.length ? quadros.at(-1)! : 0;
  const args = [RENDER, o.entrada, o.composicao, join(tmp, "saida.mp4"), "--de", String(de), "--quadros", String(ate - de + 1), ...o.repassar];
  if (modo) args.push(`--${modo}`);
  if (quadros.length) args.push("--gravar", quadros.join(","), "--gravar-pasta", pasta);
  const p = spawnSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 << 20 });
  let json: any = null;
  try { json = JSON.parse(p.stdout.trim().split("\n").pop() ?? ""); } catch {}
  if (p.status !== 0 || !json?.ok) {
    rmSync(tmp, { recursive: true, force: true });
    // 2 do render é argumento (o mesmo erro de uso aqui); o resto é render que não saiu.
    throw new ErroDeRender(`o render não saiu (cli/render.ts saiu com ${p.status ?? p.signal})`, p.status === 2 ? 2 : 3);
  }
  const c = json.composicao ?? {};
  return { modo: json.modo, largura: c.largura ?? o.declaracao.largura, altura: c.altura ?? o.declaracao.altura, qps: c.fps ?? null,
    duracao: c.duracao ?? null, pasta, tmp };
}

function versaoDoMotor(): string {
  const g = spawnSync("git", ["-C", CAMINHOS.raiz, "describe", "--always", "--dirty"], { encoding: "utf8" });
  return g.status === 0 ? g.stdout.trim() : "desconhecida";
}
function quemAprova(por: string | null): string {
  if (por) return por;
  const g = spawnSync("git", ["config", "user.name"], { encoding: "utf8" });
  return g.status === 0 && g.stdout.trim() ? g.stdout.trim() : userInfo().username;
}
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function lerReferencias(pasta: string): Referencias | null {
  const f = join(pasta, "referencias.json");
  if (!existsSync(f)) return null;
  const r = JSON.parse(readFileSync(f, "utf8"));
  if (r.formato !== FORMATO) throw new ErroDeUso(`${f}: formato ${r.formato}, este motor lê o ${FORMATO}`);
  return r;
}

function aprovar(o: Opcoes) {
  let quadros = o.lista;
  if (!quadros) {
    const { quadros: total, qps } = o.declaracao;
    const marcos = marcosDaLinha(o.html, qps, total);
    quadros = amostrar(total, o.cada ?? Math.max(qps, Math.ceil(total / 30)), marcos);
  }
  const r = renderizar(o, quadros, o.modo);
  try {
    mkdirSync(o.referencias, { recursive: true });
    const anterior = lerReferencias(o.referencias);
    const itens: QuadroRef[] = [];
    let bytes = 0;
    for (const n of quadros) {
      const bgra = readFileSync(join(r.pasta, `motor-${n}.bgra`));
      const png = paraPng(bgra, r.largura, r.altura);
      const arquivo = `${r.modo}-${n}.png`;
      writeFileSync(join(o.referencias, arquivo), png);
      itens.push({ n, arquivo, sha256: sha256(bgra), bytes: png.length });
      bytes += png.length;
    }
    // Refazer as do mesmo modo: some o PNG que não está mais na lista.
    for (const q of anterior?.modos[r.modo]?.quadros ?? []) {
      if (!itens.some((i) => i.arquivo === q.arquivo) && existsSync(join(o.referencias, q.arquivo))) unlinkSync(join(o.referencias, q.arquivo));
    }
    const mesmaComposicao = anterior && anterior.largura === r.largura && anterior.altura === r.altura && anterior.props === "{}";
    if (anterior && !mesmaComposicao) {
      // Tamanho ou props mudaram: as do outro modo não valem mais.
      for (const m of Object.values(anterior.modos)) for (const q of m!.quadros) if (!itens.some((i) => i.arquivo === q.arquivo)) rmSync(join(o.referencias, q.arquivo), { force: true });
      avisar("tamanho ou props mudaram: as referências do outro modo foram descartadas");
    }
    const ref: Referencias = {
      formato: FORMATO, composicao: o.composicao, formatoEntrada: "linha", largura: r.largura, altura: r.altura, qps: r.qps,
      props: "{}", modos: { ...(mesmaComposicao ? anterior!.modos : {}),
        [r.modo]: { motor: versaoDoMotor(), data: new Date().toISOString(), aprovadoPor: quemAprova(o.por), quadros: itens } },
    };
    writeFileSync(join(o.referencias, "referencias.json"), `${JSON.stringify(ref, null, 2)}\n`);
    avisar(`aprovados ${quadros.length} quadros no modo ${r.modo} (${quadros.join(", ")}) em ${o.referencias} (${(bytes / 1024).toFixed(0)} KiB)`);
    return { codigo: 0, json: { ok: true, comando: "aprovar", composicao: o.composicao, modo: r.modo, pasta: o.referencias, quadros, bytes } };
  } finally { rmSync(r.tmp, { recursive: true, force: true }); }
}

function conferir(o: Opcoes) {
  const ref = lerReferencias(o.referencias);
  const modos = ref ? (Object.keys(ref.modos) as ("placa" | "cpu")[]) : [];
  if (!ref || !modos.length) throw new ErroDeUso(`sem referências em ${o.referencias}: rode antes «node cli/referencias.ts aprovar»`);
  const semModo = (m: string) => new ErroDeUso(`referências só do modo ${modos.join(" e ")} e o render é ${m}: aprovar nesse modo, ` +
    "ou --cruzado (régua cruzada: SSIM ≥ 0,997 sobre preto)");
  if (o.modo && !ref.modos[o.modo] && !o.cruzado) throw semModo(o.modo);
  // Sem modo pedido, o render escolhe: grava os quadros de todos os modos guardados.
  const pedidos = o.modo && ref.modos[o.modo] ? ref.modos[o.modo]!.quadros : modos.flatMap((m) => ref.modos[m]!.quadros);
  const quadros = [...new Set(pedidos.map((q) => q.n))].sort((a, b) => a - b);
  const t0 = performance.now();
  // Referência gravada com props (da entrada do Remotion, que saiu do motor) não se refaz pela linha do tempo.
  if (ref.props !== "{}") throw new ErroDeUso(`as referências têm props (${ref.props.slice(0, 60)}), da entrada do Remotion; ${SEM_REMOTION}`);
  const r = renderizar(o, quadros, o.modo);
  try {
    const modoRef = ref.modos[r.modo] ? r.modo : o.cruzado ? modos[0] : null;
    if (!modoRef) throw semModo(r.modo);
    const regua: Regua = modoRef === r.modo ? REGUA_R03 : REGUA_CRUZADA;
    const pastaDif = o.diferencas ?? join(CAMINHOS.raiz, "tmp", "referencias", `${o.composicao}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    const tamanhoMudou = r.largura !== ref.largura || r.altura !== ref.altura;
    let iguais = 0, dentro = 0, maiorNivel = 0, menorSsim = 1;
    const falhas: object[] = [];
    for (const q of ref.modos[modoRef]!.quadros) {
      const atual = readFileSync(join(r.pasta, `motor-${q.n}.bgra`));
      if (tamanhoMudou) { falhas.push({ n: q.n, motivo: `tamanho ${r.largura}×${r.altura}, referência ${ref.largura}×${ref.altura}` }); continue; }
      if (regua === REGUA_R03 && sha256(atual) === q.sha256) { iguais++; continue; }
      const png = readFileSync(join(o.referencias, q.arquivo));
      const referencia = dePng(png).bgra;
      if (sha256(referencia) !== q.sha256) throw new ErroDeUso(`${q.arquivo} não confere com o sha256 do referencias.json (arquivo mexido?)`);
      const d = diferenca(referencia, atual);
      if (d.pixels === 0) { iguais++; continue; }
      const s = ssim(referencia, atual, r.largura, r.altura, regua.fundo);
      maiorNivel = Math.max(maiorNivel, d.nivel); menorSsim = Math.min(menorSsim, s);
      if (dentroDaRegua({ nivel: d.nivel, ssim: s }, regua)) { dentro++; continue; }
      mkdirSync(pastaDif, { recursive: true });
      const fd = join(pastaDif, `diferenca-${q.n}.png`), fa = join(pastaDif, `atual-${q.n}.png`);
      writeFileSync(fd, paraPng(imagemDiferenca(referencia, atual), r.largura, r.altura));
      writeFileSync(fa, paraPng(atual, r.largura, r.altura));
      falhas.push({ n: q.n, nivel: d.nivel, pixels: d.pixels, ssim: s, diferenca: fd, atual: fa });
    }
    const comparados = ref.modos[modoRef]!.quadros.length, ok = falhas.length === 0;
    if (ok) avisar(`passou: ${comparados} quadros (${iguais} iguais, ${dentro} dentro da régua; maior diferença ${maiorNivel} níveis)` +
      `${modoRef !== r.modo ? `, render ${r.modo} contra referência ${modoRef} (régua cruzada)` : ""}`);
    else {
      avisar(`regressão: ${falhas.length} de ${comparados} quadros fora da régua (${regua.nivel === null ? "" : `até ${regua.nivel} níveis, `}SSIM ≥ ${regua.ssim})`);
      for (const f of falhas as any[]) avisar(f.motivo ? `  quadro ${f.n}: ${f.motivo}` :
        `  quadro ${f.n}: ${f.nivel} níveis, ${f.pixels} pixels, SSIM ${f.ssim.toFixed(6)} → ${f.diferenca}`);
    }
    return { codigo: ok ? 0 : 1, json: { ok, comando: "conferir", composicao: o.composicao, modo: r.modo, modoReferencia: modoRef, regua,
      comparados, iguais, dentroDaRegua: dentro, maiorNivel, menorSsim, falhas, diferencas: ok ? null : pastaDif,
      parede: Number(((performance.now() - t0) / 1000).toFixed(2)) } };
  } finally { rmSync(r.tmp, { recursive: true, force: true }); }
}

function principal() {
  try {
    const o = lerOpcoes(process.argv.slice(2));
    const { codigo, json } = o.comando === "aprovar" ? aprovar(o) : conferir(o);
    process.stdout.write(`${JSON.stringify(json)}\n`);
    process.exitCode = codigo;
  } catch (erro) {
    const codigo = erro instanceof ErroDeUso || erro instanceof ErroDeRender ? erro.codigo : 3;
    if (codigo === 0) { process.stdout.write(`${(erro as Error).message}\n`); return; }
    process.stderr.write(`erro: ${(erro as Error).message}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, erro: (erro as Error).message, codigo })}\n`);
    process.exitCode = codigo;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
