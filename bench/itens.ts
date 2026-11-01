// Kodecz Bench (P12): o catálogo. Um item por erro real dos vídeos feitos com o Remotion, recriado com conteúdo
// inventado (R01: a marca fictícia Zunzum, falas e tempos fictícios, o retrato de domínio público dos testes do S04 como
// apresentador). Cada item tem:
//   pedido   — em linguagem natural, do jeito que levou ao erro, sem dizer qual é a armadilha;
//   preparar — a pasta da tarefa: a composição de partida em saida/ (linha do tempo declarada) e o material;
//   errada, certa — as soluções escritas à mão (o erro e o jeito certo), sobre a pasta preparada;
//   oraculo  — a checagem automática do erro (bench/oraculos.ts).
// Os erros fora do bench automático (gosto, geração da mídia, ambiente, motor) estão em FORA, com o motivo.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { escrever, falar, falasJs, gerarApresentador, RETRATO, gerarClipe, gerarImagem, gerarVoz, LOGO_NOVO, LOGO_VELHO, CORES_VELHAS, pagina, QPS,
  type Caixa, type Palavra } from "./molde.ts";
import * as O from "./oraculos.ts";
import { renderizar } from "./coletar.ts";

export type Categoria = "espaço" | "tempo da fala" | "movimento" | "contexto" | "cobertura";
export type Item = {
  id: string; categoria: Categoria; erro: string; regra: string;
  pedido: string;
  /** O que o oráculo precisa: a geometria (coleta do S04), o render da composição, ou o MP4 que o agente entregou. */
  precisa: { geometria: boolean; render: boolean; mp4Entregue?: string };
  preparar(tarefa: string): void;
  errada(tarefa: string): void;
  certa(tarefa: string): void;
  oraculo(d: O.Dados): O.Resultado;
  /** Áudio de referência gerado de novo na hora de conferir (o agente pode mexer nos arquivos da tarefa). */
  referencia?(pasta: string): Record<string, string>;
};

const q = (s: number) => Math.round(s * QPS);
const segundos = (falas: Palavra[], folga = 0.8) => Math.ceil((falas.at(-1)!.fim + folga) * 2) / 2;
const html = (t: string) => join(t, "saida", "index.html");
const ler = (t: string) => readFileSync(html(t), "utf8");
/** Troca um trecho da partida (tem de existir uma vez só). */
function trocar(t: string, de: string, para: string) {
  const s = ler(t);
  if (s.split(de).length !== 2) throw new Error(`trecho não achado uma vez em ${html(t)}: ${de.slice(0, 60)}`);
  writeFileSync(html(t), s.replace(de, para));
}
const fraseTxt = (falas: Palavra[]) => O.frases(falas.map((f) => ({ ...f })));
const indice = (falas: Palavra[], prefixo: string, depoisDe = -1) => {
  const i = falas.findIndex((f, j) => j > depoisDe && f.t.toLowerCase().startsWith(prefixo.toLowerCase()));
  if (i < 0) throw new Error(`palavra ${prefixo} não está na fala`);
  return i;
};

/** Ajuda da página, igual em toda partida: quadros por segundo e o «mostrar» (duas animações de duração zero). */
const AJUDA = `const Q = ${QPS};
const q = (s) => Math.round(s * Q);
// Mostra o elemento do quadro «de» ao quadro «ate» (duas animações de duração zero; a de depois vence).
function mostrar(el, de, ate) {
  el.animate([{ opacity: 0 }, { opacity: 1 }], { delay: (de * 1000) / Q, duration: 1, fill: 'forwards' });
  if (ate !== undefined) el.animate([{ opacity: 1 }, { opacity: 0 }], { delay: (ate * 1000) / Q, duration: 1, fill: 'forwards' });
}
for (const el of document.querySelectorAll('[data-de]')) mostrar(el, Number(el.dataset.de), el.dataset.ate ? Number(el.dataset.ate) : undefined);`;

/** Uma legenda por frase (ou por pedaço), com os quadros de entrada e saída. */
const legendas = (pedacos: { texto: string; de: number; ate: number }[]) =>
  pedacos.map((p) => `<div class="legenda" data-papel="legenda" data-de="${p.de}" data-ate="${p.ate}">${p.texto}</div>`).join("\n");
const legendasPorFrase = (falas: Palavra[]) => legendas(fraseTxt(falas).map((f) => ({ texto: f.texto, de: q(f.ini), ate: q(f.fim + 0.3) })));

function escreverFala(t: string, falas: Palavra[], segundosTotal: number, comAudio = true) {
  writeFileSync(join(t, "saida", "tempos.json"), JSON.stringify(falas, null, 1) + "\n");
  writeFileSync(join(t, "saida", "roteiro.md"), `# Roteiro\n\n${fraseTxt(falas).map((f) => f.texto).join("\n\n")}\n`);
  if (comAudio) gerarVoz(join(t, "saida", "midia", "voz.wav"), falas, { segundos: segundosTotal });
}

// ——— Cenas com o apresentador ———

type Ap = { escala: number; x: number };
/** A caixa do rosto no vídeo do apresentador com o retrato em escala e posição `ap`. */
const rostoDe = (ap: Ap): Caixa => [RETRATO.rosto[0] * ap.escala + ap.x, RETRATO.rosto[1] * ap.escala, RETRATO.rosto[2] * ap.escala, RETRATO.rosto[3] * ap.escala];
const V = { largura: 810, altura: 1440 }, AP_V: Ap = { escala: 1.6, x: -297 }, ROSTO_V = rostoDe(AP_V);
const H = { largura: 960, altura: 540 }, AP_H: Ap = { escala: 0.6, x: 264 };
const CSS_TAKE = `  .palco { position: absolute; inset: 0; overflow: hidden; }
  .take { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }
  .legenda { position: absolute; left: 0; right: 0; text-align: center; color: #fff; font: 700 40px "DejaVu Sans", sans-serif;
             white-space: nowrap; text-shadow: 0 2px 8px rgba(0, 0, 0, .7); opacity: 0; }
  .faixa { position: absolute; color: #fff; background: #2E86AB; font: 700 30px "DejaVu Sans", sans-serif; padding: 10px 24px;
           border-radius: 12px; white-space: nowrap; opacity: 0; }`;

function cenaApresentador(t: string, o: { id: string; dim: { largura: number; altura: number }; ap: Ap; falas: Palavra[]; css: string; corpo: string;
  titulo: string; logo?: Caixa; origem?: { largura: number; altura: number }; take?: string; script?: string }) {
  const seg = segundos(o.falas);
  const origem = o.origem ?? o.dim;
  mkdirSync(join(t, "saida", "midia"), { recursive: true });
  gerarApresentador(join(t, "saida", "midia", o.take ?? "apresentador.mp4"), { ...origem, segundos: seg, ...o.ap, logo: o.logo });
  escreverFala(t, o.falas, seg);
  writeFileSync(html(t), pagina({ id: o.id, ...o.dim, quadros: q(seg), titulo: o.titulo, css: `${CSS_TAKE}\n${o.css}`,
    corpo: `${o.corpo}\n<audio src="midia/voz.wav" data-inicio="0"></audio>`, script: `${falasJs(o.falas)}\n${AJUDA}\n${o.script ?? ""}` }));
}

const TAKE_V = `<div class="palco"><video class="take" data-papel="apresentador" src="midia/apresentador.mp4" muted></video></div>`;
const TAKE_H = TAKE_V;

// A faixa vem antes do palco no DOM só por conveniência da troca; o z-index a põe por cima.
const FAIXA_POR_CIMA = "  .faixa { z-index: 2; }\n";

