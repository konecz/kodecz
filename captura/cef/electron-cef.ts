// O pedaço da API do Electron que o captura/main.ts usa, feito sobre o host do CEF (P02). Com o gancho de
// captura/cef/ganchos.ts, o `import { app, BrowserWindow } from 'electron'` do main.ts chega aqui e ele roda no Node,
// sem mudança: a mesma moldura, o mesmo laço do quadro N, a mesma marca e o mesmo áudio. O que muda é o navegador
// (CEF 156 pronto, sem o remendo no binário) e o caminho do quadro: o dmabuf fica no host e vai direto ao núcleo do
// M02 (captura/cef/nativo-cef.ts).
//
// O que existe (o que o main.ts e o navegador-em-espera.ts chamam):
//   app: commandLine.appendSwitch, whenReady, on/removeListener (sem efeito), exit;
//   BrowserWindow: new (largura, altura, transparent, backgroundColor, offscreen.useSharedTexture), getAllWindows,
//     setContentSize, destroy, webContents;
//   webContents: setFrameRate, loadURL, executeJavaScript, debugger (attach, sendCommand, on('message'), detach),
//     mainFrame (url, frames, osProcessId, executeJavaScript), session (protocol.handle, webRequest.onBeforeRequest,
//     fetch), setWindowOpenHandler, eventos 'paint', 'console-message' e 'will-frame-navigate', stopPainting,
//     getUserAgent; fora do Electron (P13, experimento): offscreen.batidaExterna e baterQuadro.
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Host, type Evento } from "./host.ts";

let host: Host | null = null;
const opcoes: string[] = [];
const janelas: BrowserWindow[] = [];
/** O paint que a thread de UI do CEF está segurando agora (o `quadroMarcado` do nativo-cef.ts usa este). */
let paintAtual: { id: number; liberado: boolean } | null = null;
/** Ids das mensagens do CDP e das avaliações, únicos no host (pode haver mais de uma janela na vida dele). */
let seqCdp = 0, seqAvaliar = 0;

/** O host aberto (o nativo-cef.ts usa o mesmo). */
export function hostAberto(): Host {
  if (!host) throw new Error("o host do CEF não está aberto (app.whenReady)");
  return host;
}
/** O id do paint seguro agora, ou null (fora do evento, ou já liberado). */
export const idDoPaintAtual = () => (paintAtual && !paintAtual.liberado ? paintAtual.id : null);
/** O `marcado` libera o paint no host (uma ida e volta só): o `release()` que vem depois não manda nada. */
export function paintLiberadoPeloMarcado() {
  if (paintAtual) paintAtual.liberado = true;
}

function liberar() {
  if (paintAtual && !paintAtual.liberado) {
    paintAtual.liberado = true;
    hostAberto().avisar({ op: "liberar", id: paintAtual.id });
  }
}

let pronto: Promise<void> | null = null;

export const app = {
  commandLine: {
    appendSwitch(nome: string, valor = "") { opcoes.push(valor === "" ? `--${nome}` : `--${nome}=${valor}`); },
  },
  /** Abre o host com as opções do Chromium: as do appendSwitch e as da linha de comando do Node (as do render.ts). */
  whenReady(): Promise<void> {
    pronto ??= new Promise<void>((ok, falha) => {
      // MOTOR_CAPTURA_SANDBOX=1 (experimento): sem o --no-sandbox, o host liga o sandbox do Chromium.
      const sandbox = process.env.MOTOR_CAPTURA_SANDBOX === "1";
      const daLinha = process.argv.slice(2).filter((a) => a.startsWith("--") && !(sandbox && a === "--no-sandbox"));
      host = new Host({ argumentos: [...daLinha, ...opcoes], pasta: process.env.M04_SAIDA });
      host.once("pronto", () => ok());
      host.once("saiu", ({ codigo, sinal }) => {
        falha(new Error(`o host do CEF saiu antes de abrir (${codigo ?? sinal})`));
        if (!saindo) { console.log(`falhou: o host do CEF saiu (${codigo ?? sinal})`); process.exit(1); }
      });
    });
    return pronto;
  },
  on(_nome: string, _f: (...a: any[]) => void) { return app; },
  removeListener(_nome: string, _f: (...a: any[]) => void) { return app; },
  /** Como o app.exit do Electron: sai já, com o código; o host fecha antes (os filhos do Chromium junto). */
  exit(codigo = 0) {
    saindo = true;
    if (!host) process.exit(codigo);
    host.fechar(5000).finally(() => process.exit(codigo));
  },
};
let saindo = false;

