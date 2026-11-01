// P10.5: vídeo e áudio embutidos na composição em linha do tempo (docs/formatos/linha-do-tempo.md, «Vídeo e áudio»).
// Lado do Node (main.ts): confere o que a página declarou (<video> e <audio> com data-inicio, data-recorte,
// data-quadros, data-volume), sonda cada arquivo (ffprobe), decodifica o vídeo num ffmpeg só, para a frente, e entrega
// à página o quadro certo do vídeo em I420 (servido em /__motor/video/<k>/<n>). A página monta um VideoFrame com ele e
// passa pelo createImageBitmap, que o cor-limpa.js embrulha: a mesma conversão de cor do vídeo do Remotion (M09).
// O áudio vira os mesmos assets do remotion_collectAssets que o audio.ts (M07) já mistura.
//
// Quadro do vídeo no quadro N da composição: t = (N − inicio) × velocidade / qps + recorte / qps, levado ao tick mais
// próximo da base de tempo do vídeo; o quadro é o último cujo pts (em ticks, a partir do primeiro) é ≤ esse tick. É a
// regra do compositor do Remotion 4.0.536 (opened_stream.rs, calc_position; frame_cache.rs, get_item_id). Só depende
// de N (R03).
import { spawn, spawnSync } from 'node:child_process';
import { origemDoAsset } from './audio.ts';

// Folga da duração em quadros (quadrosDaMidia): a duração do contêiner vem em segundos, com arredondamento.
const FOLGA = 0.0001;
const ATRIBUTOS = ['inicio', 'recorte', 'quadros'];

/** Erro de declaração: a mensagem diz o que corrigir na página. */
const erroDe = (m, texto) => new Error(`<${m.tipo} src="${m.src}">: ${texto}`);

/**
 * data-volume: número fixo de 0 a 10, ou pontos «quadro:volume» (C02), separados por espaço ou vírgula, com o quadro
 * contado do início da mídia na composição (como o frame da função de volume do Remotion) e crescendo. Devolve o
 * número ou [[quadro, volume], ...].
 */
function lerVolume(m, texto) {
  if (texto === null || texto === undefined || texto === '') return 1;
  if (!String(texto).includes(':')) {
    const volume = Number(texto);
    if (!Number.isFinite(volume) || volume < 0 || volume > 10 || !/^\s*[\d.]+\s*$/.test(String(texto))) {
      throw erroDe(m, `data-volume tem de ser número de 0 a 10: ${texto}`);
    }
    return volume;
  }
  const pontos = [];
  for (const par of String(texto).split(/[\s,]+/).filter(Boolean)) {
    const r = /^(\d+):(\d+(?:\.\d+)?|\.\d+)$/.exec(par);
    if (!r) throw erroDe(m, `data-volume: «${par}» não é quadro:volume (quadro inteiro ≥ 0, volume de 0 a 10)`);
    const [q, v] = [Number(r[1]), Number(r[2])];
    if (v > 10) throw erroDe(m, `data-volume: volume ${v} fora de 0 a 10`);
    const antes = pontos.at(-1);
    if (antes && q <= antes[0]) throw erroDe(m, `data-volume: os quadros têm de crescer (${q} depois de ${antes[0]})`);
    pontos.push([q, v]);
  }
  return pontos;
}

/**
 * O volume da mídia no quadro q (contado do início dela): o fixo, ou a reta entre os pontos vizinhos, preso no
 * primeiro e no último. A conta é a do interpolate do Remotion, para a rampa sair igual número a número.
 */
export function volumeNoQuadro(m, q) {
  const v = m.volume;
  if (typeof v === 'number') return v;
  if (q <= v[0][0]) return v[0][1];
  for (let i = 1; i < v.length; i++) {
    const [q1, v1] = v[i];
    if (q > q1) continue;
    const [q0, v0] = v[i - 1];
    return ((q - q0) / (q1 - q0)) * (v1 - v0) + v0;
  }
  return v.at(-1)[1];
}

