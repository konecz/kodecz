// C01 (docs/experimentos/2026-10-c01-quadro-repetido-sem-nvenc.md, seção «Chromium»).
// O Chromium do Electron do motor toca o MP4? Abre um <video> com cada arquivo da linha de comando, toca até o
// fim (muted, 4×) e imprime uma linha JSON por arquivo: canPlayType, erro, duração e getVideoPlaybackQuality()
// (quadros decodificados, corrompidos, descartados) e os quadros apresentados (requestVideoFrameCallback).
// Uso: electron cli/fixtures/tocar-ate-o-fim/ --ozone-platform=headless <a.mp4> [b.mp4 ...]
const { app, BrowserWindow } = require('electron');
const { pathToFileURL } = require('node:url');

const arquivos = process.argv.slice(2).filter((a) => a.endsWith('.mp4'));

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 640, height: 360, webPreferences: { webSecurity: false } });
  await w.loadURL('data:text/html,<body></body>');
  for (const a of arquivos) {
    const url = pathToFileURL(a).href;
    const r = await w.webContents.executeJavaScript(`new Promise((ok) => {
      const v = document.createElement('video');
      const tipo = { hevc: v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"'), h264: v.canPlayType('video/mp4; codecs="avc1.640028"') };
      let apresentados = 0;
      const conta = () => { apresentados++; v.requestVideoFrameCallback(conta); };
      v.requestVideoFrameCallback(conta);
      const fim = (erro) => { const q = v.getVideoPlaybackQuality();
        ok({ tipo, erro, duracao: v.duration, decodificados: q.totalVideoFrames, corrompidos: q.corruptedVideoFrames,
          descartados: q.droppedVideoFrames, apresentados }); };
      v.onended = () => fim(null);
      v.onerror = () => fim(v.error ? v.error.code + ' ' + v.error.message : 'erro');
      setTimeout(() => fim('tempo esgotado'), 20000);
      v.muted = true; v.playbackRate = 4; v.src = ${JSON.stringify(url)};
      document.body.append(v);
      v.play().catch((e) => fim(String(e)));
    })`);
    console.log(JSON.stringify({ arquivo: a.split('/').pop(), ...r }));
  }
  app.quit();
});
