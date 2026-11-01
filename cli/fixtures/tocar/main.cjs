// P01: o MP4 do comando toca no Chromium? Abre o arquivo num <video> do Electron (o de dist/, sem remendo, como um
// navegador), servido por HTTP local com Range (como um portal), e devolve na última linha do stdout, em JSON: o
// canPlayType do H.264 High e do HEVC, o tamanho e a duração do vídeo e o primeiro quadro apresentado ao tocar
// (requestVideoFrameCallback: o tempo dele e os pixels RGB nos pontos pedidos). Erro de decodificação vem em `erro`.
// Uso: electron --no-sandbox --ozone-platform=headless --disable-gpu cli/fixtures/tocar/main.cjs <arquivo.mp4> '[[x,y],...]'
const { app, BrowserWindow } = require('electron');
const { createReadStream, statSync } = require('node:fs');
const { createServer } = require('node:http');

const [arquivo, pontos] = process.argv.slice(-2);
const tamanho = statSync(arquivo).size;

const pagina = (pontos) => `(async () => {
  const v = document.querySelector('video');
  const tipos = { h264: v.canPlayType('video/mp4; codecs="avc1.640028"'), hevc: v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"') };
  v.muted = true;
  v.src = '/video.mp4';
  const erro = await new Promise((ok) => {
    v.onloadeddata = () => ok(null);
    v.onerror = () => ok(v.error ? v.error.code + ': ' + v.error.message : 'erro sem código');
    setTimeout(() => ok('nenhum quadro em 15 s'), 15000);
  });
  if (erro) return { tipos, erro };
  // O quadro apresentado ao tocar, desenhado no canvas dentro do callback (antes dele, sem placa, o canvas sai preto).
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  const quadro = await new Promise((ok) => {
    v.requestVideoFrameCallback((_t, m) => {
      v.pause();
      g.drawImage(v, 0, 0);
      ok({ apresentados: m.presentedFrames, tempo: m.mediaTime,
        pixels: ${pontos}.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3)) });
    });
    v.play().catch((e) => ok({ erro: String(e) }));
    setTimeout(() => ok({ erro: 'nenhum quadro apresentado em 15 s' }), 15000);
  });
  return { tipos, largura: v.videoWidth, altura: v.videoHeight, duracao: v.duration, quadro };
})()`;

app.whenReady().then(async () => {
  const servidor = createServer((req, res) => {
    if (req.url !== '/video.mp4') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><video playsinline></video>');
    }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const inicio = m ? Number(m[1]) : 0, fim = m && m[2] ? Number(m[2]) : tamanho - 1;
    res.writeHead(m ? 206 : 200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': fim - inicio + 1,
      ...(m ? { 'content-range': `bytes ${inicio}-${fim}/${tamanho}` } : {}) });
    createReadStream(arquivo, { start: inicio, end: fim }).pipe(res);
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const janela = new BrowserWindow({ show: false, width: 320, height: 240, webPreferences: { backgroundThrottling: false } });
  await janela.loadURL(`http://127.0.0.1:${servidor.address().port}/`);
  const r = await janela.webContents.executeJavaScript(pagina(pontos));
  console.log(`tocar ${JSON.stringify(r)}`);
  app.exit(0);
}).catch((e) => { console.log(`tocar ${JSON.stringify({ erro: String(e) })}`); app.exit(1); });