/** data-velocidade (C02): número de 0,1 a 10, padrão 1 (o áudio vai pelo atempo, sem mudar o tom). */
function lerVelocidade(m, texto) {
  if (texto === null || texto === undefined || texto === '') return 1;
  const v = Number(texto);
  if (!/^\s*\d+(\.\d+)?\s*$/.test(String(texto)) || !(v >= 0.1 && v <= 10)) {
    throw erroDe(m, `data-velocidade tem de ser número de 0,1 a 10 (1 = normal): ${texto}`);
  }
  return v;
}

/**
 * Confere a lista crua da página (motor_midias): inteiros ≥ 0 nos atributos de quadro, volume de 0 a 10, src local.
 * Devolve [{ tipo, src, inicio, recorte, quadros (null = até o fim), volume (número ou pontos), mudo, velocidade }].
 */
export function lerMidias(brutas, { quadros: total }) {
  if (!Array.isArray(brutas)) throw new Error('a página não devolveu a lista de mídias');
  return brutas.map((b) => {
    const m = { tipo: b.tipo, src: b.src ?? '' };
    if (m.tipo !== 'video' && m.tipo !== 'audio') throw new Error(`mídia de tipo desconhecido: ${b.tipo}`);
    if (!b.src) throw erroDe(m, 'sem o atributo src (o motor não lê <source>; ponha o arquivo no src)');
    for (const nome of ATRIBUTOS) {
      const texto = b[nome];
      if (texto === null || texto === undefined || texto === '') { m[nome] = nome === 'quadros' ? null : 0; continue; }
      if (!/^\d+$/.test(texto)) throw erroDe(m, `data-${nome} tem de ser inteiro ≥ 0 (em quadros da composição): ${texto}`);
      m[nome] = Number(texto);
    }
    if (m.quadros === 0) throw erroDe(m, 'data-quadros tem de ser ≥ 1');
    if (m.inicio >= total) throw erroDe(m, `data-inicio ${m.inicio} fora da composição (${total} quadros)`);
    m.volume = lerVolume(m, b.volume);
    m.mudo = b.mudo === true;
    m.velocidade = lerVelocidade(m, b.velocidade);
    return m;
  });
}

const MATRIZES = { bt709: 'bt709', smpte170m: 'smpte170m', bt470bg: 'bt470bg', smpte240m: 'smpte240m', bt2020nc: 'bt2020-ncl' };

/**
 * O colorSpace do VideoFrame para as tags do ffprobe. Sem tag de matriz, a regra do compositor do Remotion
 * (scalable_frame.rs:52-60, a mesma do cor-limpa.js): faixa TV com 720 linhas ou mais é bt709; menos, bt601.
 */
export function corDoVideo({ color_space: cs, color_range: faixa, pix_fmt: formato, height: altura }) {
  const cheia = faixa === 'pc' || formato === 'yuvj420p';
  if (!cs || cs === 'unknown') return { matrix: !cheia && altura >= 720 ? 'bt709' : 'smpte170m', fullRange: cheia };
  const matrix = MATRIZES[cs];
  if (!matrix) throw new Error(`matriz de cor ${cs} não é tratada pelo motor (bt709, bt601, smpte240m, bt2020)`);
  return { matrix, fullRange: cheia };
}

/**
 * Índice do quadro do vídeo no tempo t (s): t vai ao tick mais próximo da base [num, den] (como o calc_position do
 * Remotion, que arredonda), e o quadro é o último com pts ≤ esse tick (ticks ordenados, a partir de 0); antes do
 * primeiro, o primeiro. Sem folga: uma folga em segundos antecipava o quadro quando o pts passava de t por menos que
 * ela (29,97 qps em 30, quadros 1 a 3).
 */
