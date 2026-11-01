// Testes do controlador do host do CEF (captura/cef/host.ts) com um host falso (shell), sem CEF nem placa.
// Rodar: node --test captura/cef/host.test.ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "host-falso-"));
after(() => rmSync(pasta, { recursive: true, force: true }));
/** Um host que abre a FIFO de respostas como o de verdade, avisa «pronto» e morre sem responder. */
const falso = join(pasta, "motor-captura");
writeFileSync(falso, `#!/bin/sh
exec 3<>"$MOTOR_CAPTURA_RESPOSTAS"
echo '{"evento":"pronto"}'
sleep 0.5
exit 1
`);
chmodSync(falso, 0o755);
process.env.MOTOR_CAPTURA_EXE = falso;
const { Host, ErroDoHost } = await import("./host.ts");

// Revisão do P02: com o Node segurando uma ponta de escrita da FIFO de respostas, a leitura síncrona nunca via o fim
// quando o host morria no meio de uma operação, e o render ficava parado até o tempo-limite.
test("host que morre no meio de uma operação síncrona: o pedir lança em vez de ficar parado", async () => {
  const h = new Host({ pasta });
  await new Promise((ok) => h.once("pronto", ok));
  const t0 = performance.now();
  assert.throws(() => h.pedir({ op: "repetir" }), (e: unknown) => e instanceof ErroDoHost && /fechou/.test((e as Error).message));
  assert.ok(performance.now() - t0 < 5000, "lançou só depois de muito tempo");
  await h.fechar(1000);
});