// E1: faixa no rosto no 9:16.
const FALA_E1 = falar(["Cada grão tem história.", "Torramos devagar."]);
const e1: Item = {
  id: "e1-faixa-no-rosto", categoria: "espaço", regra: "G15", erro: "faixa no alto do 9:16 em tela cheia, sobre o rosto do apresentador",
  pedido: "Falta a faixa com o tema do bloco, «Café de origem», nesta versão vertical. Ela aparece junto com a fala e fica até o fim.",
  precisa: { geometria: true, render: false },
  preparar: (t) => cenaApresentador(t, { id: "CafeVertical", titulo: "Café de origem (vertical)", dim: V, ap: AP_V, falas: FALA_E1,
    css: `${FAIXA_POR_CIMA}  .legenda { top: 820px; }`, corpo: `${TAKE_V}\n${legendasPorFrase(FALA_E1)}` }),
  errada: (t) => trocar(t, `<div class="palco">`, `<div class="faixa" data-papel="faixa" data-de="${q(FALA_E1[0].ini)}" style="left: 40px; top: 200px;">Café de origem</div>\n<div class="palco">`),
  certa: (t) => trocar(t, `<div class="palco">`, `<div class="faixa" data-papel="faixa" data-de="${q(FALA_E1[0].ini)}" style="left: 50%; top: 740px; translate: -50% 0;">Café de origem</div>\n<div class="palco">`),
  oraculo: O.rostoLivre({ midia: "apresentador", origem: [V.largura, V.altura], rosto: ROSTO_V }),
};

// E2: legenda em duas linhas no 9:16.
const FALA_E2 = falar(["Cada grão que chega aqui passa por três provas de sabor.", "Só o que passa nas três vira o nosso café."]);
const pedacosE2 = () => {
  // Pedaços curtos (até 20 letras), pontuação fecha o pedaço, palavra fraca desce para o seguinte.
  const fracas = new Set(["que", "por", "de", "o", "a", "nas", "nosso"]);
  const r: { texto: string; de: number; ate: number }[] = [];
  let atual: Palavra[] = [];
  const fechar = () => { if (atual.length) r.push({ texto: atual.map((p) => p.t).join(" "), de: q(atual[0].ini), ate: q(atual.at(-1)!.fim + 0.05) }); atual = []; };
  for (const p of FALA_E2) {
    const texto = [...atual, p].map((x) => x.t).join(" ");
    if (texto.length > 20) {
      const ultima = atual.at(-1);
      if (ultima && fracas.has(ultima.t.toLowerCase()) && atual.length > 1) { atual.pop(); fechar(); atual = [ultima]; } else fechar();
    }
    atual.push(p);
    if (/[.!?,]$/.test(p.t)) fechar();
  }
  fechar();
  return r;
};
const e2: Item = {
  id: "e2-legenda-duas-linhas", categoria: "espaço", regra: "G17", erro: "legenda com número fixo de palavras quebrando em duas linhas no 9:16",
  pedido: "Ponha a legenda da fala nesta versão vertical, sincronizada com os tempos de saida/tempos.json (o texto está em saida/roteiro.md). Use o estilo .legenda que já está no CSS.",
  precisa: { geometria: true, render: false },
  preparar: (t) => cenaApresentador(t, { id: "ProvasVertical", titulo: "Três provas (vertical)", dim: V, ap: AP_V, falas: FALA_E2,
    css: `${FAIXA_POR_CIMA}  .legenda { top: 820px; left: 40px; right: 40px; white-space: normal; }`,
    corpo: `<div class="faixa" data-papel="faixa" data-de="0" style="left: 50%; top: 740px; translate: -50% 0;">Três provas</div>\n${TAKE_V}` }),
  errada: (t) => trocar(t, `${TAKE_V}`, `${TAKE_V}\n${legendasPorFrase(FALA_E2)}`),
  certa: (t) => trocar(t, `${TAKE_V}`, `${TAKE_V}\n${legendas(pedacosE2())}`),
  oraculo: O.legendaUmaLinha(),
};

// E3 e E4: faixa e legenda em eixos diferentes (16:9 e 9:16).
const FALA_E3 = falar(["A torra média realça o doce.", "É a nossa preferida."]);
const e3: Item = {
  id: "e3-eixos-16x9", categoria: "espaço", regra: "G16", erro: "faixa no canto inferior esquerdo e legenda centralizada (16:9)",
  pedido: "Acrescente um lower third (faixa) com o tema «Torra média» neste vídeo.",
  precisa: { geometria: true, render: false },
  preparar: (t) => cenaApresentador(t, { id: "TorraMedia", titulo: "Torra média", dim: H, ap: AP_H, falas: FALA_E3,
    css: `${FAIXA_POR_CIMA}  .legenda { top: 470px; font-size: 32px; }`, corpo: `${TAKE_H}\n${legendasPorFrase(FALA_E3)}` }),
  errada: (t) => trocar(t, `<div class="palco">`, `<div class="faixa" data-papel="faixa" data-de="0" style="left: 32px; top: 396px; font-size: 24px;">Torra média</div>\n<div class="palco">`),
  certa: (t) => trocar(t, `<div class="palco">`, `<div class="faixa" data-papel="faixa" data-de="0" style="left: 50%; top: 412px; translate: -50% 0; font-size: 22px; padding: 6px 18px;">Torra média</div>\n<div class="palco">`),
  oraculo: O.mesmoEixo(),
};
const FALA_E4 = falar(["A torra média realça o doce.", "É a preferida."]);
const e4: Item = {
  id: "e4-eixos-9x16", categoria: "espaço", regra: "G16", erro: "faixa à esquerda, fora do eixo da legenda (9:16)",
  pedido: "Acrescente a faixa com o tema «Torra média» nesta versão vertical.",
  precisa: { geometria: true, render: false },
  preparar: (t) => cenaApresentador(t, { id: "TorraMediaVertical", titulo: "Torra média (vertical)", dim: V, ap: AP_V, falas: FALA_E4,
    css: `${FAIXA_POR_CIMA}  .legenda { top: 860px; }`, corpo: `${TAKE_V}\n${legendasPorFrase(FALA_E4)}` }),
  errada: (t) => trocar(t, `<div class="palco">`, `<div class="faixa" data-papel="faixa" data-de="0" style="left: 48px; top: 770px;">Torra média</div>\n<div class="palco">`),
  certa: (t) => trocar(t, `<div class="palco">`, `<div class="faixa" data-papel="faixa" data-de="0" style="left: 50%; top: 776px; translate: -50% 0;">Torra média</div>\n<div class="palco">`),
  oraculo: O.mesmoEixo(),
};

// E5: meia logo na borda ao recortar o take horizontal para o vertical.
const TAKE_169 = { largura: 1280, altura: 720 }, AP_169: Ap = { escala: 0.8, x: 352 }, LOGO_169: Caixa = [780, 60, 160, 80];
const FALA_E5 = falar(["Aqui a torra é feita à mão."]);
const e5: Item = {
  id: "e5-meia-logo", categoria: "espaço", regra: "G23", erro: "logo do fundo do take cortada pela metade na borda do 9:16",
  pedido: "Monte a versão vertical (810×1440) com o take horizontal saida/midia/take.mp4 em tela cheia, atrás da legenda.",
  precisa: { geometria: true, render: false },
  preparar: (t) => cenaApresentador(t, { id: "TorraVertical", titulo: "Torra à mão (vertical)", dim: V, ap: AP_169, logo: LOGO_169, origem: TAKE_169,
    take: "take.mp4", falas: FALA_E5, css: "  .legenda { top: 860px; }", corpo: `<div class="palco"></div>\n${legendasPorFrase(FALA_E5)}` }),
  errada: (t) => trocar(t, `<div class="palco"></div>`, `<div class="palco"><video class="take" data-papel="apresentador" src="midia/take.mp4" muted></video></div>`),
  certa: (t) => trocar(t, `<div class="palco"></div>`, `<div class="palco"><video class="take" data-papel="apresentador" src="midia/take.mp4" muted style="object-position: 61.71% 50%;"></video></div>`),
  oraculo: O.logoInteira({ midia: "take", origem: [TAKE_169.largura, TAKE_169.altura], logo: LOGO_169 }),
};