export function indiceNoVideo({ ticks, base: [num, den] }, t) {
  let lo = 0, hi = ticks.length - 1;
  if (hi < 0) throw new Error('vídeo sem quadros');
  const tick = Math.round((t * den) / num);
  if (tick < ticks[0]) return 0;
  while (lo < hi) {
    const meio = (lo + hi + 1) >> 1;
    if (ticks[meio] <= tick) lo = meio; else hi = meio - 1;
  }
  return lo;
}

/** Tempo do vídeo (s) no quadro n da composição: (n − inicio) × velocidade / qps + recorte / qps. */
export const tempoNoVideo = (m, n, qps) => {
  const v = m.velocidade ?? 1;
  // Velocidade 1: a conta de antes, sem a divisão separada (o mesmo número, bit a bit).
  return v === 1 ? (n - m.inicio + m.recorte) / qps : ((n - m.inicio) * v) / qps + m.recorte / qps;
};

/**
 * Quantos quadros da composição a mídia ocupa: data-quadros, ou até o fim da mídia (ou da composição); com
 * velocidade, (duração × qps − recorte) / velocidade.
 */
export function quadrosDaMidia(m, { duracao, qps, total }) {
  const ate = total - m.inicio;
  if (m.quadros !== null) {
    if (m.quadros > ate) throw erroDe(m, `data-inicio ${m.inicio} + data-quadros ${m.quadros} passa do fim da composição (${total} quadros)`);
    return m.quadros;
  }
  // Os quadros n com t(n) < duração: (n − inicio) × velocidade < duração × qps − recorte.
  const v = m.velocidade ?? 1;
  const ateOFim = Math.ceil((duracao * qps - m.recorte) / v - FOLGA);
  if (ateOFim < 1) throw erroDe(m, `data-recorte ${m.recorte} passa do fim da mídia (${duracao.toFixed(3)} s)`);
  return Math.min(ate, ateOFim);
}

/** ffprobe do vídeo: tamanho, formato, cor, rotação e os pts (pacotes sem o D de descarte, ordenados, a partir de 0). */
export function sondarVideo(arquivo, { ffprobe = 'ffprobe' } = {}) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,pix_fmt,color_space,color_range,sample_aspect_ratio,duration,time_base:stream_side_data=rotation:packet=pts,flags:format=start_time,format_name',
    '-of', 'json', arquivo], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60000, killSignal: 'SIGKILL' });
  if (r.status !== 0) throw new Error(`ffprobe falhou em ${arquivo}: ${String(r.stderr).slice(0, 300)}`);
  const j = JSON.parse(r.stdout);
  const s = j.streams?.[0];
  if (!s) throw new Error(`${arquivo} não tem faixa de vídeo`);
  if (!['yuv420p', 'yuvj420p'].includes(s.pix_fmt)) {
    throw new Error(`${arquivo}: formato ${s.pix_fmt}; o motor aceita vídeo 4:2:0 de 8 bits (yuv420p), como a conversão de cor do Remotion`);
  }
  if (s.width % 2 || s.height % 2) throw new Error(`${arquivo}: tamanho ímpar (${s.width}×${s.height})`);
  if (s.sample_aspect_ratio && !['1:1', '0:1', 'N/A'].includes(s.sample_aspect_ratio)) {
    throw new Error(`${arquivo}: pixel não quadrado (${s.sample_aspect_ratio})`);
  }
  const rotacao = (s.side_data_list ?? []).find((d) => d.rotation !== undefined)?.rotation ?? 0;
  if (rotacao) throw new Error(`${arquivo}: vídeo com rotação de ${rotacao}° no metadado; gire o arquivo antes`);
  const [num, den] = String(s.time_base).split('/').map(Number);
  const pts = (j.packets ?? []).filter((p) => !String(p.flags ?? '').includes('D') && p.pts !== undefined && p.pts !== 'N/A')
    .map((p) => Number(p.pts)).sort((a, b) => a - b);
  if (!pts.length) throw new Error(`${arquivo}: nenhum quadro`);
  const ticks = pts.map((p) => p - pts[0]);
  const tempos = ticks.map((p) => (p * num) / den);
  const passo = tempos.length > 1 ? (tempos.at(-1) - tempos[0]) / (tempos.length - 1) : 1 / 25;
  const duracao = Number.isFinite(Number(s.duration)) ? Number(s.duration) : tempos.at(-1) + passo;
  // S08: pacotes marcados para descarte (lista de edição) contam no NVDEC, que não respeita a lista: o índice do quadro
  // sairia deslocado, e esse vídeo fica no canvas.
  const descartados = (j.packets ?? []).filter((p) => String(p.flags ?? '').includes('D')).length;
  // P13: onde o primeiro quadro do vídeo cai no tempo do arquivo (o -ss do LeitorDeVideo conta do início do arquivo,
  // que é o da faixa que começa antes, às vezes o áudio).
  const inicioArquivo = Number(j.format?.start_time);
  const deslocamento = Number.isFinite(inicioArquivo) ? (pts[0] * num) / den - inicioArquivo : 0;
  // O -ss do LeitorDeVideo só vale onde a busca foi conferida quadro a quadro (cli/midia-linha.test.ts): H.264 em
  // MP4/MOV, cuja busca é pelo pts, sem pacote descartado e com os pts estritamente crescentes (um pts repetido
  // deslocaria o índice). No HEVC com quadros B, o teste achou o quadro errado depois do -ss: abre do 0.
  const buscaExata = s.codec_name === 'h264' && String(j.format?.format_name ?? '').split(',').includes('mov') && descartados === 0
    && tempos.every((t, i) => i === 0 || t > tempos[i - 1]);
  return { largura: s.width, altura: s.height, formato: s.pix_fmt, codec: s.codec_name, descartados, cor: corDoVideo(s), pts: tempos, ticks, base: [num, den], duracao, deslocamento, buscaExata };
}

