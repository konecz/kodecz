// Controlador do host da captura pelo CEF (P02): sobe o `motor-captura` (Rust, captura/cef/src/main.rs) e fala com ele
// pelo protocolo de captura/cef/src/protocolo.rs, em linhas JSON:
//   - comandos no stdin do host e eventos no stdout dele (assíncronos);
//   - operações síncronas por um par de FIFOs: o que o código do Electron espera sem voltar ao laço do Node (o
//     `quadroMarcado` dentro do evento `paint`, o `fechar` do motor) e as decisões que seguram a thread de UI do CEF
//     (liberar o paint, permitir a navegação).
// Os pixels do paint da CPU e os conferidos da placa (só com conferência; R04) passam por um arquivo, não pelo pipe.
// TypeScript só com sintaxe apagável: roda direto no Node 24.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { closeSync, existsSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const AQUI = dirname(new URL(import.meta.url).pathname);
/** O executável do host, montado por captura/cef/montar.sh (fora do git). MOTOR_CAPTURA_EXE troca. */
export const EXECUTAVEL = process.env.MOTOR_CAPTURA_EXE ?? join(AQUI, "target", "release", "motor-captura");

export type Evento = { evento: string; [k: string]: any };

/** Erro do host (o processo saiu, ou a resposta de uma operação síncrona trouxe `erro`). */
export class ErroDoHost extends Error {}

/**
 * Um host aberto. `eventos` emite cada evento pelo nome (`paint`, `cdp`, `pedido`, `navegar`, …) na ordem de chegada;
 * `comando` manda sem esperar; `pedir` espera a resposta parada (bloqueia o laço do Node, de propósito).
 */
export class Host extends EventEmitter {
  readonly p: ChildProcess;
  readonly pasta: string;
  readonly arquivoDoQuadro: string;
  private pedidos: number;
  private respostas: number | null = null;
  private fifoRespostas: string;
  private quadroFd: number | null = null;
  private resto = "";
  /** MOTOR_CAPTURA_CONTAR=1: conta os eventos por tipo e os mostra no stderr ao fechar (perfil). */
  private contagem: Record<string, number> | null = process.env.MOTOR_CAPTURA_CONTAR === "1" ? {} : null;
  private sobra = Buffer.alloc(0);
  saiu: Promise<number | null>;