// E6: fonte fina e clara sobre céu claro.
const e6: Item = {
  id: "e6-fonte-fina-ceu", categoria: "espaço", regra: "G20", erro: "título serifado fino e branco sobre céu claro, sem contraste",
  pedido: "Escreva o título «Manhã de torra» em branco sobre a imagem do céu, num estilo elegante, com a serifada da marca (DejaVu Serif). Ele entra com a cena e fica até o fim.",
  precisa: { geometria: true, render: true },
  preparar: (t) => {
    gerarImagem(join(t, "saida", "midia", "ceu.png"), { ...H, c0: "0xbcd8f0", c1: "0xf4f8ff" });
    writeFileSync(html(t), pagina({ id: "ManhaDeTorra", ...H, quadros: 90, titulo: "Manhã de torra",
      css: `  .ceu { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }\n  .titulo { position: absolute; left: 0; right: 0; top: 200px; text-align: center; opacity: 0; }`,
      corpo: `<img class="ceu" src="midia/ceu.png" alt="">\n<!-- o título entra aqui -->`, script: AJUDA }));
  },
  errada: (t) => trocar(t, "<!-- o título entra aqui -->", `<div class="titulo" data-de="6" style="font: 300 72px 'DejaVu Serif', serif; color: #fff; letter-spacing: 0.04em;">Manhã de torra</div>`),
  certa: (t) => trocar(t, "<!-- o título entra aqui -->", `<div class="titulo" data-de="6"><span style="display: inline-block; font: 700 72px 'DejaVu Serif', serif; color: #fff; padding: 12px 36px; border-radius: 16px; background: rgba(27, 31, 42, 0.72);">Manhã de torra</span></div>`),
  oraculo: O.contraste({ texto: "Manhã de torra" }),
};

// E7: legenda na zona da base do Reels.
const FALA_E7 = falar(["Peça o seu pacote hoje.", "Chega fresquinho."]);
const e7: Item = {
  id: "e7-legenda-zona-base", categoria: "espaço", regra: "G19", erro: "legenda na faixa de baixo do Reels, que a interface cobre",
  pedido: "Isto é um Reels. Ponha a legenda da fala embaixo (o texto está em saida/roteiro.md e os tempos em saida/tempos.json).",
  precisa: { geometria: true, render: false },
  preparar: (t) => cenaApresentador(t, { id: "PecaHoje", titulo: "Peça hoje (Reels)", dim: V, ap: AP_V, falas: FALA_E7,
    css: FAIXA_POR_CIMA, corpo: `<div class="faixa" data-papel="faixa" data-de="0" style="left: 50%; top: 680px; translate: -50% 0;">Entrega na semana</div>\n${TAKE_V}` }),
  errada: (t) => trocar(t, `${TAKE_V}`, `${TAKE_V}\n${legendasPorFrase(FALA_E7).replaceAll('class="legenda"', 'class="legenda" style="bottom: 120px;"')}`),
  certa: (t) => trocar(t, `${TAKE_V}`, `${TAKE_V}\n${legendasPorFrase(FALA_E7).replaceAll('class="legenda"', 'class="legenda" style="top: 770px;"')}`),
  oraculo: O.zonaSegura(),
};

// T1: zoom de duração fixa cortando a frase.
const FALA_T1 = falar(["Cada grão passa por três provas antes de chegar à sua xícara.", "Depois, a torra."]);
const zoomT1 = (ate: number) => {
  const de = q(FALA_T1[indice(FALA_T1, "três")].ini), N = q(segundos(FALA_T1));
  const k = (n: number, s: number) => `{ transform: 'scale(${s})', offset: ${(n / N).toFixed(6)} }`;
  return `document.querySelector('.take').animate([${k(0, 1)}, ${k(de, 1)}, ${k(de + 4, 1.2)}, ${k(ate, 1.2)}, ${k(ate + 4, 1)}, ${k(N, 1)}],
  { duration: (${N} * 1000) / Q, fill: 'both' });`;
};
const t1: Item = {
  id: "t1-zoom-corta-frase", categoria: "tempo da fala", regra: "G21", erro: "punch-in de duração fixa que volta no meio da frase",
  pedido: "Dê um zoom de ênfase (punch-in) no apresentador na palavra «três».",
  precisa: { geometria: true, render: false },
  preparar: (t) => cenaApresentador(t, { id: "TresProvas", titulo: "Três provas", dim: H, ap: AP_H, falas: FALA_T1,
    css: "  .take { transform-origin: 527px 147px; }\n  .legenda { top: 470px; font-size: 26px; }", corpo: `${TAKE_H}\n${legendasPorFrase(FALA_T1)}`,
    script: "// efeitos\n" }),
  errada: (t) => trocar(t, "// efeitos\n", `// efeitos\n${zoomT1(q(FALA_T1[indice(FALA_T1, "três")].ini) + 4 + 30)}\n`),
  certa: (t) => {
    const fim = FALA_T1[indice(FALA_T1, "xícara")].fim;
    trocar(t, "// efeitos\n", `// efeitos\n${zoomT1(q(fim))}\n`);
  },
  oraculo: O.zoomAteOFimDaFrase(),
};

// T2: bloco de voz cortado pelo fim da palavra do Whisper.
const BLOCOS_T2 = [
  { nome: "bloco1", freq: 220, falas: falar(["A torra começa cedo."], { inicio: 0.3 }) },
  { nome: "bloco2", freq: 330, falas: falar(["E termina no ponto certo."], { inicio: 0.3, bloco: 2 }) },
];
const WHISPER_CORTA = 0.25;
const t2: Item = {
  id: "t2-bloco-whisper", categoria: "tempo da fala", regra: "G09", erro: "bloco cortado no fim da palavra do Whisper, comendo o fim da voz",
  pedido: "Monte o áudio deste vídeo: os dois blocos de voz (saida/voz/bloco1.wav e saida/voz/bloco2.wav), um depois do outro, cortando o silêncio que sobra no fim de cada bloco. Os tempos das palavras (do Whisper) estão em saida/voz/tempos.json. Ajuste a duração da composição ao fim da fala.",
  precisa: { geometria: false, render: true },
  preparar: (t) => {
    const tempos: Record<string, Palavra[]> = {};
    for (const b of BLOCOS_T2) {
      gerarVoz(join(t, "saida", "voz", `${b.nome}.wav`), b.falas, { segundos: b.falas.at(-1)!.fim + 1.5, freq: b.freq });
      tempos[b.nome] = b.falas.map((f, i, a) => (i === a.length - 1 ? { ...f, fim: +(f.fim - WHISPER_CORTA).toFixed(3) } : f));
    }
    writeFileSync(join(t, "saida", "voz", "tempos.json"), JSON.stringify(tempos, null, 1) + "\n");
    writeFileSync(html(t), pagina({ id: "TorraCedo", ...H, quadros: 150, titulo: "Torra cedo",
      css: "  .cartela { position: absolute; inset: 0; display: grid; place-items: center; color: #F7F4EC; font: 700 56px 'DejaVu Sans', sans-serif; }",
      corpo: `<div class="cartela">A torra</div>\n<!-- áudio aqui -->`, script: AJUDA }));
  },
  errada: (t) => cortarBlocos(t, 0),
  certa: (t) => cortarBlocos(t, WHISPER_CORTA + 0.2),
  oraculo: O.blocosInteiros(BLOCOS_T2.map(({ nome, freq }) => ({ nome, freq }))),
  referencia: (pasta) => Object.fromEntries(BLOCOS_T2.map((b) => {
    const a = join(pasta, `${b.nome}.wav`);
    gerarVoz(a, b.falas, { segundos: b.falas.at(-1)!.fim + 1.5, freq: b.freq });
    return [b.nome, a];
  })),
};
/** Encadeia os blocos cortando cada um no fim do Whisper + `alem` segundos. */
function cortarBlocos(t: string, alem: number) {
  const tempos = JSON.parse(readFileSync(join(t, "saida", "voz", "tempos.json"), "utf8"));
  let inicio = 0;
  const audios = BLOCOS_T2.map((b) => {
    const quadros = Math.ceil((tempos[b.nome].at(-1).fim + alem) * QPS);
    const a = `<audio src="voz/${b.nome}.wav" data-inicio="${inicio}" data-quadros="${quadros}"></audio>`;
    inicio += quadros;
    return a;
  });
  trocar(t, "<!-- áudio aqui -->", audios.join("\n"));
  trocar(t, `"quadros": 150`, `"quadros": ${inicio + 6}`);
}

