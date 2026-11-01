// M08: codificador do modo CPU. O quadro BGRA (alfa pré-multiplicado, o do `paint` sem textura) vai cru ao ffmpeg por
// pipe, sem PNG, e sai em H.264 cru (Annex B) com os argumentos do x264 do M06 (BT.709 de faixa limitada). O H.264
// cru entra na mistura do áudio (audio.ts) como o vídeo do modo placa: `-r fps -i` (entradaDoVideo), cópia do vídeo.
// Sem quadros B (`-bf 0`), como o NVENC do modo placa: o H.264 cru com quadros B não leva o tempo de cada quadro, e o
// MP4 copiado dele perdia dois quadros de duração (0,933 s em vez de 1 s para 30 quadros a 30 qps).
// Perfil High explícito (P01): o mesmo H.264 do modo placa, que todo navegador decodifica.
// Contrapressão como o M06: no máximo `fila` quadros na fila do pipe.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { X264 } from './codificadores.ts';

export class CodificadorCpu {
  constructor({ largura, altura, fps, saida, ffmpeg = 'ffmpeg', fila = 3, args = [...X264, '-bf', '0', '-profile:v', 'high', '-f', 'h264', saida] }) {
    this.tamanho = largura * altura * 4;
    this.fila = fila;
    this.saida = saida;
    this.quadros = 0;
    this.bytes = 0;
    this.erro = null;
    this.vivo = true;
    this.estderr = '';
    this.p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra',
      '-s', `${largura}x${altura}`, '-framerate', String(fps), '-i', '-', ...args], { stdio: ['pipe', 'ignore', 'pipe'] });
    this.p.stderr.on('data', (d) => { if (this.estderr.length < 4000) this.estderr += d; });
    this.fim = new Promise((ok) => {
      this.p.on('error', (e) => { this.erro ??= `ffmpeg do modo CPU não abriu (${ffmpeg}): ${e.code ?? e.message}`; this.vivo = false; ok(null); });
      this.p.on('close', (codigo) => { this.vivo = false; ok(codigo); });
    });
    this.p.stdin.on('error', (e) => { this.erro ??= `ffmpeg do modo CPU fechou o pipe: ${e.code ?? e.message}`; });
  }

  #falha() {
    return new Error(this.erro ?? `ffmpeg do modo CPU terminou antes do fim: ${this.estderr.trim().slice(-400)}`);
  }

  /** Envia um quadro; resolve quando a fila do pipe cabe outro. Rejeita se o ffmpeg morreu. */
  async escrever(pixels) {
    if (pixels.length !== this.tamanho) throw new Error(`quadro com ${pixels.length} bytes, esperado ${this.tamanho}`);
    if (this.erro || !this.vivo) throw this.#falha();
    this.p.stdin.write(pixels);
    this.quadros++;
    this.bytes += pixels.length;
    if (this.p.stdin.writableLength > (this.fila - 1) * this.tamanho) {
      await Promise.race([new Promise((ok) => this.p.stdin.once('drain', ok)), this.fim]);
      if (this.erro || !this.vivo) throw this.#falha();
    }
  }

  /** Fecha o pipe e espera o ffmpeg. Rejeita se ele falhou. */
  async fechar() {
    try { this.p.stdin.end(); } catch { /* pipe já com erro */ }
    const codigo = await this.fim;
    if (this.erro) throw this.#falha();
    if (codigo !== 0) throw new Error(`ffmpeg do modo CPU saiu com ${codigo}: ${this.estderr.trim().slice(-400)}`);
    return { quadros: this.quadros, bytes: this.bytes, codigo };
  }

  /** Erro ou SIGTERM: mata o ffmpeg e apaga a saída parcial. */
  async matar() {
    if (this.vivo) { try { this.p.kill('SIGKILL'); } catch {} await this.fim; }
    rmSync(this.saida, { force: true });
  }
}