type Contexto = { id: number; frameId: string };

class Quadro {
  wc: WebContents;
  id: string;
  constructor(wc: WebContents, id: string) { this.wc = wc; this.id = id; }
  get url(): string { return this.wc.urls.get(this.id) ?? ""; }
  /** Filhos diretos, como o `frames` do Electron. */
  get frames(): Quadro[] {
    return [...this.wc.pais.entries()].filter(([, pai]) => pai === this.id).map(([id]) => new Quadro(this.wc, id));
  }
  /**
   * O processo do quadro, como o Electron confere no main.ts (P08). O CDP desta sessão só vê os contextos dos
   * quadros do processo da moldura: um iframe fora do processo (OOPIF) é outro alvo, sem contexto aqui.
   */
  get osProcessId(): number {
    return this.id === this.wc.principal || this.wc.contextos.has(this.id) ? this.wc.pid : -1;
  }
  executeJavaScript(codigo: string, gesto = false): Promise<any> {
    return this.wc.avaliar(codigo, gesto, this.id === this.wc.principal ? undefined : this.id);
  }
  /**
   * Espera o que o CDP já tinha a dizer sobre os quadros. A resposta do `executeJavaScript` (evento `avaliado`, que vem
   * do renderer) e os eventos de quadro e de contexto do CDP (`Page.frameNavigated`, `Runtime.executionContextCreated`)
   * chegam por caminhos diferentes: o `load` do iframe pode ser respondido antes de o contexto dele ser visto, e o
   * `osProcessId` voltaria -1 (e a lista de `frames`, vazia) num iframe que está no processo certo. Uma ida e volta no
   * CDP, depois dessa resposta, só termina depois desses eventos, que o CDP entrega em ordem. No Electron o estado do
   * quadro é síncrono e não há o que esperar (quem chama usa `?.`).
   */
  async assentar(): Promise<void> {
    await this.wc.cdp("Page.getFrameTree", {});
  }
}

class Depurador extends EventEmitter {
  wc: WebContents;
  constructor(wc: WebContents) { super(); this.wc = wc; }
  attach(_versao?: string) {}
  detach() {}
  sendCommand(metodo: string, params: Record<string, unknown> = {}): Promise<any> { return this.wc.cdp(metodo, params); }
}

class WebContents extends EventEmitter {
  readonly debugger: Depurador;
  readonly session: any;
  readonly pid: number;
  urls = new Map<string, string>();
  pais = new Map<string, string>();
  contextos = new Map<string, number>();
  principal = "";
  private avaliando = new Map<number, { ok: (v: any) => void; falha: (e: Error) => void }>();
  /** Os ouvintes deste WebContents no host (soltos no destroy(): a janela seguinte não vê os eventos dele). */
  private ouvintes: [string, (e: Evento) => void][] = [];
  private ouvir(nome: string, f: (e: Evento) => void) {
    this.ouvintes.push([nome, f]);
    hostAberto().on(nome, f);
  }
  /** O destroy() do Electron: solta os ouvintes e fecha o navegador no host (o host continua aberto). */
  fechar() {
    for (const [nome, f] of this.ouvintes) hostAberto().off(nome, f);
    this.ouvintes = [];
    this.criada.then(() => hostAberto().comando({ cmd: "fecharJanela" }));
  }
  private esperando = new Map<number, { ok: (r: any) => void; falha: (e: Error) => void; metodo: string }>();
  private criada: Promise<void>;
  private antesDoPedido: ((d: any, ok: (r: { cancel?: boolean }) => void) => void) | null = null;
  private protocolos = new Map<string, (pedido: Request) => Promise<Response> | Response>();
  private abrirJanela: ((d: { url: string }) => unknown) | null = null;
  private carga: { ok: () => void; falha: (e: Error) => void } | null = null;
  private pedidosDeArquivo = 0;