// T4: câmera do documento a cada palavra; C1 e C2: cobertura do que a fala cita.
const DOC_CSS = `  .documento { position: absolute; left: 0; top: 0; width: 880px; height: 820px; background: #FFFFFF; color: #1B1F2A;
                font: 400 30px 'DejaVu Sans', sans-serif; transform-origin: 0 0; border-radius: 6px; }
  .documento > div { position: absolute; }
  .rotulo { left: 60px; }
  .valor { left: 600px; width: 220px; text-align: right; }
  .realce { background: rgba(46, 134, 171, 0.28); border: 3px solid #2E86AB; border-radius: 8px; opacity: 0; }`;
const LINHAS_DOC = [
  ["verde", "Café verde", "1.200,00"], ["torra", "Torra", "350,00"], ["embalagem", "Embalagem", "80,00"],
  ["noturna", "Taxa noturna", "0,33"], ["desconto", "Desconto", "0,00"],
] as const;
const topoLinha = (i: number) => 280 + i * 80;
const DOC_HTML = `<div class="documento" data-papel="documento">
  <div style="left: 60px; top: 40px; font-weight: 700; font-size: 38px;">Recibo de torra nº 0427</div>
  <div style="left: 60px; top: 110px;">Cliente: Café da Esquina (fictício)</div>
  <div class="rotulo" style="top: 180px;">Período:</div>
  <div data-celula="inicio" style="left: 260px; top: 180px;">03/03/2026</div>
  <div style="left: 450px; top: 180px;">a</div>
  <div data-celula="fim" style="left: 500px; top: 180px;">28/08/2026</div>
${LINHAS_DOC.map(([c, r, v], i) => `  <div class="rotulo" style="top: ${topoLinha(i)}px;">${r}</div>\n  <div class="valor" data-celula="${c}" style="top: ${topoLinha(i)}px;">${v}</div>`).join("\n")}
  <div class="rotulo" style="top: 720px; font-weight: 700;">Total</div>
  <div class="valor" data-celula="total" style="top: 720px; font-weight: 700;">1.630,33</div>
  <!-- realces aqui -->
</div>`;
/** Caixa de uma célula no documento (px do documento), para o realce. */
const caixaCelula = (c: string): Caixa => {
  if (c === "inicio") return [250, 172, 190, 52];
  if (c === "fim") return [490, 172, 190, 52];
  if (c === "total") return [590, 712, 240, 52];
  const i = LINHAS_DOC.findIndex(([x]) => x === c);
  return [590, topoLinha(i) - 8, 240, 52];
};
const realce = (c: string, de: number) => {
  const [x, y, w, h] = caixaCelula(c);
  return `<div class="realce" data-de="${de}" style="left: ${x}px; top: ${y}px; width: ${w}px; height: ${h}px;"></div>`;
};
/** Câmera: chaves [quadro, x, y, escala]; segura entre as chaves, anda em 10 quadros até cada uma. */
const camera = (N: number, chaves: [number, number, number, number][]) => {
  const k: string[] = [];
  const t = (x: number, y: number, s: number) => `translate(${x}px, ${y}px) scale(${s})`;
  let ant = chaves[0];
  k.push(`{ offset: 0, transform: '${t(ant[1], ant[2], ant[3])}' }`);
  for (const c of chaves.slice(1)) {
    k.push(`{ offset: ${(c[0] / N).toFixed(6)}, transform: '${t(ant[1], ant[2], ant[3])}' }`);
    k.push(`{ offset: ${((c[0] + 10) / N).toFixed(6)}, transform: '${t(c[1], c[2], c[3])}' }`);
    ant = c;
  }
  k.push(`{ offset: 1, transform: '${t(ant[1], ant[2], ant[3])}' }`);
  return `document.querySelector('.documento').animate([${k.join(", ")}], { duration: (${N} * 1000) / Q, fill: 'both' });`;
};
const INTEIRO: [number, number, number] = [260, 15, 0.62];
function cenaDocumento(t: string, id: string, titulo: string, falas: Palavra[]) {
  const seg = segundos(falas, 1.2);
  mkdirSync(join(t, "saida", "midia"), { recursive: true });
  escreverFala(t, falas, seg);
  writeFileSync(html(t), pagina({ id, ...H, quadros: q(seg), titulo, css: `${DOC_CSS}\n  body { background: #2B3040; }\n  .legenda { position: absolute; left: 0; right: 0; top: 488px; text-align: center; color: #fff; font: 700 24px 'DejaVu Sans', sans-serif; white-space: nowrap; opacity: 0; text-shadow: 0 2px 6px #000; }`,
    corpo: `${DOC_HTML}\n<audio src="midia/voz.wav" data-inicio="0"></audio>`,
    script: `${falasJs(falas)}\n${AJUDA}\n// câmera: o documento inteiro na tela\ndocument.querySelector('.documento').style.transform = 'translate(${INTEIRO[0]}px, ${INTEIRO[1]}px) scale(${INTEIRO[2]})';\n` }));
}
const comCamera = (t: string, js: string) => trocar(t, "// câmera: o documento inteiro na tela\n", `// câmera: o documento inteiro na tela\n${js}\n`);
const comRealces = (t: string, rs: string[]) => trocar(t, "  <!-- realces aqui -->", rs.map((r) => `  ${r}`).join("\n"));
/** Câmera que centra a caixa [x, y, w, h] do documento na tela com a escala s. */
const mirar = ([x, y, w, h]: Caixa, s: number): [number, number, number] => [H.largura / 2 - (x + w / 2) * s, H.altura / 2 - (y + h / 2) * s, s];

const FALA_T4 = falar(["O café verde custou mil e duzentos reais, a torra trezentos e cinquenta e a embalagem oitenta.",
  "O total ficou em mil seiscentos e trinta reais e trinta e três centavos."]);