  constructor({ argumentos = [], env = process.env, pasta }: { argumentos?: string[]; env?: NodeJS.ProcessEnv; pasta?: string } = {}) {
    super();
    if (!existsSync(EXECUTAVEL)) throw new ErroDoHost(`falta o host do CEF (${EXECUTAVEL}): captura/cef/montar.sh`);
    this.pasta = mkdtempSync(join(pasta ?? tmpdir(), "captura-"));
    const fifoPedidos = join(this.pasta, "pedidos"), fifoRespostas = join(this.pasta, "respostas");
    for (const f of [fifoPedidos, fifoRespostas]) {
      const r = spawnSync("mkfifo", ["-m", "600", f]);
      if (r.status !== 0) throw new ErroDoHost(`mkfifo ${f}: ${r.stderr}`);
    }
    // Pedidos: leitura e escrita (abrir não bloqueia esperando o host). Respostas: só leitura, aberta quando o host
    // avisa «pronto» (ele já a abriu): sem uma ponta de escrita aqui, a morte do host no meio de um `pedir` vira o fim
    // da FIFO e o `pedir` lança, em vez de o Node ficar parado na leitura (achado da revisão do P02).
    this.pedidos = openSync(fifoPedidos, "r+");
    this.fifoRespostas = fifoRespostas;
    this.arquivoDoQuadro = join(this.pasta, "quadro.bgra");
    this.p = spawn(EXECUTAVEL, argumentos, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...env, MOTOR_CAPTURA_PEDIDOS: fifoPedidos, MOTOR_CAPTURA_RESPOSTAS: fifoRespostas,
        MOTOR_CAPTURA_QUADRO: this.arquivoDoQuadro, MOTOR_CAPTURA_CACHE: join(this.pasta, "cache") },
    });
    this.saiu = new Promise((ok) => this.p.once("exit", (c, s) => ok(c ?? (s ? -1 : null))));
    this.p.once("exit", (c, s) => this.emit("saiu", { codigo: c, sinal: s }));
    this.p.stdout!.setEncoding("utf8");
    this.p.stdout!.on("data", (d: string) => {
      const partes = (this.resto + d).split("\n");
      this.resto = partes.pop()!;
      for (const l of partes) if (l) this.receber(l);
    });
    // Sem o host, os pedidos síncronos não teriam resposta: o stdin fechado faz o host sair.
    this.p.stdin!.on("error", () => {});
  }

  private receber(linha: string) {
    let e: Evento;
    try { e = JSON.parse(linha); } catch { this.emit("erro", new ErroDoHost(`evento inválido: ${linha.slice(0, 200)}`)); return; }
    if (e.evento === "pronto" && this.respostas === null) this.respostas = openSync(this.fifoRespostas, "r");
    if (this.contagem) {
      const k = e.evento === "cdp" ? `cdp:${e.mensagem?.method ?? "resposta"}` : e.evento;
      this.contagem[k] = (this.contagem[k] ?? 0) + 1;
    }
    // Sem ninguém ouvindo (entre a janela de aquecimento e a do job), o que segura o host é solto aqui, fechado por
    // padrão: o paint é liberado, a navegação negada e o pedido de rede cancelado.
    if (this.listenerCount(e.evento) === 0) {
      if (e.evento === "paint") this.avisar({ op: "liberar", id: e.id });
      else if (e.evento === "navegar") this.avisar({ op: "navegar", id: e.id, permitir: false });
      else if (e.evento === "pedido") this.comando({ cmd: "pedido", id: e.id, acao: "cancelar" });
      return;
    }
    this.emit(e.evento, e);
  }

  comando(c: Record<string, unknown>) {
    if (this.p.exitCode !== null || this.p.signalCode !== null) return;
    this.p.stdin!.write(`${JSON.stringify(c)}\n`);
  }

  /** Operação síncrona sem resposta (`liberar`, `navegar`). */
  avisar(op: Record<string, unknown>) {
    writeSync(this.pedidos, `${JSON.stringify(op)}\n`);
  }

  /** Operação síncrona com resposta: espera parada a linha da FIFO de respostas. Resposta com `erro` lança. */
  pedir(op: Record<string, unknown>): any {
    this.avisar(op);
    const pedaco = Buffer.alloc(65536);
    for (;;) {
      const i = this.sobra.indexOf(10);
      if (i >= 0) {
        const linha = this.sobra.subarray(0, i).toString("utf8");
        this.sobra = this.sobra.subarray(i + 1);
        const r = JSON.parse(linha);
        if (r.erro) throw new ErroDoHost(String(r.erro));
        return r;
      }
      if (this.respostas === null) throw new ErroDoHost("o host ainda não avisou «pronto»");
      const n = readSync(this.respostas, pedaco, 0, pedaco.length, null);
      if (n <= 0) throw new ErroDoHost("a FIFO de respostas fechou");
      this.sobra = Buffer.concat([this.sobra, pedaco.subarray(0, n)]);
    }
  }

  /** Os `bytes` primeiros do arquivo do quadro (cópia nova: quem chama pode guardar). */
  lerQuadro(bytes: number): Buffer {
    this.quadroFd ??= openSync(this.arquivoDoQuadro, "r");
    const b = Buffer.allocUnsafe(bytes);
    let lidos = 0;
    while (lidos < bytes) {
      const n = readSync(this.quadroFd, b, lidos, bytes - lidos, lidos);
      if (n <= 0) throw new ErroDoHost(`arquivo do quadro curto: ${lidos} de ${bytes} bytes`);
      lidos += n;
    }
    return b;
  }

  /** Pede a saída, espera até `ms` e mata se for preciso. Apaga a pasta (FIFOs, quadro, cache). */
  async fechar(ms = 5000): Promise<void> {
    if (this.contagem) process.stderr.write(`motor-captura: eventos ${JSON.stringify(this.contagem)}\n`);
    this.comando({ cmd: "sair" });
    this.p.stdin!.end();
    const morto = await Promise.race([this.saiu.then(() => true), new Promise<boolean>((ok) => setTimeout(ok, ms, false))]);
    if (!morto) { try { this.p.kill("SIGKILL"); } catch {} await this.saiu; }
    for (const fd of [this.pedidos, this.respostas, this.quadroFd]) if (fd !== null) { try { closeSync(fd); } catch {} }
    rmSync(this.pasta, { recursive: true, force: true });
  }
}

/** Caminho absoluto de um arquivo desta pasta (para o gancho do Node). */
export const daqui = (nome: string) => resolve(AQUI, nome);