/** Duração (s) de qualquer mídia, pelo contêiner. */
export function duracaoDaMidia(arquivo, { ffprobe = 'ffprobe' } = {}) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', arquivo],
    { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' });
  const d = Number(r.stdout.trim());
  if (r.status !== 0 || !Number.isFinite(d)) throw new Error(`ffprobe não leu a duração de ${arquivo}: ${String(r.stderr).slice(0, 200)}`);
  return d;
}

/**
 * Lê os quadros de um vídeo em ordem, num ffmpeg só (I420 cru, sem conversão: o formato de saída é o de entrada).
 * Pedir um quadro anterior ao último lido reabre o ffmpeg (não acontece num render em ordem).
 * Com os pts da sonda (P13), o ffmpeg abre já no quadro pedido (-ss antes do -i: vai ao quadro-chave anterior e
 * descarta o que vem antes do tempo, sem mandar ao Node), e a página que começa no meio do vídeo não decodifica nem
 * copia o começo dele. Sem os pts (ou com pacotes descartados pela lista de edição, em que o índice não bate com o
 * tempo, ou fora do MP4/MOV, ver sondarVideo), abre do 0, como antes.
 */
export class LeitorDeVideo {
  constructor({ arquivo, largura, altura, formato, ffmpeg = 'ffmpeg', filhos = null, pts = null, deslocamento = 0 }) {
    Object.assign(this, { arquivo, largura, altura, formato, ffmpeg, filhos, pts, deslocamento });
    this.tamanho = (largura * altura * 3) / 2;
    this.p = null; this.lido = -1; this.atual = null; this.reaberturas = 0; this.decodificados = 0;
  }

