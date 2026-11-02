// Sonda do modo placa (M08): abre o Vulkan e o NVENC do módulo nativo num quadro pequeno e fecha, sem codificar nada.
// Roda num processo à parte (o cli/render.ts chama com tempo-limite), porque um driver ruim pode travar ou derrubar
// o processo. Uso: node cli/sonda-nvenc.ts <nativo.node> [h264 | hevc | hevc-alfa]   → sai com 0, ou com 1 e o erro
// na última linha. Abre o NVENC no codec do render (P01): h264, o padrão; hevc com --hevc; hevc-alfa com a camada de
// alfa, como o render com --alfa.
import { createRequire } from 'node:module';

try {
  const { Motor } = createRequire(import.meta.url)(process.argv[2]);
  const pedido = process.argv[3] ?? 'h264';
  if (!['h264', 'hevc', 'hevc-alfa'].includes(pedido)) throw new Error(`probe codec: h264, hevc or hevc-alfa, not ${pedido}`);
  const motor = new Motor({ largura: 256, altura: 256, marca: 16, saida: '/dev/null', codec: pedido === 'h264' ? 'h264' : 'hevc',
    alfa: pedido === 'hevc-alfa' });
  motor.fechar();
  console.log('ok');
} catch (erro) {
  console.error(String(erro?.message ?? erro).split('\n')[0]);
  process.exit(1);
}
