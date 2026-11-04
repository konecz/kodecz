// M07: áudio na mesma passada do vídeo. A cada quadro, o main.ts monta os assets das mídias declaradas da linha do
// tempo (assetsDoQuadro, composicao/midia-linha.ts, P10.5), no formato que o M07 definiu a partir do collect-assets.ts
// do @remotion/renderer 4.0.536, e entrega aqui: cada asset (tipo audio ou video, com src) vira trecho, como o
// calculate-asset-positions.ts, e cada trecho vira uma cadeia de filtros igual à do stringify-ffmpeg-filter.ts (a
// régua guardada em composicao/fixtures/audio-remotion.json). No fim, um único ffmpeg lê o vídeo cru do motor (H.264
// ou HEVC) e as fontes, mistura (amix sem normalizar, como o create-ffmpeg-merge-filter.ts) e grava o MP4.
// Desvios conscientes: render inteiro, sem pedaços (trimLeftOffset = trimRightOffset = 0, sem o modo «seamless» do
// Lambda); o AAC vai direto para o MP4 (o muxer põe a lista de edição do atraso do codificador, que o Remotion
// reconstrói com -itsoffset sobre o ADTS); sem a divisão em grupos do Remotion (32 trilhas ou mais misturadas de 10
// em 10): tudo entra num amix só. O PCM da página (o inline-audio do <Audio> do @remotion/media) saiu com a entrada do
// Remotion (docs/adr.md, seção 16).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';