const t4: Item = {
  id: "t4-zoom-por-palavra", categoria: "tempo da fala", regra: "câmera de documento por frase", erro: "câmera do documento muda a cada valor citado, não a cada frase",
  pedido: "Anime a cena do documento: a câmera acompanha o que a fala explica e cada valor citado ganha destaque (tempos em saida/tempos.json).",
  precisa: { geometria: true, render: false },
  preparar: (t) => cenaDocumento(t, "ReciboCamera", "Recibo: câmera", FALA_T4),
  errada: (t) => {
    const N = q(segundos(FALA_T4, 1.2));
    const alvo = (c: string, p: string, depois = -1): [number, number, number, number] => [q(FALA_T4[indice(FALA_T4, p, depois)].ini), ...mirar(caixaCelula(c), 1.6)];
    comCamera(t, camera(N, [[0, ...INTEIRO], alvo("verde", "mil"), alvo("torra", "trezentos"), alvo("embalagem", "oitenta"), alvo("total", "seiscentos")]));
    comRealces(t, [realce("verde", q(FALA_T4[indice(FALA_T4, "mil")].ini)), realce("torra", q(FALA_T4[indice(FALA_T4, "trezentos")].ini)),
      realce("embalagem", q(FALA_T4[indice(FALA_T4, "oitenta")].ini)), realce("total", q(FALA_T4[indice(FALA_T4, "seiscentos")].ini))]);
  },
  certa: (t) => {
    const N = q(segundos(FALA_T4, 1.2));
    const [s1, s2] = fraseTxt(FALA_T4);
    comCamera(t, camera(N, [[0, ...INTEIRO], [q(s1.ini), ...mirar([60, 270, 780, 230], 1.1)], [q(s2.ini), ...mirar([60, 700, 780, 70], 1.3)]]));
    comRealces(t, [realce("verde", q(FALA_T4[indice(FALA_T4, "mil")].ini)), realce("torra", q(FALA_T4[indice(FALA_T4, "trezentos")].ini)),
      realce("embalagem", q(FALA_T4[indice(FALA_T4, "oitenta")].ini)), realce("total", q(FALA_T4[indice(FALA_T4, "seiscentos")].ini))]);
  },
  oraculo: O.cameraPorFrase(),
};

const FALA_C1 = falar(["O café verde custou mil e duzentos reais e a torra trezentos e cinquenta.",
  "A embalagem saiu por oitenta, a taxa noturna por trinta e três centavos e o desconto ficou zerado.",
  "O total foi de mil seiscentos e trinta reais e trinta e três centavos."]);
const citadasC1 = () => {
  const i = (p: string, d = -1) => indice(FALA_C1, p, d);
  return [
    { celula: "verde", palavra: i("mil") }, { celula: "torra", palavra: i("trezentos") }, { celula: "embalagem", palavra: i("oitenta") },
    { celula: "noturna", palavra: i("trinta") }, { celula: "desconto", palavra: i("zerado") }, { celula: "total", palavra: i("seiscentos") },
  ];
};
const c1: Item = {
  id: "c1-verba-nao-destacada", categoria: "cobertura", regra: "tudo o que a fala cita, destacado", erro: "valor pequeno ou zerado citado pela fala e não destacado",
  pedido: "Destaque no documento cada valor que a fala cita, na hora em que ela cita (texto em saida/roteiro.md, tempos em saida/tempos.json). O colaborador confere o próprio recibo contra o vídeo.",
  precisa: { geometria: true, render: false },
  preparar: (t) => cenaDocumento(t, "ReciboValores", "Recibo: valores", FALA_C1),
  errada: (t) => comRealces(t, citadasC1().filter((c) => !["noturna", "desconto"].includes(c.celula)).map((c) => realce(c.celula, q(FALA_C1[c.palavra].ini)))),
  certa: (t) => comRealces(t, citadasC1().map((c) => realce(c.celula, q(FALA_C1[c.palavra].ini)))),
  oraculo: (d) => O.celulasRealcadas({ celulas: citadasC1() })(d),
};

const FALA_C2 = falar(["No período do contrato, de três de março a vinte e oito de agosto, a torra somou mil seiscentos e trinta reais e trinta e três centavos."]);
const citadasC2 = () => [
  { celula: "inicio", palavra: indice(FALA_C2, "três") }, { celula: "fim", palavra: indice(FALA_C2, "vinte") },
  { celula: "total", palavra: indice(FALA_C2, "seiscentos") },
];
const c2: Item = {
  id: "c2-periodo-sem-datas", categoria: "cobertura", regra: "fala cita o período → datas na tela", erro: "fala cita o período e a tela mostra só os valores, não as datas",
  pedido: "Anime a cena do documento seguindo a fala e destaque os valores (texto em saida/roteiro.md, tempos em saida/tempos.json).",
  precisa: { geometria: true, render: false },
  preparar: (t) => cenaDocumento(t, "ReciboPeriodo", "Recibo: período", FALA_C2),
  errada: (t) => comRealces(t, [realce("total", q(FALA_C2[indice(FALA_C2, "seiscentos")].ini))]),
  certa: (t) => comRealces(t, citadasC2().map((c) => realce(c.celula, q(FALA_C2[c.palavra].ini)))),
  oraculo: (d) => O.celulasRealcadas({ celulas: citadasC2() })(d),
};

// T5: fala acelerada além do ponto aprovado.
const FALA_T5 = falar(Array.from({ length: 6 }, (_, i) => ["Nosso café vem de sítios pequenos.", "Cada lote é provado antes.", "A torra é feita na semana.",
  "O pacote sai com a data.", "Você recebe em casa.", "Peça o seu hoje."][i]), { inicio: 0.1, porPalavra: 0.29, pausa: 0.45 });
const DUR_T5 = FALA_T5.at(-1)!.fim - FALA_T5[0].ini;
const t5: Item = {
  id: "t5-fala-acelerada", categoria: "tempo da fala", regra: "fala até 1,10×", erro: "fala acelerada 1,15× para caber no tempo (o aprovado foi 1,10×)",
  pedido: `A fala (saida/voz/fala.wav, ${DUR_T5.toFixed(1)} s) ficou longa para o anúncio de 10 s. Acelere a voz para caber e monte o vídeo de 10 s com ela, em saida/.`,
  precisa: { geometria: false, render: true },
  preparar: (t) => {
    gerarVoz(join(t, "saida", "voz", "fala.wav"), FALA_T5, { segundos: FALA_T5.at(-1)!.fim + 0.3 });
    writeFileSync(html(t), pagina({ id: "AnuncioDez", ...H, quadros: 300, titulo: "Anúncio de 10 s",
      css: "  .cartela { position: absolute; inset: 0; display: grid; place-items: center; color: #F7F4EC; font: 700 56px 'DejaVu Sans', sans-serif; }",
      corpo: `<div class="cartela">Zunzum</div>\n<!-- áudio aqui -->`, script: AJUDA }));
  },
  errada: (t) => acelerar(t, 1.15),
  certa: (t) => acelerar(t, 1.1),
  oraculo: O.velocidadeDaFala({ fala: DUR_T5 }),
};
function acelerar(t: string, fator: number) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", join(t, "saida", "voz", "fala.wav"), "-af", `atempo=${fator}`, join(t, "saida", "voz", "fala-rapida.wav")]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  trocar(t, "<!-- áudio aqui -->", `<audio src="voz/fala-rapida.wav" data-inicio="0"></audio>`);
}

// ——— Movimento ———

const CARTELA_CSS = `  .cartela { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding-left: 96px; color: #F7F4EC; }
  .cartela h1 { margin: 0 0 24px; font: 700 64px 'DejaVu Sans', sans-serif; opacity: 0; }
  .cartela p { margin: 6px 0; font: 400 32px 'DejaVu Sans', sans-serif; opacity: 0; }
  .anel { position: absolute; right: 60px; top: 70px; width: 380px; height: 380px; border-radius: 50%; border: 18px solid rgba(46, 134, 171, 0.35);
          border-top-color: #2E86AB; }`;
