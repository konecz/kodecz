// Kodecz Bench (P12): rodador do modo 1. Dá o pedido e a composição de partida a um agente (Claude Code em modo não
// interativo) que só tem os documentos (a skill video-konecz, os blocos, os formatos e a marca fictícia), sem nada do
// protocolo; depois renderiza a entrega e aplica o oráculo. Uma tarefa por vez (a placa é compartilhada).
//
//   node bench/rodar.ts [--itens e1,t1] [--modelo opus] [--turnos 40] [--minutos 25] [--pasta <base>] [--so-preparar]
//                       [--teto-usd 15] [--teto-minutos 120]
//   node bench/rodar.ts --gerador [--classe K-DES-07,K-COR-01] [--area design] [--grau unico,no] [--forma classe|composta]
//                       [--casos <id>,<id>] [--amostra 50 --semente 1] [… as mesmas opções]
//
// Com --gerador, os itens são os casos do manifesto do gerador (bench-gerador/casos.jsonl, 5.075 de classe e 255
// compostos), filtrados; --amostra tira N estratificados por classe (rodízio entre as classes, ordem sorteada pela
// semente). Caso com `bloqueio` (o motor de hoje recusa) ou sem oráculo por caso (K-IA-09, métrica da rodada) é
// pulado e registrado como tal, sem contar como erro do agente.
//
// Os tetos valem para a pasta inteira (o que já está em resultados.jsonl conta): antes de cada item, se o gasto mais a
// média por item passar do teto, o rodador para. Item que já está em resultados.jsonl é pulado (retomar).
//
// A pasta da tarefa fica fora de ~/projetos (senão o agente carregaria os CLAUDE.md de lá) e sem configuração do
// usuário (--setting-sources ""), sem MCP e sem salvar sessão. Grava em <base>/: uma pasta por item (a tarefa, o
// transcript em stream-json) e resultados.jsonl (uma linha por item).
import { spawn } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { avaliar } from "./avaliar.ts";
import { RAIZ, TRAVA_PLACA } from "./coletar.ts";
import { ITENS, type Item } from "./itens.ts";
import { compostaParaItem, paraItem, type ItemGerado } from "../bench-gerador/adaptador.ts";
import { montarComposta, type Composta } from "../bench-gerador/compostas.ts";
import { lerManifesto, type Caso } from "../bench-gerador/expandir.ts";
import { lerEspecificacoes } from "../bench-gerador/provas.ts";
import { mesmice } from "../bench-gerador/mesmice.ts";

