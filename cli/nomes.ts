// The public names of the interface, in English, and the original Portuguese names they replace. The original names
// are still accepted (deprecated): compositions and scripts written with them keep working. Internally the code keeps
// the original names; the English ones are translated at the edge (command options, the declaration block, the
// frame hook).

/** The `id` of the declaration block: `<script type="application/json" id="kodecz">`. */
export const ID_BLOCO = "kodecz";
/** The original id of the block, still accepted. */
export const ID_BLOCO_ANTIGO = "motor-video";

/** Fields of the declaration block: English name → original name (the one the code uses). */
export const CAMPOS: Record<string, string> = { width: "largura", height: "altura", fps: "qps", frames: "quadros" };

/** The frame hook of the page (canvas, WebGL): `window.kodecz_frame(n, ms)`; `window.motor_quadro` still works. */
export const GANCHO = "kodecz_frame";
export const GANCHO_ANTIGO = "motor_quadro";

/** Options of `kodecz render` (cli/render.ts): English → original. */
export const OPCOES_RENDER: Record<string, string> = {
  "--from": "--de", "--frames": "--quadros", "--alpha": "--alfa", "--gpu": "--placa", "--no-audio": "--sem-audio",
  "--keep": "--manter", "--no-containment": "--sem-contencao", "--save-frames": "--gravar", "--save-frames-dir": "--gravar-pasta",
  "--help": "--ajuda",
};

/** Options of `kodecz preview` (cli/previa.ts). */
export const OPCOES_PREVIA: Record<string, string> = {
  "--frame": "--quadro", "--out": "--saida", "--watch": "--observar", "--serve": "--servir", "--port": "--porta",
  "--gpu": "--placa", "--no-containment": "--sem-contencao", "--help": "--ajuda",
};

/** Options of `kodecz check` (cli/conferir.ts). */
export const OPCOES_CONFERIR: Record<string, string> = {
  "--speech": "--falas", "--out": "--saida", "--sample": "--amostra", "--keep": "--manter", "--data": "--dados",
  "--no-containment": "--sem-contencao", "--help": "--ajuda",
};

/**
 * The arguments with the English options turned into the original ones (also in the `--name=value` form). Values,
 * positionals, options already in Portuguese and everything after `--` pass unchanged.
 */
export function traduzirOpcoes(argv: string[], mapa: Record<string, string>): string[] {
  const fim = argv.indexOf("--");
  return argv.map((a, i) => {
    if ((fim >= 0 && i >= fim) || !a.startsWith("--")) return a;
    const igual = a.indexOf("=");
    const nome = igual < 0 ? a : a.slice(0, igual);
    const original = Object.hasOwn(mapa, nome) ? mapa[nome] : null;
    return original === null ? a : original + (igual < 0 ? "" : a.slice(igual));
  });
}