const m1: Item = {
  id: "m1-texto-tremendo", categoria: "movimento", regra: "texto só se move na entrada e na saída", erro: "aproximação lenta (escala contínua) numa tela com texto: a letra treme",
  pedido: "Esta tela de resumo está parada demais. Dê vida a ela.",
  precisa: { geometria: true, render: false },
  preparar: (t) => writeFileSync(html(t), pagina({ id: "Resumo", ...H, quadros: 150, titulo: "Resumo", css: CARTELA_CSS,
    corpo: `<div class="cartela">\n  <h1 data-de="3">Três provas</h1>\n  <p data-de="12">Aroma</p>\n  <p data-de="18">Doçura</p>\n  <p data-de="24">Final</p>\n</div>`,
    script: `${AJUDA}\n// movimento\n` })),
  errada: (t) => trocar(t, "// movimento\n", `// movimento\ndocument.querySelector('.cartela').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }], { duration: 5000, fill: 'both' });\n`),
  certa: (t) => {
    trocar(t, `<div class="cartela">`, `<div class="anel"></div>\n<div class="cartela">`);
    trocar(t, "// movimento\n", `// movimento\ndocument.querySelector('.anel').animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 5000, fill: 'both' });\n`);
  },
  oraculo: O.textoSemTremor(),
};

const FRASES_M2 = ["A torra começa cedo.", "O aroma toma a rua.", "O café sai às sete."];
const FALA_M2 = falar(FRASES_M2, { pausa: 0.6 });
const m2: Item = {
  id: "m2-texto-travado", categoria: "movimento", regra: "fluxo contínuo de texto", erro: "texto travado: cada frase entra, para e some, com a tela vazia entre elas",
  pedido: "Anime estas três frases na tela, uma depois da outra, no tempo da fala (saida/tempos.json).",
  precisa: { geometria: true, render: false },
  preparar: (t) => {
    const seg = segundos(FALA_M2);
    mkdirSync(join(t, "saida", "midia"), { recursive: true });
    escreverFala(t, FALA_M2, seg);
    writeFileSync(html(t), pagina({ id: "Frases", ...H, quadros: q(seg), titulo: "Três frases",
      css: "  .frase { position: absolute; left: 0; right: 0; top: 230px; text-align: center; color: #F7F4EC; font: 700 52px 'DejaVu Sans', sans-serif; opacity: 0; }",
      corpo: `${FRASES_M2.map((f) => `<div class="frase">${f}</div>`).join("\n")}\n<audio src="midia/voz.wav" data-inicio="0"></audio>`,
      script: `${falasJs(FALA_M2)}\n${AJUDA}\n// animação das frases\n` }));
  },
  errada: (t) => {
    const fs = fraseTxt(FALA_M2);
    trocar(t, "// animação das frases\n", `// animação das frases\nconst fr = document.querySelectorAll('.frase');\n${fs.map((f, i) =>
      `fr[${i}].animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], { delay: ${(f.ini * 1000).toFixed(0)}, duration: ${((f.fim - f.ini + 0.2) * 1000).toFixed(0)}, fill: 'none' });`).join("\n")}\n`);
  },
  certa: (t) => {
    const fs = fraseTxt(FALA_M2), N = q(segundos(FALA_M2));
    // Cada frase entra de baixo 0,2 s antes da fala dela e sai para cima com desfoque enquanto a seguinte já entra.
    trocar(t, "// animação das frases\n", `// animação das frases\nconst fr = document.querySelectorAll('.frase');\n${fs.map((f, i) => {
      const de = Math.max(0, q(f.ini - 0.2)), ate = i + 1 < fs.length ? q(fs[i + 1].ini) + 4 : N;
      return `fr[${i}].animate([{ opacity: 0, translate: '0 40px' }, { opacity: 1, translate: '0 0', offset: ${Math.min(0.5, 8 / (ate - de)).toFixed(3)} }, { opacity: 1, translate: '0 0', offset: ${Math.max(0.5, 1 - 8 / (ate - de)).toFixed(3)} }, { opacity: 0, translate: '0 -40px', filter: 'blur(6px)' }], { delay: (${de} * 1000) / Q, duration: (${ate - de} * 1000) / Q, fill: 'none' });`;
    }).join("\n")}\n`);
  },
  oraculo: O.frasesEmFluxo({ frases: FRASES_M2 }),
};

const TELAS_M3 = [["Três provas", "Aroma, doçura e final"], ["Torra na semana", "Nunca de estoque"], ["Entrega em casa", "Peça hoje"]];
const m3: Item = {
  id: "m3-animacao-parada", categoria: "movimento", regra: "nada parado", erro: "telas de resumo paradas: depois da entrada, nada se move",
  pedido: "Monte as três telas de resumo (os textos estão em saida/resumo.md), 2 s cada, uma depois da outra.",
  precisa: { geometria: false, render: true },
  preparar: (t) => {
    escrever(join(t, "saida", "resumo.md"), `# Resumo\n\n${TELAS_M3.map(([a, b], i) => `${i + 1}. ${a}: ${b}`).join("\n")}\n`);
    writeFileSync(html(t), pagina({ id: "TelasResumo", ...H, quadros: 180, titulo: "Telas de resumo", css: CARTELA_CSS,
      corpo: "<!-- telas aqui -->", script: AJUDA }));
  },
  errada: (t) => trocar(t, "<!-- telas aqui -->", TELAS_M3.map(([a, b], i) =>
    `<div class="cartela" data-de="${i * 60}" data-ate="${(i + 1) * 60}" style="opacity: 0;"><h1 style="opacity: 1;">${a}</h1><p style="opacity: 1;">${b}</p></div>`).join("\n")),
  certa: (t) => {
    trocar(t, "<!-- telas aqui -->", `<div class="anel"></div>\n${TELAS_M3.map(([a, b], i) =>
      `<div class="cartela" data-de="${i * 60}" data-ate="${(i + 1) * 60}" style="opacity: 0;"><h1 style="opacity: 1;">${a}</h1><p style="opacity: 1;">${b}</p></div>`).join("\n")}`);
    trocar(t, `for (const el of document.querySelectorAll('[data-de]'))`, `document.querySelector('.anel').animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 6000, fill: 'both' });\nfor (const el of document.querySelectorAll('[data-de]'))`);
  },
  oraculo: O.semTelaParada(),
};

const m4: Item = {
  id: "m4-foto-parada", categoria: "movimento", regra: "G22 (vídeo vivo)", erro: "corte do vídeo vivo para uma foto parada com zoom (Ken Burns)",
  pedido: "Monte o vídeo de 10 s da fachada com o material de saida/midia/ (os dois clipes e a foto que o cliente mandou).",
  precisa: { geometria: true, render: false },
  preparar: (t) => {
    gerarClipe(join(t, "saida", "midia", "clipe1.mp4"), { ...H, segundos: 5, c0: "0x203040", c1: "0x406080", bloco: "0xc0a060" });
    gerarClipe(join(t, "saida", "midia", "clipe2.mp4"), { ...H, segundos: 5, c0: "0x302820", c1: "0x705840", bloco: "0x60a0c0" });
    gerarImagem(join(t, "saida", "midia", "foto.png"), { ...H, c0: "0x302820", c1: "0x806848" });
    writeFileSync(html(t), pagina({ id: "Fachada", ...H, quadros: 300, titulo: "Fachada",
      css: "  .clipe, .foto { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }", corpo: "<!-- material aqui -->", script: AJUDA }));
  },
  errada: (t) => trocar(t, "<!-- material aqui -->", `<video class="clipe" src="midia/clipe1.mp4" data-inicio="0" data-quadros="120" muted></video>
<img class="foto" src="midia/foto.png" alt="" data-de="120" data-ate="180" style="opacity: 0;">
<video class="clipe" src="midia/clipe2.mp4" data-inicio="180" data-quadros="120" muted></video>`),
  certa: (t) => trocar(t, "<!-- material aqui -->", `<video class="clipe" src="midia/clipe1.mp4" data-inicio="0" data-quadros="150" muted></video>
<video class="clipe" src="midia/clipe2.mp4" data-inicio="150" data-quadros="150" muted></video>`),
  oraculo: O.semFotoParada(),
};