  #abrir(i) {
    this.fechar();
    // O -ss fica meio intervalo antes do pts do quadro i: o ffmpeg descarta os quadros com tempo menor que ele (o
    // i − 1 inclusive) e o primeiro que sai é o i.
    const pular = this.pts && i > 0 && i < this.pts.length;
    const ss = pular ? this.deslocamento + this.pts[i] - (this.pts[i] - this.pts[i - 1]) / 2 : 0;
    // P13: 2 threads de decodificação. No automático (uma por núcleo, com threads de quadro), o 1080p H.264 custava
    // ~2,7 vezes a CPU (6,2 contra 2,3 s em 500 quadros) e ainda decodificava à frente quadros que a página não pede;
    // com 2, sai a 340-470 quadros/s, acima do que o laço pede (4K não medido). MOTOR_LEITOR_THREADS muda (auto: o
    // padrão do ffmpeg).
    const threads = process.env.MOTOR_LEITOR_THREADS ?? '2';
    const p = spawn(this.ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-noautorotate', ...(threads === 'auto' ? [] : ['-threads', threads]),
      ...(pular ? ['-ss', ss.toFixed(6)] : []), '-i', this.arquivo, '-map', '0:v:0',
      '-fps_mode', 'passthrough', '-pix_fmt', this.formato, '-f', 'rawvideo', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.filhos?.add(p);
    this.p = p; this.lido = pular ? i - 1 : -1; this.atual = null; this.acabou = false; this.erro = '';
    // Os eventos do ffmpeg anterior (morto ao reabrir) chegam depois: só os do atual contam.
    const atual = () => this.p === p;
    p.stderr.on('data', (d) => { if (atual()) this.erro += d; });
    const acordar = () => { if (!atual()) return; const a = this.acordar; this.acordar = null; a?.(); };
    const fim = () => { if (atual()) this.acabou = true; acordar(); };
    p.stdout.on('readable', acordar);
    p.stdout.on('end', fim);
    p.on('close', () => { this.filhos?.delete(p); fim(); });
    p.on('error', (e) => { if (atual()) this.erro += String(e); fim(); });
  }

  async #proximo() {
    for (;;) {
      // Com o stream acabado, o read(tamanho) devolve o resto, mesmo menor que um quadro.
      const b = this.p.stdout.read(this.tamanho);
      if (b?.length === this.tamanho) return b;
      if (b) throw new Error(`${this.arquivo}: quadro incompleto no fim (${b.length} de ${this.tamanho} bytes)`);
      if (this.acabou) {
        const resto = this.p.stdout.read();
        if (resto?.length) throw new Error(`${this.arquivo}: quadro incompleto no fim (${resto.length} de ${this.tamanho} bytes)`);
        return null;
      }
      await new Promise((ok) => { this.acordar = ok; });
    }
  }

  /** O quadro i (0 = o primeiro), em I420. */
  async quadro(i) {
    if (!this.p || i < this.lido) { if (this.p) this.reaberturas++; this.#abrir(i); }
    while (this.lido < i) {
      const q = await this.#proximo();
      if (!q) throw new Error(`${this.arquivo}: o vídeo acabou no quadro ${this.lido}, pedido o ${i}${this.erro ? ` (ffmpeg: ${this.erro.trim().slice(-300)})` : ''}`);
      this.atual = q; this.lido++; this.decodificados++;
    }
    return this.atual;
  }

  fechar() {
    if (this.p) { try { this.p.kill('SIGKILL'); } catch {} this.filhos?.delete(this.p); this.p = null; }
  }
}

/**
 * As mídias prontas para o render: sondadas, com a duração em quadros resolvida e o leitor do vídeo.
 * base: URL do servidor local; pasta: a da composição (a fonte tem de estar nela, como no áudio do M07); dados: onde
 * vai a mídia de src data: (temporária).
 */