  constructor(criar: Record<string, unknown>) {
    super();
    const h = hostAberto();
    this.pid = h.p.pid ?? 0;
    this.debugger = new Depurador(this);
    const wc = this;
    this.session = {
      protocol: { handle(esquema: string, f: (pedido: Request) => Promise<Response>) { wc.protocolos.set(esquema, f); } },
      webRequest: { onBeforeRequest(_filtro: unknown, f: (d: any, ok: (r: { cancel?: boolean }) => void) => void) { wc.antesDoPedido = f; } },
      // Só no M04_FONTES=preparar (a fonte do Google que falta no cache; captura/fontes.ts): o fetch do Node, fora do navegador.
      fetch: (url: string, o: RequestInit = {}) => fetch(url, o),
    };
    this.ouvir("cdp", (e: Evento) => this.aoCdp(e.mensagem));
    this.ouvir("paint", (e: Evento) => this.aoPaint(e));
    this.ouvir("pedido", (e: Evento) => { this.aoPedido(e).catch((erro) => { console.log(`falhou: pedido de rede: ${erro.message}`); h.comando({ cmd: "pedido", id: e.id, acao: "cancelar" }); }); });
    this.ouvir("navegar", (e: Evento) => this.aoNavegar(e));
    this.ouvir("popup", (e: Evento) => { this.abrirJanela?.({ url: e.url }); });
    this.ouvir("console", (e: Evento) => this.emit("console-message", { level: e.nivel, message: e.texto, sourceId: e.fonte, lineNumber: e.linha }));
    this.ouvir("carregou", () => { const c = this.carga; this.carga = null; c?.ok(); });
    this.ouvir("avaliado", (e: Evento) => {
      const a = this.avaliando.get(e.id);
      if (!a) return;
      this.avaliando.delete(e.id);
      if (e.ok) a.ok(e.valor);
      else a.falha(new Error(String(e.erro)));
    });
    this.ouvir("erroDeCarga", (e: Evento) => {
      // ERR_ABORTED (-3) vem quando outra navegação toma o lugar; o Electron também rejeita o loadURL nesse caso.
      const c = this.carga; this.carga = null;
      c?.falha(new Error(`${e.texto || "falha"} (${e.codigo}) carregando ${e.url}`));
    });
    this.criada = new Promise<void>((ok) => h.once("janela", () => ok())).then(async () => {
      // Quadros e contextos de execução, para o mainFrame.frames e o executeJavaScript no iframe.
      await this.cdp("Page.enable", {});
      await this.cdp("Runtime.enable", {});
      const arvore = await this.cdp("Page.getFrameTree", {});
      this.principal = arvore.frameTree.frame.id;
      this.urls.set(this.principal, arvore.frameTree.frame.url);
    });
    h.comando({ cmd: "janela", ...criar });
  }

  // ---- CDP

  cdp(metodo: string, params: Record<string, unknown>): Promise<any> {
    const id = ++seqCdp;
    return new Promise((ok, falha) => {
      this.esperando.set(id, { ok, falha, metodo });
      hostAberto().comando({ cmd: "cdp", mensagem: { id, method: metodo, params } });
    });
  }

