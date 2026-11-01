// Recursos do comando de render (M08): cada filho (weston, a captura com o host do CEF, ffmpeg) sobe no seu grupo de
// processos, e o grupo inteiro morre no fim, no erro e no sinal, com os netos (os processos do Chromium, o ffmpeg
// que a captura abre). As pastas temporárias e a saída pela metade são apagadas (ARCHITECTURE.md, invariante «nenhum
// processo filho sobrevive ao render»).
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** O grupo `pgid` ainda tem processo vivo. */
export function grupoVivo(pgid: number): boolean {
  try { process.kill(-pgid, 0); return true; } catch { return false; }
}

const SINAIS = { SIGTERM: 143, SIGINT: 130, SIGHUP: 129 } as const;

export class Recursos {
  manter: boolean;
  espera: number;
  grupos = new Set<number>();
  pastas: string[] = [];
  parciais: string[] = [];
  liberado = false;
  aoIniciar: ((pid: number, comando: string) => void) | null;

  constructor({ manter = false, espera = 2000, aoIniciar = null }:
    { manter?: boolean; espera?: number; aoIniciar?: ((pid: number, comando: string) => void) | null } = {}) {
    this.manter = manter;
    this.espera = espera;
    this.aoIniciar = aoIniciar;
  }

  /** Pasta temporária própria, apagada no fim (a não ser com --manter). */
  pasta(prefixo: string): string {
    const p = mkdtempSync(join(tmpdir(), prefixo));
    this.pastas.push(p);
    return p;
  }

  /** Arquivo de saída ainda incompleto: apagado se o render não chegar ao fim (soltar() o tira da lista). */
  parcial(arquivo: string): void { this.parciais.push(arquivo); }
  soltar(arquivo: string): void { this.parciais = this.parciais.filter((p) => p !== arquivo); }

  /** Sobe o filho num grupo próprio (detached), para matar o grupo inteiro depois. */
  iniciar(comando: string, args: string[], opcoes: SpawnOptions = {}): ChildProcess {
    const p = spawn(comando, args, { stdio: "ignore", ...opcoes, detached: true });
    if (p.pid) { this.grupos.add(p.pid); this.aoIniciar?.(p.pid, comando); }
    return p;
  }

  private liberando: Promise<void> | null = null;

  /**
   * SIGTERM em cada grupo; quem não morrer na espera leva SIGKILL. Depois, pastas e parciais. Chamado de novo durante
   * a liberação (o sinal e o erro do filho morto ao mesmo tempo), devolve a mesma espera: quem chama e sai do processo
   * logo depois não corta a liberação no meio (sobrava a temporária).
   */
  liberar(): Promise<void> {
    this.liberado = true;
    return (this.liberando ??= this.liberarAgora());
  }

  private async liberarAgora(): Promise<void> {
    const vivos = [...this.grupos].filter(grupoVivo);
    for (const g of vivos) { try { process.kill(-g, "SIGTERM"); } catch { /* já morreu */ } }
    const limite = performance.now() + this.espera;
    while (vivos.some(grupoVivo) && performance.now() < limite) await new Promise((ok) => setTimeout(ok, 25));
    for (const g of vivos) { try { process.kill(-g, "SIGKILL"); } catch { /* já morreu */ } }
    // O filho direto morto fica zumbi (e o grupo «vivo») até o Node colher a saída dele: espera até 1 s.
    const colher = performance.now() + 1000;
    while (vivos.some(grupoVivo) && performance.now() < colher) await new Promise((ok) => setTimeout(ok, 10));
    for (const a of this.parciais) rmSync(a, { force: true });
    if (!this.manter) for (const p of this.pastas) rmSync(p, { recursive: true, force: true });
  }

  /**
   * SIGTERM, SIGINT e SIGHUP: libera tudo e sai com 128 + o primeiro sinal. Os sinais seguintes são ignorados até a
   * liberação acabar: com `once`, o segundo (Ctrl+C duas vezes, o timeout depois do TERM) matava o Node no meio da
   * espera e deixava órfão o filho que ainda não tinha morrido.
   */
  aoSinal(): void {
    let primeiro: string | null = null;
    for (const [sinal, codigo] of Object.entries(SINAIS)) {
      process.on(sinal, () => {
        if (primeiro) { process.stderr.write(`motor: ${sinal} ignorado: ainda encerrando depois do ${primeiro}\n`); return; }
        primeiro = sinal;
        process.stderr.write(`\nmotor: ${sinal} recebido: encerrando os processos e apagando os temporários\n`);
        this.liberar().finally(() => process.exit(codigo));
      });
    }
  }
}