const m5: Item = {
  id: "m5-clarao-branco", categoria: "movimento", regra: "G22 (transição)", erro: "clarão branco na transição entre os clipes",
  pedido: "Junte os dois clipes de saida/midia/ (2 s cada) com uma transição de impacto na virada.",
  precisa: { geometria: false, render: true },
  preparar: (t) => {
    gerarClipe(join(t, "saida", "midia", "clipe1.mp4"), { ...H, segundos: 2, c0: "0x203040", c1: "0x406080", bloco: "0xc0a060" });
    gerarClipe(join(t, "saida", "midia", "clipe2.mp4"), { ...H, segundos: 2, c0: "0x302820", c1: "0x705840", bloco: "0x60a0c0" });
    writeFileSync(html(t), pagina({ id: "Virada", ...H, quadros: 120, titulo: "Virada",
      css: "  .clipe { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }",
      corpo: `<video class="clipe" src="midia/clipe1.mp4" data-inicio="0" data-quadros="60" muted></video>\n<video class="clipe c2" src="midia/clipe2.mp4" data-inicio="60" data-quadros="60" muted></video>\n<!-- transição aqui -->`,
      script: `${AJUDA}\n// transição\n` }));
  },
  errada: (t) => {
    trocar(t, "<!-- transição aqui -->", `<div class="clarao" style="position: absolute; inset: 0; background: #fff; opacity: 0;"></div>`);
    trocar(t, "// transição\n", `// transição\ndocument.querySelector('.clarao').animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { delay: (56 * 1000) / Q, duration: (8 * 1000) / Q, fill: 'none' });\n`);
  },
  certa: (t) => {
    // Cortina: o segundo clipe entra da direita, com a borda escura passando.
    trocar(t, `data-inicio="0" data-quadros="60"`, `data-inicio="0" data-quadros="66"`);
    trocar(t, `data-inicio="60" data-quadros="60"`, `data-inicio="54" data-quadros="66"`);
    trocar(t, "// transição\n", `// transição\ndocument.querySelector('.c2').animate([{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0)' }], { delay: (54 * 1000) / Q, duration: (12 * 1000) / Q, fill: 'backwards', easing: 'cubic-bezier(0.7, 0, 0.3, 1)' });\n`);
  },
  oraculo: O.semClarao(),
};

// ——— Contexto e regressão ———

const CSS_NOVO = `  body { background: #1B1F2A; }
  .logo { position: absolute; right: 40px; top: 32px; width: 160px; }
  .faixa { position: absolute; left: 50%; top: 392px; translate: -50% 0; color: #fff; background: #2E86AB; font: 700 24px 'DejaVu Sans', sans-serif; padding: 6px 18px; border-radius: 10px; white-space: nowrap; opacity: 0; }
  .legenda { position: absolute; left: 0; right: 0; top: 446px; text-align: center; color: #fff; font: 700 30px 'DejaVu Sans', sans-serif; white-space: nowrap; opacity: 0; }`;
const CSS_VELHO = `  body { background: #F4C2C2; }
  .logo { position: absolute; left: 40px; top: 32px; width: 160px; }
  .faixa { position: absolute; left: 40px; top: 400px; color: #F4C2C2; background: #6B8E23; font: 400 26px 'DejaVu Serif', serif; padding: 6px 18px; border-radius: 30px; white-space: nowrap; opacity: 0; }
  .legenda { position: absolute; left: 0; right: 0; top: 452px; text-align: center; color: #1B1F2A; font: 400 30px 'DejaVu Serif', serif; white-space: nowrap; opacity: 0; }`;
const textoVideo = (tema: string, frases: string[], logo: string) => `<img class="logo" src="${logo}" alt="">
<div class="faixa" data-papel="faixa" data-de="0">${tema}</div>
${frases.map((f, i) => `<div class="legenda" data-papel="legenda" data-de="${i * 45}" data-ate="${(i + 1) * 45}">${f}</div>`).join("\n")}`;
function projetoAnterior(t: string, pasta: string, id: string, css: string, corpo: string, notas: string, logo: [string, string]) {
  escrever(join(t, "projetos", pasta, logo[0]), logo[1]);
  escrever(join(t, "projetos", pasta, "NOTAS.md"), notas);
  escrever(join(t, "projetos", pasta, "index.html"), pagina({ id, ...H, quadros: 90, titulo: id, css, corpo, script: AJUDA }));
}
function prepararProjetos(t: string) {
  projetoAnterior(t, "2026-09-torra-escura", "TorraEscura", CSS_VELHO, textoVideo("Torra escura", ["Encorpado e intenso.", "Para o café da tarde."], "logo-zunzum.svg"),
    "# Torra escura (2026-09)\n\nv3 entregue em 2026-09-12.\nRender: `render.sh`.\n", ["logo-zunzum.svg", LOGO_VELHO]);
  escrever(join(t, "projetos", "2026-09-torra-escura", "render.sh"),
    "#!/bin/sh\n# Render da torra escura (2026-09).\ncd \"$(dirname \"$0\")/../..\" && ./motor render projetos/2026-09-torra-escura TorraEscura projetos/2026-09-torra-escura/video.mp4 --cpu\n");
  projetoAnterior(t, "2026-10-cafe-de-origem", "CafeDeOrigem", CSS_NOVO, textoVideo("Café de origem", ["De sítios pequenos.", "Torrado na semana."], "logo-zunzum.svg"),
    "# Café de origem (2026-10)\n\nv2 aprovada pelo cliente em 2026-10-20. Identidade nova da marca (tinta e azul, logo novo), faixa centrada logo acima da legenda, legenda numa linha.\n",
    ["logo-zunzum.svg", LOGO_NOVO]);
}
const ROTEIRO_X = ["Torra escura, sabor intenso.", "Agora em pacote de 500 g."];
const x1: Item = {
  id: "x1-base-velha", categoria: "contexto", regra: "partir do último aprovado", erro: "vídeo novo montado a partir da base velha (logo e cores antigas)",
  pedido: "Faça a versão nova do vídeo da torra escura com o roteiro de saida/roteiro.md: composição em linha do tempo em saida/ (16:9, 960×540, 3 s), sem apresentador, só a faixa com o tema, a legenda e a logo. Os projetos anteriores estão em projetos/.",
  precisa: { geometria: false, render: true },
  preparar: (t) => {
    prepararProjetos(t);
    escrever(join(t, "saida", "roteiro.md"), `# Torra escura (nova versão)\n\n${ROTEIRO_X.join("\n\n")}\n`);
  },
  errada: (t) => {
    copyFileSync(join(t, "projetos", "2026-09-torra-escura", "logo-zunzum.svg"), join(t, "saida", "logo-zunzum.svg"));
    escrever(html(t), pagina({ id: "TorraEscuraNova", ...H, quadros: 90, titulo: "Torra escura (nova)", css: CSS_VELHO, corpo: textoVideo("Torra escura", ROTEIRO_X, "logo-zunzum.svg"), script: AJUDA }));
  },
  certa: (t) => {
    copyFileSync(join(t, "projetos", "2026-10-cafe-de-origem", "logo-zunzum.svg"), join(t, "saida", "logo-zunzum.svg"));
    escrever(html(t), pagina({ id: "TorraEscuraNova", ...H, quadros: 90, titulo: "Torra escura (nova)", css: CSS_NOVO, corpo: textoVideo("Torra escura", ROTEIRO_X, "logo-zunzum.svg"), script: AJUDA }));
  },
  oraculo: O.semIdentidadeVelha({ cores: CORES_VELHAS }),
};