  private aoCdp(m: any) {
    if (typeof m.id === "number") {
      const e = this.esperando.get(m.id);
      if (!e) return;
      this.esperando.delete(m.id);
      if (m.error) e.falha(new Error(`${e.metodo}: ${m.error.message}`));
      else e.ok(m.result ?? {});
      return;
    }
    const p = m.params ?? {};
    switch (m.method) {
      case "Page.frameAttached": this.pais.set(p.frameId, p.parentFrameId); break;
      case "Page.frameNavigated":
        this.urls.set(p.frame.id, p.frame.url + (p.frame.urlFragment ?? ""));
        if (p.frame.parentId) this.pais.set(p.frame.id, p.frame.parentId);
        else this.principal = p.frame.id;
        break;
      // URL trocada sem navegar (history.pushState/replaceState, âncora): o host acha o iframe pela URL de agora.
      case "Page.navigatedWithinDocument": this.urls.set(p.frameId, p.url); break;
      case "Page.frameDetached": this.pais.delete(p.frameId); this.urls.delete(p.frameId); this.contextos.delete(p.frameId); break;
      case "Runtime.executionContextCreated": {
        const c = p.context;
        if (c.auxData?.isDefault && c.auxData.frameId) this.contextos.set(c.auxData.frameId, c.id);
        break;
      }
      case "Runtime.executionContextDestroyed":
        for (const [f, id] of this.contextos) if (id === p.executionContextId) this.contextos.delete(f);
        break;
      case "Runtime.executionContextsCleared": this.contextos.clear(); break;
    }
    this.debugger.emit("message", {}, m.method, p);
  }

