// Ganchos do Node para rodar o captura/main.ts sobre o host do CEF (P02), sem mudar o main.ts:
//   node --import ./captura/cef/ganchos.ts captura/main.ts [opções do Chromium]
// O `electron` vira captura/cef/electron-cef.ts e o `nativo.node` do M02 vira captura/cef/nativo-cef.ts (o núcleo fica no
// host). Nada mais muda de lugar.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { daqui } from "./host.ts";

const ELECTRON = pathToFileURL(daqui("electron-cef.ts")).href;
const NATIVO = pathToFileURL(daqui("nativo-cef.ts")).href;

registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "electron") return { url: ELECTRON, shortCircuit: true };
    // Único ponto do lado TS com o nativo: qualquer `…/nativo.node` (hoje no M02; depois do P04, em nativo/).
    if (especificador.endsWith("/nativo.node")) return { url: NATIVO, shortCircuit: true };
    return proximo(especificador, contexto);
  },
});