const x3: Item = {
  id: "x3-render-cpu", categoria: "contexto", regra: "G33 (render na placa)", erro: "render pelo script copiado do projeto anterior, que roda na CPU",
  pedido: "Renderize a composição de saida/ em saida/video.mp4. O projeto anterior tem o script de render pronto (projetos/2026-09-torra-escura/render.sh).",
  precisa: { geometria: false, render: false, mp4Entregue: "saida/video.mp4" },
  preparar: (t) => {
    prepararProjetos(t);
    copyFileSync(join(t, "projetos", "2026-10-cafe-de-origem", "logo-zunzum.svg"), join(t, "saida", "logo-zunzum.svg"));
  // a composição pronta
    escrever(html(t), pagina({ id: "TorraEscuraNova", ...H, quadros: 90, titulo: "Torra escura (nova)", css: CSS_NOVO, corpo: textoVideo("Torra escura", ROTEIRO_X, "logo-zunzum.svg"), script: AJUDA }));
  },
  errada: (t) => { const r = renderizar(join(t, "saida"), join(t, "saida", "video.mp4"), ["--cpu"]); if (!r.ok) throw new Error(r.erro); },
  certa: (t) => { const r = renderizar(join(t, "saida"), join(t, "saida", "video.mp4")); if (!r.ok) throw new Error(r.erro); },
  oraculo: O.renderNaPlaca(),
};

/**
 * Cada erro na taxonomia de `docs/pesquisa/erros-de-agentes.json` (#79): a classe K-… que ele instancia, `parente` quando
 * nenhuma classe cobre o erro exato e esta é a mais próxima (candidata a classe nova), a camada do protocolo que o pega
 * (1 a 5) e a gravidade (1 a 5), nos critérios do #79 (seção 3). Os eixos fixados de cada item ficam na partida.
 */
export type Classificacao = { classe: string; parente: boolean; camada: 1 | 2 | 3 | 4 | 5; gravidade: 1 | 2 | 3 | 4 | 5 };
export const CLASSIFICACAO: Record<string, Classificacao> = {
  "e1-faixa-no-rosto": { classe: "K-DES-08", parente: false, camada: 4, gravidade: 4 },
  "e2-legenda-duas-linhas": { classe: "K-DES-04", parente: false, camada: 4, gravidade: 3 },
  "e3-eixos-16x9": { classe: "K-DES-02", parente: false, camada: 4, gravidade: 3 },
  "e4-eixos-9x16": { classe: "K-DES-02", parente: false, camada: 4, gravidade: 3 },
  "e5-meia-logo": { classe: "K-PLA-02", parente: false, camada: 4, gravidade: 3 },
  "e6-fonte-fina-ceu": { classe: "K-COR-01", parente: false, camada: 1, gravidade: 4 },
  "e7-legenda-zona-base": { classe: "K-PLA-01", parente: false, camada: 4, gravidade: 4 },
  "t1-zoom-corta-frase": { classe: "K-EDI-03", parente: true, camada: 2, gravidade: 3 },
  "t2-bloco-whisper": { classe: "K-AUD-05", parente: false, camada: 2, gravidade: 4 },
  "t4-zoom-por-palavra": { classe: "K-ANI-03", parente: true, camada: 2, gravidade: 3 },
  "t5-fala-acelerada": { classe: "K-AUD-07", parente: false, camada: 5, gravidade: 3 },
  "m1-texto-tremendo": { classe: "K-ANI-04", parente: false, camada: 4, gravidade: 3 },
  "m2-texto-travado": { classe: "K-ANI-11", parente: true, camada: 4, gravidade: 2 },
  "m3-animacao-parada": { classe: "K-EDI-04", parente: true, camada: 4, gravidade: 3 },
  "m4-foto-parada": { classe: "K-EDI-04", parente: true, camada: 4, gravidade: 3 },
  "m5-clarao-branco": { classe: "K-ACE-01", parente: true, camada: 4, gravidade: 3 },
  "x1-base-velha": { classe: "K-EDI-14", parente: false, camada: 5, gravidade: 4 },
  "x3-render-cpu": { classe: "K-EDI-14", parente: true, camada: 5, gravidade: 2 },
  "c1-verba-nao-destacada": { classe: "K-DES-14", parente: true, camada: 4, gravidade: 4 },
  "c2-periodo-sem-datas": { classe: "K-DES-14", parente: true, camada: 4, gravidade: 3 },
  "t3-texto-de-apoio-whisper": { classe: "K-AUD-06", parente: true, camada: 2, gravidade: 4 },
  "x2-device-cpu": { classe: "K-EDI-14", parente: true, camada: 5, gravidade: 2 },
  "g1-assinatura-de-site": { classe: "K-IA-10", parente: false, camada: 4, gravidade: 2 },
  "g2-transicoes-fracas": { classe: "K-EDI-07", parente: true, camada: 4, gravidade: 3 },
  "d1-imagem-2x3-no-veo": { classe: "K-PLA-02", parente: true, camada: 1, gravidade: 4 },
  "d2-cara-de-ia": { classe: "K-IA-09", parente: true, camada: 4, gravidade: 3 },
  "k1-quadro-perdido": { classe: "K-FER-03", parente: false, camada: 3, gravidade: 4 },
};

export const ITENS: Item[] = [e1, e2, e3, e4, e5, e6, e7, t1, t2, t4, t5, m1, m2, m3, m4, m5, x1, x3, c1, c2];

/** Os erros que ficam fora do bench automático, com o motivo. */
export const FORA: { id: string; categoria: string; erro: string; motivo: string }[] = [
  { id: "t3-texto-de-apoio-whisper", categoria: "tempo da fala", erro: "texto de apoio (initial_prompt) no Whisper desalinhou os tempos de um bloco",
    motivo: "depende de rodar o Whisper (modelo e placa) e do comportamento dele com o texto de apoio; não é uma composição. Fica para um bench de ferramentas de voz." },
  { id: "x2-device-cpu", categoria: "contexto", erro: "script de tempos copiado do vídeo antigo com device=\"cpu\" (Whisper na CPU)",
    motivo: "depende do ambiente do Whisper (CUDA, cuBLAS); a mesma armadilha, copiar o script velho que roda na CPU, está modelada no x3 com o render do motor." },
  { id: "g1-assinatura-de-site", categoria: "gosto", erro: "assinatura final empilhada no centro (logo, nome, slogan, botão): «layout de site feito com IA»",
    motivo: "gosto: não há medida objetiva que separe a assinatura cinematográfica da de site sem virar regra arbitrária." },
  { id: "g2-transicoes-fracas", categoria: "gosto", erro: "transições ainda fracas (fusão de 8 quadros, passada crua)",
    motivo: "gosto: «fraca» é julgamento; o objetivo da parte (sem clarão branco) está no m5." },
  { id: "d1-imagem-2x3-no-veo", categoria: "geração da mídia", erro: "imagem 2:3 dada ao gerador de vídeo saiu com faixas pretas no 9:16",
    motivo: "acontece na geração do clipe por IA (fora do motor e do agente de edição); exige chamar o gerador pago." },
  { id: "d2-cara-de-ia", categoria: "geração da mídia", erro: "clipes com cara de render/IA em vez de celular",
    motivo: "geração e gosto: depende do prompt do gerador e do julgamento do resultado." },
  { id: "k1-quadro-perdido", categoria: "motor", erro: "piscada de um quadro: o OffthreadVideo do Remotion perdeu um quadro do take",
    motivo: "erro do motor antigo, não do agente; o nosso motor decodifica cada quadro em ordem (P10.5) e o quadro N é testado no render (R03). O oráculo de clarão (m5) pegaria a piscada clara." },
];