// ffmpeg por caminho absoluto (M04_FFMPEG, um ffmpeg fora do PATH) pode trazer as bibliotecas ao lado.
const ambiente = (bin) => (isAbsolute(bin) ? { ...process.env, LD_LIBRARY_PATH: [dirname(bin), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : process.env);

// ---------- trechos (calculate-asset-positions.ts e flatten-volume-array.ts) ----------

const achatarVolume = (v) => (typeof v === 'number' ? v : new Set(v).size === 1 ? v[0] : v);

// quadros: um array por quadro de saída (índice 0 = primeiro quadro do render), com os assets daquele quadro.
// O motor não comprime src repetida (o «same-as» do Remotion), então a src vem sempre inteira.
export function trechos(quadros) {
  const lista = [];
  const abertos = new Map();
  for (let q = 0; q < quadros.length; q++) {
    const vistos = new Set();
    const atuais = [];
    for (const a of quadros[q]) {
      if ((a.type !== 'audio' && a.type !== 'video') || vistos.has(a.id)) continue;
      vistos.add(a.id);
      atuais.push(a);
    }
    for (const [id, aberto] of abertos) {
      if (!vistos.has(id)) { aberto.duration = q - aberto.startInVideo; abertos.delete(id); }
    }
    for (const a of atuais) {
      let aberto = abertos.get(a.id);
      if (!aberto) {
        aberto = { src: a.src, type: a.type, duration: null, id: a.id, startInVideo: q, trimLeft: a.mediaFrame, volume: [],
          playbackRate: a.playbackRate, toneFrequency: a.toneFrequency, audioStartFrame: a.audioStartFrame,
          audioStreamIndex: a.audioStreamIndex };
        lista.push(aberto);
        abertos.set(a.id, aberto);
      }
      aberto.volume.push(a.volume);
    }
  }
  for (const aberto of abertos.values()) aberto.duration = quadros.length - aberto.startInVideo;
  return lista.map((t) => ({ ...t, volume: achatarVolume(t.volume) }));
}

// ---------- filtros (ffmpeg-volume-expression.ts, calculate-atempo.ts, stringify-ffmpeg-filter.ts) ----------

// Volume fixo: eval=once, como o Remotion. Volume por quadro: desvio consciente do Remotion (2026-11-04). O dele é
// constante dentro do quadro (if(between(t,…)) aninhados, arredondado a 97 degraus) e vai no volume=…:eval=frame, que
// o ffmpeg avalia uma vez por quadro de áudio (~1024 amostras): a rampa sai em degraus, e o degrau estala (a trilha que
// abaixa sob a voz). Aqui sai a expressão de um envelope (o aevalsrc do filtroTrilha, avaliado amostra a amostra): o
// volume do quadro q vale no instante trimLeft + q / qps e, entre dois quadros, segue a reta; antes do primeiro e
// depois do último, o volume da ponta. Só os quadros em que a inclinação muda entram (uma rampa de pontos vira poucos
// trechos), numa árvore de if(lt(t,…)) de profundidade log2 (a expressão do ffmpeg aceita 100), sem arredondar.
const numero = (v) => String(Object.is(v, -0) ? 0 : v);
export function expressaoVolume(volume, fps, trimLeft) {
  if (typeof volume === 'number') return { eval: 'once', value: String(volume) };
  if (new Set(volume).size === 1) return expressaoVolume(volume[0], fps, trimLeft);
  const nos = volume.flatMap((v, q) => (q === 0 || q === volume.length - 1 || Math.abs(volume[q + 1] - 2 * v + volume[q - 1]) > 1e-9 ? [q] : []));
  const instante = (q) => trimLeft + q / fps;
  // Região r: 0 antes do primeiro nó, r entre os nós r − 1 e r, nos.length depois do último.
  const regiao = (r) => {
    if (r === 0) return numero(volume[nos[0]]);
    if (r === nos.length) return numero(volume[nos.at(-1)]);
    const [a, b] = [nos[r - 1], nos[r]];
    if (volume[a] === volume[b]) return numero(volume[a]);
    return `${numero(volume[a])}+(${numero((volume[b] - volume[a]) / (instante(b) - instante(a)))})*(t-${numero(instante(a))})`;
  };
  const arvore = (de, ate) => {
    if (de === ate) return regiao(de);
    const meio = Math.ceil((de + ate) / 2);
    return `if(lt(t,${numero(instante(nos[meio - 1]))}),${arvore(de, meio - 1)},${arvore(meio, ate)})`;
  };
  return { eval: 'sample', value: arvore(0, nos.length) };
}

// O atempo aceita de 0,5 a 2; fora disso, encadeia raízes.
export function atempo(v) {
  if (v === 1) return null;
  if (v >= 0.5 && v <= 2) return `atempo=${v.toFixed(5)}`;
  return `${atempo(Math.sqrt(v))},${atempo(Math.sqrt(v))}`;
}

const limparFlutuante = (v) => (v % 1 < 0.0000001 ? Math.floor(v) : v % 1 > 0.9999999 ? Math.ceil(v) : v);
const microssegundos = (s) => { const t = `${limparFlutuante(s * 1000000)}us`; return t.includes('e-') ? '0us' : t; };

// Cadeia de uma trilha, do decodificador até a entrada do amix: a do preprocess-audio-track.ts (aformat, atempo,
// atrim, volume, tom; saída estéreo s16 como o -ac 2 -c:a pcm_s16le dele) seguida do adelay e do apad que o
// merge-audio-track.ts põe em cada WAV. canais = canais da fonte (ffprobe); duracaoMidia e inicioMidia, do ffprobe.
export function filtroTrilha({ trecho, fps, duracaoVideo, taxa, canais, duracaoMidia, inicioMidia, entrada, saida }) {
  if (canais === 0) return null;
  const { playbackRate: vel, audioStartFrame, toneFrequency: tom, startInVideo } = trecho;
  if (tom !== null && (tom <= 0 || tom > 2)) throw new Error('toneFrequency deve estar entre 0,01 e 2');
  const inicioNoVideo = startInVideo === 0 ? 0 : startInVideo / fps;
  // getActualTrimLeft: a recusa usa o tempo da mídia; o atrim vem depois do atempo, então o corte usa o tempo já
  // acelerado (o trimAndSetTempo do Remotion chama sempre a forma «seamless»).
  const desdeInicio = trecho.trimLeft - audioStartFrame;
  if (duracaoMidia && audioStartFrame / fps + (desdeInicio / fps) * vel >= duracaoMidia) return null;
  const corteEsq = audioStartFrame / fps / vel + desdeInicio / fps;
  let corteDir = corteEsq + trecho.duration / fps;
  if (duracaoMidia) corteDir = Math.min(corteDir, duracaoMidia / vel);
  if (corteDir < corteEsq) corteDir = corteEsq;
  const audivel = corteDir - corteEsq;
  // O envelope começa junto com o trecho (o t do aevalsrc parte de 0 na primeira amostra depois do atrim).
  const vol = expressaoVolume(trecho.volume, fps, typeof trecho.volume === 'number' ? corteEsq : 0);
  const fimPad = duracaoVideo - audivel - inicioNoVideo;
  const atrasoS = inicioNoVideo + (trecho.trimLeft === 0 ? inicioMidia : 0);
  const cadeia = (filtros) => filtros.filter(Boolean).join(',');
  const inicio = cadeia([`aformat=sample_fmts=s16:sample_rates=${taxa}`, atempo(vel), `atrim=${microssegundos(corteEsq)}:${microssegundos(corteDir)}`]);
  const fim = cadeia([
    tom && tom !== 1 ? `asetrate=${taxa}*${tom},aresample=${taxa},atempo=1/${tom}` : null,
    `aformat=sample_fmts=s16:sample_rates=${taxa}:channel_layouts=stereo`,
    // O WAV intermediário do Remotion começa em 0; aqui, sem ele, o pts do atrim iria até a saída do amix.
    'asetpts=PTS-STARTPTS',
    // Como o Remotion: em milissegundos, um valor por canal mais um (o ffprobe às vezes conta canal a menos).
    atrasoS === 0 ? null : `adelay=${new Array(canais + 1).fill((atrasoS * 1000).toFixed(0)).join('|')}`,
    fimPad > 0.0000001 ? `apad=pad_len=${Math.round(fimPad * taxa)}` : null,
  ]);
  if (vol.eval !== 'sample') return `[${entrada}]${cadeia([inicio, vol.value === '1' ? null : `volume=${vol.value}:eval=${vol.eval}`, fim])}[${saida}]`;
  // Volume por amostra: o envelope mono (uma avaliação por amostra, metade da CPU de um aeval nos dois canais), passado
  // a estéreo e multiplicado à trilha já em estéreo (a mistura de canais e o volume são lineares: a ordem não muda o
  // som). O envelope dura 1 s a mais que o trecho; o amultiply termina com a trilha.
  const env = `aevalsrc='${vol.value}':s=${taxa}:d=${(audivel + 1).toFixed(6)},pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=flt`;
  return `[${entrada}]${inicio},aformat=sample_fmts=flt:channel_layouts=stereo[${saida}m];\n${env}[${saida}e];\n` +
    `[${saida}m][${saida}e]amultiply,${fim}[${saida}]`;
}

// O grafo inteiro: entrada 0 é o vídeo; depois as fontes das trilhas, nessa ordem.
// trilhas: [{ arquivo, filtro(entrada, saida) }].
export function montarMistura({ trilhas, totalAmostras }) {
  if (trilhas.length === 0) return null;
  const partes = [], rotulos = [];
  trilhas.forEach((t, i) => { partes.push(t.filtro(`${i + 1}:a`, `t${i}`)); rotulos.push(`[t${i}]`); });
  partes.push(`${rotulos.join('')}amix=inputs=${rotulos.length}:dropout_transition=0:normalize=0,aformat=sample_fmts=s16,` +
    `apad=whole_len=${totalAmostras},atrim=end_sample=${totalAmostras}[audio]`);
  return { entradas: trilhas.map((t) => t.arquivo), filtro: partes.join(';\n') };
}

// ---------- origem das fontes ----------

// O render não tem rede: a fonte tem de ser do pacote (o servidor local do motor) ou data:. Nada de http de fora.
export function origemDoAsset(src, { base, pacote, pasta }) {
  if (src.startsWith('data:')) {
    const virgula = src.indexOf(',');
    const cabeca = src.slice(5, virgula);
    const corpo = cabeca.endsWith(';base64') ? Buffer.from(src.slice(virgula + 1), 'base64') : Buffer.from(decodeURIComponent(src.slice(virgula + 1)));
    mkdirSync(pasta, { recursive: true });
    const arquivo = join(pasta, `dados-${createHash('sha256').update(corpo).digest('hex').slice(0, 16)}`);
    if (!existsSync(arquivo)) writeFileSync(arquivo, corpo);
    return arquivo;
  }
  if (src.startsWith(base)) {
    let caminho;
    try { caminho = decodeURIComponent(new URL(src).pathname); } catch { caminho = null; }
    if (caminho && !caminho.split('/').includes('..')) {
      const arquivo = join(pacote, normalize(caminho));
      if (arquivo.startsWith(`${pacote}/`)) return arquivo;
    }
  }
  throw new Error(`fonte de áudio fora do pacote (o render não tem rede): ${src.slice(0, 160)}`);
}

// ---------- ffprobe e o ffmpeg único ----------

// ---------- filhos (ffmpeg e ffprobe): tempo-limite e morte junto com o processo ----------

const filhos = new Set();
export const filhosAtivos = () => filhos;
const matarFilhos = () => { for (const f of filhos) { try { f.kill('SIGKILL'); } catch {} } };
process.on('exit', matarFilhos);
let aoSair = null;
// SIGTERM (o timeout do rodar.sh, o kill do usuário): mata os filhos, roda a limpeza e sai com 143.
export function aoTerminar(limpeza) {
  aoSair = limpeza;
  if (!process.listeners('SIGTERM').includes(terminar)) process.on('SIGTERM', terminar);
}
function terminar() {
  matarFilhos();
  try { aoSair?.(); } catch {}
  process.exit(143);
}

// Canais, duração e start_time da faixa de áudio, como o get-audio-channels.ts: a mesma saída (default=nw=1) e as
// mesmas regex. Negativo ou N/A não casa e vira 0; o start_time do MP3 é atraso do codificador e é ignorado.
export function lerSonda(texto) {
  const canais = /channels=([0-9]+)/.exec(texto), duracao = /duration=([0-9.]+)/.exec(texto);
  const inicio = /start_time=([0-9.]+)/.exec(texto), formato = /format_name=([a-zA-Z0-9.]+)/.exec(texto);
  return { canais: canais ? parseInt(canais[1], 10) : 0, duracaoMidia: duracao ? parseFloat(duracao[1]) : null,
    inicioMidia: inicio && formato?.[1] !== 'mp3' ? parseFloat(inicio[1]) : 0 };
}

export function sondar(arquivo, { ffprobe = 'ffprobe', faixa = 0, tempoLimite = 30000 } = {}) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-select_streams', `a:${faixa}`, '-show_entries',
    'stream=channels:stream=start_time:format=duration:format=format_name', '-of', 'default=nw=1', arquivo],
  { encoding: 'utf8', env: ambiente(ffprobe), timeout: tempoLimite, killSignal: 'SIGKILL' });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`ffprobe passou do tempo-limite de ${tempoLimite} ms em ${arquivo}`);
  if (r.status !== 0) throw new Error(`ffprobe falhou em ${arquivo}: ${String(r.stderr).slice(0, 300)}`);
  return lerSonda(r.stdout);
}