/** Gerador pseudoaleatório com semente (mulberry32). */
function sorteio(semente: number) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export type Filtro = { classe?: string[]; area?: string[]; grau?: string[]; forma?: string; casos?: string[]; amostra?: number; semente?: number };
/** Os casos do manifesto do gerador que passam no filtro; com amostra, N estratificados por classe. */
export function casosDoGerador(f: Filtro, manifesto: (Caso | Composta)[] = lerManifesto()): (Caso | Composta)[] {
  const classesDe = (c: Caso | Composta) => c.forma === "classe" ? [c.classe] : c.classes;
  let l = manifesto.filter((c) => (!f.forma || c.forma === f.forma) && (!f.casos || f.casos.includes(c.id))
    && (!f.classe || classesDe(c).some((x) => f.classe!.includes(x))) && (!f.grau || f.grau.includes(c.grau))
    && (!f.area || (c.forma === "classe" ? f.area.includes(c.area) : f.area.includes("composta"))));
  if (f.amostra && f.amostra < l.length) {
    const r = sorteio(f.semente ?? 1), grupos = new Map<string, (Caso | Composta)[]>();
    for (const c of l) { const k = c.forma === "classe" ? c.classe : "composta"; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(c); }
    const listas = [...grupos.values()].map((g) => g.map((c) => [r(), c] as const).sort((a, b) => a[0] - b[0]).map(([, c]) => c));
    const ordem = listas.map((_, i) => [r(), i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    const saida: (Caso | Composta)[] = [];
    for (let k = 0; saida.length < f.amostra; k++) for (const i of ordem) { if (listas[i][k] && saida.length < f.amostra) saida.push(listas[i][k]); }
    l = saida;
  }
  return l;
}
export function itensDoGerador(f: Filtro): ItemGerado[] {
  const es = lerEspecificacoes();
  return casosDoGerador(f).map((c) => c.forma === "classe" ? paraItem(c, es) : compostaParaItem(montarComposta(c)));
}

const LEIAME = `# Tarefa

O pedido está em \`PEDIDO.md\`. A entrega fica em \`saida/\`: a composição em linha do tempo declarada
(\`docs/formatos/linha-do-tempo.md\`), com o \`index.html\` e o material dela, salvo se o pedido disser outra coisa.

Documentos:

- \`docs/video-konecz/SKILL.md\`: o jeito Konecz de fazer vídeo por código (regras G01…).
- \`docs/blocos/\`: os blocos prontos (\`INDICE.md\`), cada um com o \`KODECZ.md\`.
- \`docs/formatos/\`: os formatos do motor (linha do tempo, conferência, prévia, DESIGN.md).
- \`marca/\`: a identidade da marca (fictícia).

Comandos do motor. Onde os documentos dizem \`node cli/<comando>.ts\`, use \`./motor <comando>\` com os mesmos
argumentos:

    ./motor previa <pasta> <id> --quadro 0,45,120     quadros soltos em PNG em previa/ (o mesmo pixel do render)
    ./motor render <pasta> <id> <saida.mp4>          o vídeo (na placa)
    ./motor conferir <pasta> <id>                    a conferência automática (rosto, legenda, zoom)
`;

const PROMPT = "Leia LEIAME.md e PEDIDO.md e faça o que o pedido pede. Trabalhe só dentro desta pasta. Quando terminar, responda com um resumo curto do que fez.";

/** A pasta da tarefa: o material do item, os documentos do modo 1 e o comando ./motor. */
export function montarTarefa(item: Item, t: string) {
  mkdirSync(join(t, "saida"), { recursive: true });
  item.preparar(t);
  writeFileSync(join(t, "PEDIDO.md"), `# Pedido\n\n${item.pedido}\n`);
  writeFileSync(join(t, "LEIAME.md"), LEIAME);
  mkdirSync(join(t, "docs", "video-konecz"), { recursive: true });
  cpSync(join(RAIZ, ".claude", "skills", "video-konecz", "SKILL.md"), join(t, "docs", "video-konecz", "SKILL.md"));
  cpSync(join(RAIZ, "blocos"), join(t, "docs", "blocos"), { recursive: true, filter: (f) => !f.endsWith(".test.ts") });
  mkdirSync(join(t, "docs", "formatos"), { recursive: true });
  for (const f of ["linha-do-tempo.md", "conferencia.md", "previa.md", "design-md.md"]) cpSync(join(RAIZ, "docs", "formatos", f), join(t, "docs", "formatos", f));
  cpSync(join(RAIZ, "identidade", "fixtures", "marca-ficticia"), join(t, "marca"), { recursive: true });
  const motor = `#!/bin/sh
# O motor de vídeo: ./motor previa|render|conferir <argumentos de cli/<comando>.ts>
cmd=$1; shift
case "$cmd" in
  render) exec flock -s ${TRAVA_PLACA} node ${RAIZ}/cli/render.ts "$@" ;;
  previa) case " $* " in *" --saida "*) ;; *) set -- "$@" --saida "$(pwd)/previa" ;; esac
          exec flock -s ${TRAVA_PLACA} node ${RAIZ}/cli/previa.ts "$@" ;;
  conferir) exec node ${RAIZ}/cli/conferir.ts "$@" ;;
  *) echo "uso: ./motor previa|render|conferir …" >&2; exit 2 ;;
esac
`;
  writeFileSync(join(t, "motor"), motor);
  chmodSync(join(t, "motor"), 0o755);
}

type Execucao = { custo: number | null; turnos: number | null; segundos: number; fim: string; ferramentas: number; motor: Record<string, number>;
  contaminado: string[]; resposta: string };

/** O que o transcript (stream-json) diz: custo, turnos, ferramentas, chamadas do motor e contaminação. */
function lerTranscript(linhas: string[], segundos: number, fim: string): Execucao {
  const ex: Execucao = { custo: null, turnos: null, segundos, fim, ferramentas: 0, motor: { previa: 0, render: 0, conferir: 0 }, contaminado: [], resposta: "" };
  let duracao = 0;
  for (const l of linhas) {
    let m: any;
    try { m = JSON.parse(l); } catch { continue; }
    if (m.type === "assistant") {
      for (const c of m.message?.content ?? []) {
        if (c.type !== "tool_use") continue;
        ex.ferramentas++;
        const entrada = JSON.stringify(c.input ?? {});
        for (const k of Object.keys(ex.motor)) if (new RegExp(`motor ${k}\\b|cli/${k}\\.ts`).test(entrada)) ex.motor[k]++;
        // O agente olhou o bench (soluções e oráculos), o protocolo ou a memória dos projetos: a rodada não vale como modo 1.
        // (A pasta de sessão da própria tarefa, onde o Claude Code guarda saída longa, não conta.)
        for (const proibido of [`${RAIZ}/bench`, "motor-video/bench", "/bench/", "oraculos", "itens.ts", "sonda.js", "p12-protocolo", `/.claude/projects/${homedir().replaceAll("/", "-")}-projetos`]) {
          if (entrada.includes(proibido) && !ex.contaminado.includes(proibido)) ex.contaminado.push(proibido);
        }
      }
    }
    if (m.type === "result") {
      // Com tarefa em segundo plano, a sessão volta depois e solta outro «result»: o custo é acumulado (fica o maior),
      // os turnos e a duração são de cada trecho (somam).
      ex.custo = Math.max(ex.custo ?? 0, m.total_cost_usd ?? 0);
      ex.turnos = (ex.turnos ?? 0) + (m.num_turns ?? 0);
      ex.fim = m.subtype ?? ex.fim;
      ex.resposta = String(m.result ?? "").slice(0, 400);
      if (!segundos) duracao += m.duration_ms ?? 0;
    }
  }
  if (!segundos) ex.segundos = Math.round(duracao / 1000);
  return ex;
}

/** O agente na pasta da tarefa; o transcript (stream-json) vai para `log`. */
function rodarAgente(t: string, log: string, o: { modelo: string; turnos: number; minutos: number }): Promise<Execucao> {
  const args = ["-p", PROMPT, "--model", o.modelo, "--max-turns", String(o.turnos), "--output-format", "stream-json", "--verbose",
    "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence",
    "--allowedTools", "Bash", "Read", "Write", "Edit", "Glob", "Grep",
    "--disallowedTools", "Agent", "Task", "WebFetch", "WebSearch", "Skill", "NotebookEdit"];
  const t0 = performance.now();
  return new Promise((ok) => {
    const p = spawn("claude", args, { cwd: t, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } });
    let resto = "";
    const linhas: string[] = [];
    p.stdout.on("data", (b) => {
      appendFileSync(log, b);
      resto += b.toString();
      const partes = resto.split("\n");
      resto = partes.pop()!;
      linhas.push(...partes.filter(Boolean));
    });
    p.stderr.on("data", (b) => appendFileSync(`${log}.stderr`, b));
    const relogio = setTimeout(() => p.kill("SIGTERM"), o.minutos * 60_000);
    p.on("close", (codigo) => {
      clearTimeout(relogio);
      if (resto) linhas.push(resto);
      ok(lerTranscript(linhas, +((performance.now() - t0) / 1000).toFixed(0), `saiu ${codigo}`));
    });
  });
}

async function principal() {
  const { values: v } = parseArgs({ options: {
    itens: { type: "string" }, modelo: { type: "string", default: "opus" }, turnos: { type: "string", default: "40" },
    minutos: { type: "string", default: "25" }, pasta: { type: "string" }, "so-preparar": { type: "boolean" },
    "teto-usd": { type: "string", default: "15" }, "teto-minutos": { type: "string", default: "120" },
    gerador: { type: "boolean" }, classe: { type: "string" }, area: { type: "string" }, grau: { type: "string" }, forma: { type: "string" },
    casos: { type: "string" }, amostra: { type: "string" }, semente: { type: "string" },
  } });
  const lista = (x?: string) => x?.split(",").filter(Boolean);
  const so = lista(v.itens);
  const itens: (Item & Partial<ItemGerado>)[] = v.gerador
    ? itensDoGerador({ classe: lista(v.classe), area: lista(v.area), grau: lista(v.grau), forma: v.forma, casos: lista(v.casos),
      amostra: v.amostra ? Number(v.amostra) : undefined, semente: v.semente ? Number(v.semente) : undefined })
    : so ? ITENS.filter((i) => so.some((p) => i.id.startsWith(p))) : ITENS;
  const base = resolve(v.pasta ?? join(tmpdir(), "kodecz-bench", new Date().toISOString().replace(/[:.]/g, "-")));
  if (base.startsWith(join(homedir(), "projetos"))) throw new Error(`a pasta das tarefas não pode ficar em ~/projetos (CLAUDE.md de lá): ${base}`);
  mkdirSync(base, { recursive: true });
  const resultados = join(base, "resultados.jsonl");
  process.stderr.write(`kodecz-bench: ${itens.length} itens, modelo ${v.modelo}, em ${base}\n`);
  const feitos = () => (existsSync(resultados) ? readFileSync(resultados, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  for (const item of itens) {
    const ja = feitos();
    if (ja.some((l) => l.item === item.id)) { process.stderr.write(`  ${item.id}: já rodado, pulado\n`); continue; }
    if (item.bloqueio || item.semOraculo) {
      process.stderr.write(`  ${item.id}: pulado (${item.bloqueio ?? item.semOraculo})\n`);
      if (!v["so-preparar"]) appendFileSync(resultados, `${JSON.stringify({ item: item.id, pulado: item.bloqueio ?? item.semOraculo, custo: 0, segundos: 0, oraculo: { status: "pulado", segundos: 0 } })}\n`);
      continue;
    }
    if (ja.length && !v["so-preparar"]) {
      const custo = ja.reduce((s, l) => s + (l.custo ?? 0), 0), minutos = ja.reduce((s, l) => s + l.segundos + l.oraculo.segundos, 0) / 60;
      if (custo + custo / ja.length > Number(v["teto-usd"]) || minutos + minutos / ja.length > Number(v["teto-minutos"])) {
        process.stderr.write(`kodecz-bench: parado antes de ${item.id}: US$ ${custo.toFixed(2)} e ${minutos.toFixed(0)} min gastos; o próximo passaria do teto\n`);
        break;
      }
    }
    const dir = join(base, item.id), t = join(dir, "tarefa"), log = join(dir, "transcript.jsonl");
    let ex: Execucao;
    // Retomar: o agente já terminou (o transcript tem o resultado), só falta o oráculo.
    const anterior = existsSync(log) ? readFileSync(log, "utf8").split("\n") : [];
    if (anterior.some((l) => { try { return JSON.parse(l).type === "result"; } catch { return false; } })) {
      ex = lerTranscript(anterior, 0, "retomado");
      process.stderr.write(`  ${item.id}: agente já rodado (retomado); oráculo…\n`);
    } else {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      montarTarefa(item, t);
      if (v["so-preparar"]) { process.stderr.write(`  ${item.id}: preparada em ${t}\n`); continue; }
      process.stderr.write(`  ${item.id}: agente…\n`);
      ex = await rodarAgente(t, log, { modelo: v.modelo!, turnos: Number(v.turnos), minutos: Number(v.minutos) });
    }
    process.stderr.write(`  ${item.id}: ${ex.fim}, ${ex.turnos} turnos, US$ ${ex.custo?.toFixed(2)}, ${ex.segundos} s; oráculo…\n`);
    const av = await avaliar(item, t, { renderSempre: true });
    const linha = { item: item.id, categoria: item.categoria, ...(item.classe ? { classe: item.classe, grau: item.grau, esperado: item.esperado } : {}),
      ...(item.aviso ? { aviso: true } : {}), modo: 1, modelo: v.modelo, ...ex, oraculo: av };
    appendFileSync(resultados, `${JSON.stringify(linha)}\n`);
    process.stderr.write(`  ${item.id}: ${av.status} — ${av.motivo}${ex.contaminado.length ? ` (CONTAMINADO: ${ex.contaminado.join(", ")})` : ""}\n`);
  }
  if (existsSync(resultados)) {
    const todas = readFileSync(resultados, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    // Rodada contaminada (o agente viu o bench, o protocolo ou a memória) não conta como modo 1.
    const validas = todas.filter((l) => !l.contaminado?.length && !l.pulado);
    // Classes de aviso (os rótulos do responsável, 2026-11-01): somadas à parte, fora da nota.
    const ls = validas.filter((l) => !l.aviso), avisos = validas.filter((l) => l.aviso);
    const custo = validas.reduce((s, l) => s + (l.custo ?? 0), 0), tempo = validas.reduce((s, l) => s + l.segundos + l.oraculo.segundos, 0);
    const avisosPorClasse: Record<string, number> = {};
    for (const l of avisos) if (l.oraculo.status === "erro") avisosPorClasse[l.classe] = (avisosPorClasse[l.classe] ?? 0) + 1;
    process.stdout.write(`${JSON.stringify({ itens: ls.length, pulados: todas.filter((l) => l.pulado).length, contaminados: todas.filter((l) => l.contaminado?.length).length, erros: ls.filter((l) => l.oraculo.status === "erro").length,
      certos: ls.filter((l) => l.oraculo.status === "certo").length, naoConferiveis: ls.filter((l) => l.oraculo.status === "nao-conferivel").length,
      avisos: { itens: avisos.length, acusados: avisos.filter((l) => l.oraculo.status === "erro").length, porClasse: avisosPorClasse },
      custo: +custo.toFixed(2), minutos: +(tempo / 60).toFixed(1),
      // K-IA-09 (mesmice): métrica da rodada, a semelhança média entre as entregas do mesmo agente.
      mesmice: mesmice(validas.map((l) => join(base, l.item, "tarefa", "saida", "index.html")).filter((f) => existsSync(f))), resultados })}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
