// Teste do electron-cef.ts com um host falso (Node), sem CEF nem placa: a corrida entre a resposta do load do iframe
// (evento `avaliado`) e os eventos de quadro e contexto do CDP (S01: «GSAP fora da window.gsap» caía às vezes com «a
// composição abriu noutro processo (-1, ...)»). O host falso reproduz a ordem ruim: responde o `avaliar` na hora e só
// entrega os eventos do iframe quando chega o próximo pedido do CDP, antes da resposta dele (o CDP é em ordem).
// Limite: o host falso cumpre por construção a ordem do CDP que o conserto supõe (eventos antes da resposta do mesmo
// canal); quem prova essa ordem no Chromium é o laço do teste GSAP fora da window.gsap com o host de verdade.
// Rodar: node --test captura/cef/electron-cef.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "host-falso-"));
after(() => rmSync(pasta, { recursive: true, force: true }));
const falso = join(pasta, "motor-captura");
writeFileSync(falso, `#!/usr/bin/env node
const { openSync } = require("node:fs");
openSync(process.env.MOTOR_CAPTURA_RESPOSTAS, "r+");
const dizer = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const cdp = (mensagem) => dizer({ evento: "cdp", mensagem });
const evento = (method, params) => cdp({ method, params });
const raiz = { id: "M", url: "http://127.0.0.1:1/__motor/moldura.html" };
let atrasados = null, resto = "";
dizer({ evento: "pronto", pid: 4242 });
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  const linhas = (resto + d).split("\\n"); resto = linhas.pop();
  for (const l of linhas.filter(Boolean)) {
    const c = JSON.parse(l);
    if (c.cmd === "sair") process.exit(0);
    else if (c.cmd === "janela") dizer({ evento: "janela" });
    else if (c.cmd === "avaliar") {
      // O iframe navega: o renderer responde o load já, e os eventos do CDP ficam para depois.
      atrasados = () => {
        evento("Page.frameAttached", { frameId: "F", parentFrameId: "M" });
        evento("Page.frameNavigated", { frame: { id: "F", parentId: "M", url: "http://127.0.0.1:2/index.html" } });
        evento("Runtime.executionContextCreated", { context: { id: 7, auxData: { isDefault: true, frameId: "F" } } });
      };
      dizer({ evento: "avaliado", id: c.id, ok: true, valor: true });
      setTimeout(() => { atrasados?.(); atrasados = null; }, 1500);
    } else if (c.cmd === "cdp") {
      const m = c.mensagem;
      if (m.method === "Page.getFrameTree") { atrasados?.(); atrasados = null; cdp({ id: m.id, result: { frameTree: { frame: raiz } } }); }
      else cdp({ id: m.id, result: {} });
    }
  }
});
`);
chmodSync(falso, 0o755);
process.env.MOTOR_CAPTURA_EXE = falso;
const { app, BrowserWindow, hostAberto } = await import("./electron-cef.ts");

test("o iframe visto depois do load tem o processo da moldura depois de assentar", async () => {
  await app.whenReady();
  const janela = new BrowserWindow({ width: 100, height: 100 });
  const wc = janela.webContents;
  try {
    await wc.executeJavaScript("motor_abrir()", true);
    // Sem assentar: o load voltou, mas o CDP ainda não disse nada do iframe (a corrida; osProcessId daria -1).
    assert.equal(wc.mainFrame.frames.length, 0);
    await wc.mainFrame.assentar();
    const iframe = wc.mainFrame.frames.find((f) => f.url.endsWith("/index.html"));
    assert.ok(iframe, "iframe do pacote não encontrado");
    assert.notEqual(iframe.osProcessId, -1);
    assert.equal(iframe.osProcessId, wc.mainFrame.osProcessId);
  } finally {
    const h = hostAberto();
    h.removeAllListeners("saiu"); // o app.exit do shim sairia do teste inteiro com 1
    await h.fechar(2000);
  }
});
