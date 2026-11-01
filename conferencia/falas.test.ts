// Testes da leitura das falas (window.motor_falas ou --falas), S04.
// Rodar: node --test "conferencia/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerFalas } from "./falas.ts";

test("falas válidas: pontuação preservada, ordem do tempo", () => {
  const f = lerFalas([{ t: "Olá,", ini: 0, fim: 0.4, bloco: 1 }, { t: "mundo!", ini: 0.4, fim: 0.9, bloco: 1 }, { t: "Já.", ini: 1.2, fim: 1.5, bloco: "2" }]);
  assert.deepEqual(f.map((x) => x.t), ["Olá,", "mundo!", "Já."]);
  assert.deepEqual(lerFalas(undefined), []);
  assert.deepEqual(lerFalas(null), []);
});

test("falas inválidas são recusadas com mensagem", () => {
  const recusa = (valor: unknown, re: RegExp) => assert.throws(() => lerFalas(valor), (e: Error) => re.test(e.message));
  recusa({}, /lista/);
  recusa([{ t: "", ini: 0, fim: 1, bloco: 1 }], /palavra 0.*«t» vazio/);
  recusa([{ t: "a", ini: "0", fim: 1, bloco: 1 }], /palavra 0.*«ini»/);
  recusa([{ t: "a", ini: 0, fim: 1 }], /palavra 0.*«bloco»/);
  recusa([{ t: "a", ini: 1, fim: 0.5, bloco: 1 }], /palavra 0.*fim antes do início/);
  recusa([{ t: "a", ini: 1, fim: 2, bloco: 1 }, { t: "b", ini: 0.5, fim: 3, bloco: 1 }], /palavra 1.*fora de ordem/);
  recusa([{ t: "a", ini: -1, fim: 2, bloco: 1 }], /palavra 0.*«ini»/);
});