// Rótulo da entrada no grafo: como o Remotion, que só passa -map 0:a:N quando N não é 0.
export const rotuloEntrada = (i, faixa) => (faixa ? `${i}:a:${faixa}` : `${i}:a`);

/**
 * P10.5 e P01: a entrada do vídeo cru do motor (H.264 ou HEVC) no ffmpeg que monta o MP4, com o qps da composição. O
 * NVENC grava o qps da composição no VUI (nativo/src/lib.rs, opção `qps`), e o x264 o do -framerate do codificador da
 * CPU. Antes do P01 o NVENC gravava sempre 30 e o HEVC precisava do VUI reescrito (hevc_metadata); o teste dos 25 qps
 * em H.264 e em HEVC (cli/render.test.ts) guarda isso.
 * Os tempos vêm do -r na entrada (qps constante, quadro n em n / qps), não do -framerate: com ele, o ffmpeg contava os
 * tempos do fluxo cru em microssegundos truncados (33333 µs a 30 qps) e o MP4 derivava 3 ms em 9000 quadros
 * (composicao/audio.test.ts, «MP4 montado do fluxo cru»).
 */
export function entradaDoVideo(video, fps) {
  return { entrada: ['-r', String(fps), '-i', video], filtro: [] };
}

// Coletor usado pelo main.ts: guarda os assets por quadro e, no fim, roda o ffmpeg único.
export class ColetorDeAudio {
  constructor({ pasta, taxa = 48000, fps, primeiro, base, pacote }) {
    this.pasta = pasta; this.taxa = taxa; this.fps = fps; this.primeiro = primeiro; this.base = base; this.pacote = pacote;
    this.quadros = []; this.assets = 0;
    this.origens = new Map();
  }

