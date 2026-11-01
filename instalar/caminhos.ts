// Todos os caminhos que o instalador (P03) toca, num lugar só. O que o comando de render também usa vem do CAMINHOS do
// cli/regras.ts (a mesma verdade); o resto é derivado daqui. Desde o P04, o código do produto mora em captura/,
// composicao/ e nativo/.
import { homedir } from "node:os";
import { join } from "node:path";
import { CAMINHOS } from "../cli/regras.ts";
import { CACHE } from "../conferencia/rosto.ts";

const CONFERENCIA = join(CAMINHOS.raiz, "conferencia");
const NATIVO = join(CAMINHOS.raiz, "nativo");

export const INSTALACAO = {
  raiz: CAMINHOS.raiz,
  /** Pastas com package-lock.json que recebem `npm ci --ignore-scripts`. */
  pacotesNpm: [
    { nome: "Electron da conferência", pasta: CAMINHOS.captura },
    { nome: "conferência (onnxruntime)", pasta: CONFERENCIA },
  ],
  electron: {
    pasta: join(CAMINHOS.captura, "node_modules", "electron"),
    instalador: join(CAMINHOS.captura, "node_modules", "electron", "install.js"),
    original: CAMINHOS.electronCpu,
  },
  /** P02: o CEF 156.0.14 (no cache do motor, fora do repositório) e o host da captura, o navegador do render. */
  cef: {
    fonte: join(CAMINHOS.captura, "cef"),
    preparar: join(CAMINHOS.captura, "cef", "preparar-cef.sh"),
    montar: join(CAMINHOS.captura, "cef", "montar.sh"),
    nucleo: NATIVO,
    raiz: join(CACHE, "cef", "156.0.14"),
    host: CAMINHOS.hostCef,
    sha1: "d091c82a8655113a34616c08cb340bf92310298d",
  },
  nativo: {
    fonte: NATIVO,
    biblioteca: join(NATIVO, "target", "release", "libnativo.so"),
    modulo: CAMINHOS.nativo,
  },
  conferencia: { pasta: CONFERENCIA, preparar: join(CONFERENCIA, "preparar.ts") },
  /** ~/.cache/motor-video (ou MOTOR_CACHE): modelo e retrato da conferência, fontes do Google e o CEF do P02. */
  cache: CACHE,
  render: join(CAMINHOS.raiz, "cli", "render.ts"),
  /** Composição curta de verificação no fim (sintética, R01). */
  verificacao: { entrada: join(CAMINHOS.raiz, "cli", "fixtures", "linha-sintetica"), composicao: "LinhaSintetica", quadros: 60 },
};