  /** O executeJavaScript do Electron: Runtime.evaluate com a promessa esperada e o valor devolvido. */
  async avaliar(codigo: string, gesto: boolean, quadro?: string): Promise<any> {
    await this.criada;
    // Pelo renderer (mensagem de processo, como o executeJavaScript do Electron), sem o inspetor do CDP: menos CPU
    // por quadro (P02, perfil). MOTOR_CAPTURA_AVALIAR=cdp volta ao Runtime.evaluate (para comparar).
    if (process.env.MOTOR_CAPTURA_AVALIAR !== "cdp") {
      const url = quadro === undefined ? null : this.urls.get(quadro);
      if (url === undefined) throw new Error(`o quadro ${quadro} não tem URL nesta sessão`);
      const id = ++seqAvaliar;
      return new Promise((ok, falha) => {
        this.avaliando.set(id, { ok, falha });
        hostAberto().comando({ cmd: "avaliar", id, codigo, url });
      });
    }
    const params: Record<string, unknown> = { expression: codigo, awaitPromise: true, returnByValue: true, userGesture: gesto };
    if (quadro !== undefined) {
      const ctx = this.contextos.get(quadro);
      if (ctx === undefined) throw new Error(`o quadro ${quadro} não tem contexto de execução nesta sessão`);
      params.contextId = ctx;
    }
    const r = await this.cdp("Runtime.evaluate", params);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      // Como o Electron: a primeira linha da descrição, com o nome do erro («Error: …»).
      const texto = d.exception?.description?.split("\n")[0] ?? d.exception?.value ?? d.text;
      throw new Error(String(texto));
    }
    return r.result?.value;
  }

  // ---- Paint

  private aoPaint(e: Evento) {
    const h = hostAberto();
    paintAtual = { id: e.id, liberado: false };
    try {
      if (e.textura) {
        const textura = {
          textureInfo: {
            handle: { nativePixmap: { planes: e.planos, modifier: e.modifier } },
            codedSize: { width: e.largura, height: e.altura },
            metadata: {},
          },
          release: liberar,
        };
        this.emit("paint", { texture: textura }, { x: 0, y: 0, width: e.largura, height: e.altura }, null);
      } else {
        // Modo CPU: o BGRA está no arquivo do quadro enquanto este paint estiver seguro.
        const imagem = { getSize: () => ({ width: e.largura, height: e.altura }), toBitmap: () => h.lerQuadro(e.largura * e.altura * 4) };
        this.emit("paint", {}, { x: 0, y: 0, width: e.largura, height: e.altura }, imagem);
      }
    } finally {
      liberar();
      paintAtual = null;
    }
  }

  // ---- Rede e navegação

  private async aoPedido(e: Evento) {
    const h = hostAberto();
    if (this.antesDoPedido) {
      const cancelar = await new Promise<boolean>((ok) => this.antesDoPedido!({ url: e.url, method: e.metodo }, (r) => ok(r?.cancel === true)));
      if (cancelar) { h.comando({ cmd: "pedido", id: e.id, acao: "cancelar" }); return; }
    }
    const tratar = this.protocolos.get(String(e.url).split(":")[0]);
    if (!tratar) { h.comando({ cmd: "pedido", id: e.id, acao: "continuar" }); return; }
    const r = await tratar(new Request(e.url, { method: e.metodo }));
    const corpo = Buffer.from(await r.arrayBuffer());
    const arquivo = join(h.pasta, `resposta-${++this.pedidosDeArquivo}`);
    writeFileSync(arquivo, corpo);
    const cabecalhos: Record<string, string> = {};
    r.headers.forEach((v, k) => { if (k !== "content-type") cabecalhos[k] = v; });
    const tipo = (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    h.comando({ cmd: "pedido", id: e.id, acao: "responder", status: r.status, tipo, cabecalhos, corpo: arquivo });
  }

  private aoNavegar(e: Evento) {
    let negado = false;
    try {
      this.emit("will-frame-navigate", { url: e.url, isMainFrame: e.principal, preventDefault: () => { negado = true; } });
    } finally {
      hostAberto().avisar({ op: "navegar", id: e.id, permitir: !negado });
    }
  }

  // ---- O resto da API

  async loadURL(url: string): Promise<void> {
    await this.criada;
    const carregou = new Promise<void>((ok, falha) => { this.carga = { ok, falha }; });
    hostAberto().comando({ cmd: "carregar", url });
    await carregou;
  }
  executeJavaScript(codigo: string, gesto = false) { return this.avaliar(codigo, gesto); }
  get mainFrame() { return new Quadro(this, this.principal); }
  setFrameRate(qps: number) { this.criada.then(() => hostAberto().comando({ cmd: "qps", valor: qps })); }
  setWindowOpenHandler(f: (d: { url: string }) => unknown) { this.abrirJanela = f; }
  stopPainting() { hostAberto().comando({ cmd: "parar" }); }
  /** P13: uma batida de quadro no compositor (só na janela criada com offscreen.batidaExterna). */
  baterQuadro() { hostAberto().comando({ cmd: "batida" }); }
  getUserAgent() { return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.48 Safari/537.36"; }
  redimensionar(largura: number, altura: number) { this.criada.then(() => hostAberto().comando({ cmd: "tamanho", largura, altura })); }
}

export class BrowserWindow {
  readonly webContents: WebContents;
  static getAllWindows() { return [...janelas]; }
  constructor(o: any = {}) {
    const offscreen = o.webPreferences?.offscreen;
    const textura = typeof offscreen === "object" ? offscreen.useSharedTexture === true : false;
    // P13 (experimento, fora da API do Electron): o compositor só faz quadro no webContents.baterQuadro().
    const batidaExterna = typeof offscreen === "object" && offscreen.batidaExterna === true;
    // Placa: transparente (alfa ao HEVC); CPU: opaca, fundo preto (o main.ts pede #000000).
    this.webContents = new WebContents({ largura: o.width ?? 800, altura: o.height ?? 600, transparente: o.transparent === true, qps: 60, textura,
      batidaExterna });
    janelas.push(this);
  }
  setContentSize(largura: number, altura: number) { this.webContents.redimensionar(largura, altura); }
  loadURL(url: string) { return this.webContents.loadURL(url); }
  destroy() {
    const i = janelas.indexOf(this);
    if (i < 0) return;
    janelas.splice(i, 1);
    this.webContents.fechar();
  }
}

export default { app, BrowserWindow };
