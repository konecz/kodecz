// Abertura rápida (serviço): o navegador (o CEF, pela casca electron-cef.ts dos ganchos) sobe antes do job, deixa o
// processo do navegador e o da GPU de pé (uma janela
// fora da tela descartável, que pinta um quadro e fecha) e espera as variáveis do job numa linha JSON no stdin. Com
// elas, carrega o captura/main.ts (caminho em MOTOR_ESPERA_MAIN) como se tivesse sido aberto com essas variáveis:
// dali em diante é o render de sempre, um job só, e o processo sai no fim, como no frio.
// Avisa no stdout «espera: pronto» quando está de pé. Protocolo interno do cli/abertura.ts: o do serviço com o processo
// quente (render.ts --esperar) não depende do navegador.
import { app, BrowserWindow } from 'electron';

// Antes do ready, como o main.ts faz (lá ele chega depois do ready, e o Chromium já leu a linha de comando).
app.commandLine.appendSwitch('hide-scrollbars');
const ficar = () => {};
// Sem isso, fechar a janela descartável encerraria o app (o padrão da API do Electron, que a casca segue).
app.on('window-all-closed', ficar);

function linhaDoStdin() {
  return new Promise((ok, falha) => {
    let texto = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => {
      texto += d;
      const i = texto.indexOf('\n');
      if (i >= 0) { process.stdin.removeAllListeners(); process.stdin.destroy(); ok(texto.slice(0, i)); }
    });
    process.stdin.once('end', () => falha(new Error('stdin fechou sem o job')));
  });
}

app.whenReady().then(async () => {
  // Processo da GPU e compositor fora da tela de pé: um quadro pintado numa partição em memória só desta janela.
  const janela = new BrowserWindow({ width: 64, height: 64, show: false, transparent: true,
    webPreferences: { offscreen: { useSharedTexture: true }, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'motor-aquecer' } });
  const pintou = new Promise((ok) => { janela.webContents.on('paint', (e) => { try { e.texture?.release(); } catch {} ok(); }); setTimeout(ok, 3000); });
  await janela.loadURL('data:text/html,<body style="background:%23000"></body>');
  await pintou;
  janela.destroy();
  console.log('espera: pronto');
  let job;
  try { job = JSON.parse(await linhaDoStdin()); } catch (e) { console.log(`falhou: job inválido: ${e.message}`); app.exit(2); return; }
  for (const [k, v] of Object.entries(job)) process.env[k] = String(v);
  app.removeListener('window-all-closed', ficar);
  await import(process.env.MOTOR_ESPERA_MAIN);
}).catch((e) => { console.log(`falhou: ${e.stack ?? e}`); app.exit(1); });
