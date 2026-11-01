// Contenção de render (vale para qualquer vídeo): a CPU serve os sites, então o render roda com prioridade mínima
// (nice 19, ionice ociosa) e teto de CPU num escopo do systemd do usuário. Sem o systemd do usuário, fica só a
// prioridade. Quem já está contido (o medir-render.mjs marca RENDER_CONTIDO=1) não abre outro escopo: um escopo
// novo sairia do grupo medido e do teto dele.
import { execFileSync, spawnSync } from "node:child_process";

/** Teto em núcleos (padrão 8 dos 16); RENDER_NUCLEOS muda. */
export const NUCLEOS = Number(process.env.RENDER_NUCLEOS ?? 8);

const temSystemdUsuario = () => spawnSync("systemd-run", ["--user", "--scope", "--quiet", "true"]).status === 0;

/** Prefixo de comando que aplica a contenção (escopo com teto, se houver, + prioridade). */
export const prefixoContencao = (nucleos = NUCLEOS) => [
  ...(process.env.RENDER_CONTIDO || !temSystemdUsuario()
    ? []
    : ["systemd-run", "--user", "--scope", "--quiet", "-p", `CPUQuota=${nucleos * 100}%`]),
  "nice", "-n", "19", "ionice", "-c", "3",
];

let prefixo;
/** Roda o comando contido, com a saída no terminal; lança erro se ele falhar. */
export const contido = (cmd, args, opcoes = {}) => {
  prefixo ??= prefixoContencao();
  const tudo = [...prefixo, cmd, ...args];
  execFileSync(tudo[0], tudo.slice(1), { stdio: "inherit", ...opcoes });
};