export function prepararMidias(brutas, { base, pasta, dados, qps, quadros: total, ffmpeg, ffprobe, filhos }) {
  return lerMidias(brutas, { quadros: total }).map((m, k) => {
    let arquivo;
    try { arquivo = origemDoAsset(m.src, { base, pacote: pasta, pasta: dados }); } catch (e) { throw erroDe(m, e.message.replace('fonte de áudio', 'fonte')); }
    if (m.tipo === 'video') {
      const v = sondarVideo(arquivo, { ffprobe });
      const quadros = quadrosDaMidia(m, { duracao: v.duracao, qps, total });
      return { ...m, k, arquivo, quadros, largura: v.largura, altura: v.altura, formato: v.formato, codec: v.codec, descartados: v.descartados, cor: v.cor, pts: v.pts, ticks: v.ticks, base: v.base,
        leitor: new LeitorDeVideo({ arquivo, largura: v.largura, altura: v.altura, formato: v.formato, ffmpeg, filhos,
          ...(v.buscaExata && process.env.MOTOR_LEITOR_DO_ZERO !== '1' ? { pts: v.pts, deslocamento: v.deslocamento } : {}) }), ultimo: null };
    }
    const quadros = quadrosDaMidia(m, { duracao: duracaoDaMidia(arquivo, { ffprobe }), qps, total });
    return { ...m, k, arquivo, quadros };
  });
}

/** O que a página precisa de cada mídia (sem o leitor nem os pts). */
export const paraPagina = (midias) => midias.map(({ k, tipo, inicio, quadros, largura, altura, cor }) =>
  ({ k, tipo, inicio, quadros, largura: largura ?? null, altura: altura ?? null, cor: cor ?? null }));

/**
 * O quadro do vídeo k no quadro n da composição: { indice, buffer } ou { indice, repetido: true } se é o mesmo já
 * entregue (a página mantém o canvas). Fora do trecho da mídia, erro (a página não pede). vazio: o canvas da página
 * foi limpo, e o quadro vem mesmo se for o já entregue (render fora de ordem, P10.4).
 */
export async function quadroDoVideo(m, n, qps, { vazio = false } = {}) {
  if (m.tipo !== 'video') throw new Error(`mídia ${m.k} não é vídeo`);
  if (n < m.inicio || n >= m.inicio + m.quadros) throw new Error(`quadro ${n} fora do trecho do vídeo ${m.src} (${m.inicio}…${m.inicio + m.quadros - 1})`);
  const indice = indiceNoVideo(m, tempoNoVideo(m, n, qps));
  if (indice === m.ultimo && !vazio) return { indice, repetido: true };
  const buffer = await m.leitor.quadro(indice);
  m.ultimo = indice;
  return { indice, buffer };
}

/**
 * Os assets de áudio do quadro n, no formato do remotion_collectAssets que o ColetorDeAudio (audio.ts) mistura:
 * cada mídia não muda, com volume > 0 no quadro, dentro do seu trecho. mediaFrame = quadro da mídia no qps da composição.
 */
export function assetsDoQuadro(midias, n, base) {
  const lista = [];
  for (const m of midias) {
    if (m.mudo || n < m.inicio || n >= m.inicio + m.quadros) continue;
    // Volume 0 no quadro: fora da mistura, como o Remotion (que não registra o asset nesse quadro).
    const volume = volumeNoQuadro(m, n - m.inicio);
    if (volume === 0) continue;
    lista.push({ type: m.tipo, src: new URL(m.src, base).href, id: `motor-midia-${m.k}`, volume,
      // Com velocidade (C02), o mediaFrame conta no tempo acelerado e o audioStartFrame é o recorte (o começo na mídia,
      // sem acelerar): o audio.ts corta em recorte / (qps × velocidade) + (n − inicio) / qps e acelera pelo atempo.
      mediaFrame: n - m.inicio + m.recorte, playbackRate: m.velocidade ?? 1, toneFrequency: 1,
      audioStartFrame: (m.velocidade ?? 1) === 1 ? 0 : m.recorte, audioStreamIndex: 0 });
  }
  return lista;
}

export function fecharMidias(midias) { for (const m of midias ?? []) m.leitor?.fechar(); }