  // Arquivo da fonte, resolvido na primeira vez que a src aparece: fonte fora do pacote falha já nesse quadro.
  #origem(src) {
    if (!this.origens.has(src)) this.origens.set(src, origemDoAsset(src, { base: this.base, pacote: this.pacote, pasta: join(this.pasta, 'dados') }));
    return this.origens.get(src);
  }

  // Assets do quadro de saída n (índice absoluto da composição).
  quadro(n, assets, totalQuadros) {
    const i = n - this.primeiro;
    this.quadros[i] = [];
    for (const a of assets ?? []) {
      if (a.type !== 'audio' && a.type !== 'video') continue;
      this.#origem(a.src);
      this.quadros[i].push(a);
      this.assets++;
    }
  }

  // Mistura e grava o MP4 com o vídeo (copy). Devolve o resumo, ou null se não havia áudio.
  // tempoLimite: padrão de 120 s mais 2 s por segundo de vídeo; passou disso, o ffmpeg é morto e a mistura falha.
  async misturar({ video, saida, totalQuadros, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', codificador = ['-c:a', 'aac', '-b:a', '320k'],
    tempoLimite = 120000 + (2000 * totalQuadros) / this.fps }) {
    try {
      const sondas = new Map();
      const trilhas = [];
      const duracaoVideo = totalQuadros / this.fps;
      for (const t of trechos(Array.from({ length: totalQuadros }, (_, i) => this.quadros[i] ?? []))) {
        const arquivo = this.#origem(t.src);
        const chave = `${arquivo}#${t.audioStreamIndex}`;
        if (!sondas.has(chave)) sondas.set(chave, sondar(arquivo, { ffprobe, faixa: t.audioStreamIndex }));
        const s = sondas.get(chave);
        const filtro = (e, s2) => filtroTrilha({ trecho: t, fps: this.fps, duracaoVideo, taxa: this.taxa, ...s,
          entrada: rotuloEntrada(Number(e.split(':')[0]), t.audioStreamIndex), saida: s2 });
        if (filtro('1:a', 'S') === null) continue;
        trilhas.push({ arquivo, faixa: t.audioStreamIndex, filtro });
      }
      const totalAmostras = Math.round(duracaoVideo * this.taxa);
      const m = montarMistura({ trilhas, totalAmostras });
      if (!m) return null;
      // O roteiro do filtro fica ao lado do MP4 (pequeno; serve para conferir a mistura).
      const roteiro = saida.replace(/\.[^.]+$/, '-mistura.txt');
      writeFileSync(roteiro, m.filtro);
      // -benchmark só escreve no nível info: o CPU (utime + stime) do ffmpeg da mistura vem dele.
      const v = entradaDoVideo(video, this.fps);
      const args = ['-hide_banner', '-v', 'info', '-nostats', '-benchmark', '-y', ...v.entrada,
        ...m.entradas.flatMap((e) => ['-i', e]), '-/filter_complex', roteiro, '-map', '0:v', '-map', '[audio]',
        '-c:v', 'copy', ...v.filtro, ...codificador, '-ar', String(this.taxa), '-video_track_timescale', '90000', '-movflags', '+faststart', saida];
      const t0 = performance.now();
      const { codigo, erro, estourou } = await new Promise((ok) => {
        const p = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], env: ambiente(ffmpeg) });
        filhos.add(p);
        let erro = '', estourou = false;
        const relogio = setTimeout(() => { estourou = true; p.kill('SIGKILL'); }, tempoLimite);
        p.stderr.on('data', (d) => { erro += d; });
        p.on('error', (e) => { clearTimeout(relogio); filhos.delete(p); ok({ codigo: -1, erro: String(e) }); });
        p.on('close', (codigo) => { clearTimeout(relogio); filhos.delete(p); ok({ codigo, erro, estourou }); });
      });
      if (estourou) throw new Error(`ffmpeg da mistura passou do tempo-limite de ${Math.round(tempoLimite)} ms e foi morto`);
      const bench = /utime=([\d.]+)s stime=([\d.]+)s rtime=([\d.]+)s/.exec(erro);
      if (codigo !== 0) throw new Error(`ffmpeg da mistura saiu com ${codigo}: ${erro.slice(-800)}`);
      return { trilhas: trilhas.length, assets: this.assets, entradas: m.entradas.length, saida, paredeMistura: Number(((performance.now() - t0) / 1000).toFixed(3)),
        cpuMistura: bench ? Number((Number(bench[1]) + Number(bench[2])).toFixed(3)) : null };
    } finally {
      this.limpar();
    }
  }

  // P13: os assets por quadro, para misturar noutro processo (páginas em paralelo). A src da pasta vira relativa à
  // base (cada página tem o seu servidor e a sua porta); data: fica como está.
  exportar() {
    const relativa = (src) => (src.startsWith(this.base) ? src.slice(this.base.length) : src);
    return { fps: this.fps, primeiro: this.primeiro,
      quadros: Array.from(this.quadros, (q) => (q ?? []).map((a) => ({ ...a, src: relativa(a.src) }))) };
  }

  // P13: junta neste coletor os assets que a página de um trecho exportou (exportar), com a src de volta na base dele.
  // A pasta da composição continua de pé depois da página.
  importar({ fps, primeiro, quadros }) {
    if (fps !== this.fps) throw new Error(`trecho com ${fps} qps num coletor de ${this.fps} qps`);
    if (primeiro < this.primeiro) throw new Error(`trecho começa no ${primeiro}, antes do primeiro quadro do coletor (${this.primeiro})`);
    quadros.forEach((assets, i) => this.quadro(primeiro + i,
      assets.map((a) => (a.src.startsWith('data:') ? a : { ...a, src: new URL(a.src, this.base).href })), 0));
  }

  limpar() { rmSync(this.pasta, { recursive: true, force: true }); }
}
