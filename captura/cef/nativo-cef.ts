// O `nativo.node` do M02 visto pelo main.ts, com o núcleo dentro do host do CEF (P02). O quadro não vem ao Node:
// o `quadroMarcado` chamado dentro do evento `paint` pede ao host que entregue ao núcleo (cópia na placa, marca,
// fila do NVENC) o paint que a thread de UI do CEF está segurando; o plano e o modifier que o main.ts passa são os
// do próprio host e não são usados aqui. Só os pixels conferidos (com conferência, R04) voltam, pelo arquivo do quadro.
// Mesmos nomes e mesmas respostas do napi do M02 (Motor, quadroMarcado, repetir, fechar).
import { hostAberto, idDoPaintAtual, paintLiberadoPeloMarcado } from "./electron-cef.ts";

type Opcoes = { largura: number; altura: number; saida: string; alfa: boolean; codec?: string; qps?: number; marca?: number; fila?: number;
  preset?: number; gop?: number; qualidade?: number; razaoAlfa?: number };

export class Motor {
  constructor(opcoes: Opcoes) {
    hostAberto().pedir({ op: "motor", opcoes });
  }

  quadroMarcado(_plano: unknown, _modifier: string, alvo: number, conferir: boolean) {
    const id = idDoPaintAtual();
    if (id === null) throw new Error("quadroMarcado fora de um paint (o host só segura o paint durante o evento)");
    const h = hostAberto();
    // O host solta o paint ao responder o `marcado`, com erro ou não.
    paintLiberadoPeloMarcado();
    const r = h.pedir({ op: "marcado", id, alvo, conferir });
    return { marca: r.marca ?? null, codificado: r.codificado === true, pixels: r.pixels ? h.lerQuadro(r.pixels) : null };
  }

  quadro(): never {
    throw new Error("Motor.quadro (sem marca) não existe na captura pelo CEF: use quadroMarcado");
  }

  repetir() {
    hostAberto().pedir({ op: "repetir" });
  }

  /** S08: abre um vídeo no NVDEC do núcleo (no host); devolve o número dele para o `montar`. */
  abrirVideo(video: { arquivo: string; codec: string; largura: number; altura: number; matriz?: string; cheia: boolean; ffmpeg?: string }) {
    return hostAberto().pedir({ op: "abrirVideo", video }).video as number;
  }

  /** S08: a montagem dos próximos quadros (fundo e vídeo por baixo da página); null = sem montagem. */
  montar(montagem: unknown) {
    hostAberto().pedir({ op: "montar", montagem: montagem ?? null });
  }

  fechar() {
    return hostAberto().pedir({ op: "fechar" }).resumo;
  }
}
