// Pré-requisitos do sistema (P03): o que precisa de sudo ou de fora do repositório. Só confere e diz o comando exato;
// quem instala pacotes é o instalar.ts com --sistema. O ambiente é injetável: os testes simulam cada falta.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { ICD_VULKAN_NVIDIA } from "../cli/regras.ts";

/**
 * Driver mínimo: o R570 é o primeiro com a RTX 50 (Blackwell) e com a API do Video Codec SDK 13 que o NVENC do nativo
 * usa; o nativo também carrega o CUDA 12.8 (cudarc, `cuda-12080`), que pede o R570.
 */
export const DRIVER_MINIMO = 570;
/** Edição 2024 do Rust (nativo/Cargo.toml). */
const RUST_MINIMO = [1, 85] as const;
const NODE_MINIMO = 24;
/** CEF achatado e o host (~1 GB), Electron da conferência (~0,3 GB), target do Rust (~0,4 GB), com folga. */
const DISCO_MINIMO = 4e9;

export type AmbienteSistema = {
  node: string;
  uid: number;
  casa: string;
  /** Caminho do comando no PATH, ou null. */
  comando: (nome: string) => string | null;
  /** Caminho da biblioteca no cache do ldconfig, ou null. */
  biblioteca: (soname: string) => string | null;
  ler: (caminho: string) => string | null;
  existe: (caminho: string) => boolean;
  /** [render node, vendor] de cada /sys/class/drm/renderD*. */
  vendors: () => [string, string][];
  /** Saída do comando se saiu com 0; null senão. */
  saida: (comando: string, args: string[]) => string | null;
  livreBytes: (pasta: string) => number;
  /** O apt conhece o pacote (para escolher entre o nome t64 e o antigo). */
  pacoteExiste: (nome: string) => boolean;
};

/** bloqueia: sem isso a instalação não segue. Sem placa não bloqueia: instala para o modo CPU e diz no fim. */
export type Falta = { oQue: string; comando?: string; bloqueia: boolean };
/** nvenc: as bibliotecas do driver que o nativo e o host do CEF ligam (libnvidia-encode.so.1, libnvcuvid.so.1), com o
 * caminho; vazio se falta alguma (o host monta sem a placa, P14). */
export type ConferenciaSistema = { faltas: Falta[]; pacotes: string[]; placa: boolean; cargo: string | null; nvenc: string[] };

/** Comandos que o render, a captura e o preparar-cef.sh (strip) usam → pacote do apt (Debian/Ubuntu). O readelf, o
 * objdump e o python3 eram do remendo do Electron, que saiu com a entrada do Remotion (docs/adr.md, seção 16). */
const COMANDOS: [string, string][] = [
  ["ffmpeg", "ffmpeg"], ["weston", "weston"], ["bwrap", "bubblewrap"], ["strip", "binutils"], ["fc-list", "fontconfig"],
];
/** Bibliotecas que o Electron carrega → pacotes candidatos (o nome t64 do Ubuntu 24.04+ e Debian 13 primeiro). */
const BIBLIOTECAS_ELECTRON: [string, string[]][] = [
  ["libnss3.so", ["libnss3"]], ["libnspr4.so", ["libnspr4"]], ["libatk-1.0.so.0", ["libatk1.0-0t64", "libatk1.0-0"]],
  ["libatk-bridge-2.0.so.0", ["libatk-bridge2.0-0t64", "libatk-bridge2.0-0"]], ["libcups.so.2", ["libcups2t64", "libcups2"]],
  ["libgtk-3.so.0", ["libgtk-3-0t64", "libgtk-3-0"]], ["libgbm.so.1", ["libgbm1"]], ["libasound.so.2", ["libasound2t64", "libasound2"]],
  ["libxkbcommon.so.0", ["libxkbcommon0"]], ["libXcomposite.so.1", ["libxcomposite1"]], ["libXdamage.so.1", ["libxdamage1"]],
  ["libXrandr.so.2", ["libxrandr2"]], ["libdrm.so.2", ["libdrm2"]], ["libpango-1.0.so.0", ["libpango-1.0-0"]],
  ["libcairo.so.2", ["libcairo2"]], ["libdbus-1.so.3", ["libdbus-1-3"]],
];

const RUSTUP = "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal";

export function conferirSistema(a: AmbienteSistema): ConferenciaSistema {
  const faltas: Falta[] = [];
  const pacotes: string[] = [];
  const pacote = (oQue: string, candidatos: string[]) => {
    const p = candidatos.find(a.pacoteExiste) ?? candidatos[0];
    if (!pacotes.includes(p)) pacotes.push(p);
    faltas.push({ oQue, comando: `apt: ${p}`, bloqueia: true });
  };

  const node = Number(/^v(\d+)/.exec(a.node)?.[1] ?? 0);
  if (node < NODE_MINIMO) faltas.push({ oQue: `Node ${node} (precisa do ${NODE_MINIMO})`, comando: "nvm install 24 (ou https://nodejs.org)", bloqueia: true });
  if (!a.comando("npm")) faltas.push({ oQue: "npm fora do PATH", comando: "vem com o Node 24", bloqueia: true });

  // Placa: driver, render node e /dev/nvidiactl. Sem eles não bloqueia: o modo CPU instala e o fim diz o que falta.
  const versao = a.ler("/sys/module/nvidia/version")?.trim() ?? null;
  const maior = versao ? Number(versao.split(".")[0]) : 0;
  let placa = true;
  if (!versao) {
    placa = false;
    faltas.push({ oQue: "driver da NVIDIA ausente (sem placa, só o modo CPU)", comando: `sudo ubuntu-drivers install (driver ≥ ${DRIVER_MINIMO}) e reiniciar`, bloqueia: false });
  } else if (maior < DRIVER_MINIMO) {
    placa = false;
    faltas.push({ oQue: `driver da NVIDIA ${versao} (precisa de ≥ ${DRIVER_MINIMO}; só o modo CPU até lá)`, comando: `sudo apt-get install -y nvidia-driver-${DRIVER_MINIMO}-open (ou mais novo) e reiniciar`, bloqueia: false });
  } else {
    if (!a.vendors().some(([, v]) => v.trim() === "0x10de")) {
      placa = false;
      faltas.push({ oQue: "nenhum render node da NVIDIA em /sys/class/drm (placa escondida ou nvidia-drm sem carregar)", comando: "sudo modprobe nvidia-drm modeset=1", bloqueia: false });
    }
    if (!a.existe("/dev/nvidiactl")) {
      placa = false;
      faltas.push({ oQue: "sem /dev/nvidiactl (módulo nvidia sem carregar)", comando: "sudo modprobe nvidia", bloqueia: false });
    }
    if (!ICD_VULKAN_NVIDIA.some(a.existe)) {
      placa = false;
      faltas.push({ oQue: `sem o ICD do Vulkan da NVIDIA (${ICD_VULKAN_NVIDIA.join(" nem ")})`, comando: `reinstalar o driver: sudo apt-get install --reinstall libnvidia-gl-${maior}`, bloqueia: false });
    }
  }

  for (const [c, p] of COMANDOS) if (!a.comando(c)) pacote(`${c} fora do PATH`, [p]);
  // O modo CPU esconde a placa com o bwrap (render.ts); com o namespace de usuário barrado, o render na CPU falha.
  if (a.comando("bwrap") && a.saida("bwrap", ["--dev-bind", "/", "/", "true"]) === null) {
    faltas.push({ oQue: "o bwrap não cria namespace de usuário (o render na CPU falha)", bloqueia: false,
      comando: "Ubuntu 24.04+: sudo apt-get install -y apparmor-profiles (perfil bwrap-userns-restrict) ou sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0; em contêiner: docker run --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined" });
  }
  if (a.comando("fc-list")) {
    const fontes = a.saida("fc-list", []);
    if (!fontes || !fontes.trim()) pacote("nenhuma fonte no sistema (o Chromium não desenha texto)", ["fonts-dejavu-core"]);
  }
  for (const [so, cands] of BIBLIOTECAS_ELECTRON) if (!a.biblioteca(so)) pacote(`${so} (o Electron carrega)`, cands);

  // O host do CEF (Rust, compilado aqui, com e sem placa: P14) e, só com placa, o nativo e o que ele liga.
  const nvenc: string[] = [];
  if (!a.comando("cc")) pacote("cc fora do PATH (o Rust liga com ele)", ["build-essential"]);
  // O cef-dll-sys monta o libcef_dll_wrapper (C++) com o cmake e o gerador Ninja.
  if (!a.comando("cmake")) pacote("cmake fora do PATH (o host do CEF compila o libcef_dll_wrapper com ele)", ["cmake"]);
  if (!a.comando("ninja")) pacote("ninja fora do PATH (o gerador do cmake no host do CEF)", ["ninja-build"]);
  if (!a.existe("/etc/ssl/certs/ca-certificates.crt")) pacote("sem os certificados do sistema (o cargo e o curl baixam por HTTPS)", ["ca-certificates"]);
  if (placa && !a.biblioteca("libvulkan.so.1")) pacote("libvulkan.so.1 (o nativo abre o Vulkan)", ["libvulkan1"]);
  // Só as do driver (.so.1): o nativo e o host do CEF ligam nelas por links próprios (etapas.ts), sem o pacote de
  // desenvolvimento. Achadas também com a placa fora agora (P14: o host continua montado com a placa); pedidas só com ela.
  const doDriver = [["libnvidia-encode.so.1", `libnvidia-encode-${maior}`], ["libnvcuvid.so.1", `libnvidia-decode-${maior}`]];
  const achadas = doDriver.map(([so]) => a.biblioteca(so));
  if (achadas.every(Boolean)) nvenc.push(...(achadas as string[]));
  else if (placa) doDriver.forEach(([so, p], i) => { if (achadas[i]) nvenc.push(achadas[i]!); else pacote(`${so} (do driver; o nativo liga nela)`, [p]); });
  const noCasa = join(a.casa, ".cargo", "bin", "cargo");
  const cargo = a.comando("cargo") ?? (a.existe(noCasa) ? noCasa : null);
  if (!cargo) {
    if (!a.comando("curl")) pacote("curl fora do PATH (para o rustup)", ["curl"]);
    faltas.push({ oQue: "Rust (cargo) ausente: o host do CEF (e, com placa, o módulo nativo) é compilado nesta máquina", comando: RUSTUP, bloqueia: true });
  } else {
    const v = /cargo (\d+)\.(\d+)/.exec(a.saida(cargo, ["--version"]) ?? "");
    const [ma, mi] = v ? [Number(v[1]), Number(v[2])] : [0, 0];
    if (ma < RUST_MINIMO[0] || (ma === RUST_MINIMO[0] && mi < RUST_MINIMO[1])) {
      faltas.push({ oQue: `Rust ${v ? `${ma}.${mi}` : "?"} (precisa de ≥ ${RUST_MINIMO.join(".")}, edição 2024)`, comando: "rustup update stable", bloqueia: true });
    }
  }

  const livre = a.livreBytes(a.casa);
  if (livre < DISCO_MINIMO) faltas.push({ oQue: `pouco espaço em disco: ${(livre / 1e9).toFixed(1)} GB livres (precisa de ~${DISCO_MINIMO / 1e9} GB)`, bloqueia: true });
  return { faltas, pacotes, placa, cargo, nvenc };
}

/** O comando do apt para os pacotes (root, como num contêiner, dispensa o sudo). */
export function comandoApt(pacotes: string[], uid: number): string[] {
  return [...(uid === 0 ? [] : ["sudo"]), "apt-get", "install", "-y", ...pacotes];
}

/** O ambiente de verdade. */
export function ambienteSistema(raiz: string): AmbienteSistema {
  const comando = (n: string) => {
    const r = spawnSync("sh", ["-c", 'command -v "$1"', "sh", n], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  let ldconfig: string | null = null;
  return {
    node: process.version,
    uid: process.getuid?.() ?? 1000,
    casa: process.env.HOME ?? "/",
    comando,
    biblioteca: (so) => {
      ldconfig ??= spawnSync("/sbin/ldconfig", ["-p"], { encoding: "utf8" }).stdout ?? "";
      const linha = ldconfig.split("\n").find((l) => l.trim().startsWith(`${so} `) && l.includes("x86-64"));
      return linha ? linha.split(" => ").pop()!.trim() : null;
    },
    ler: (c) => { try { return readFileSync(c, "utf8"); } catch { return null; } },
    existe: existsSync,
    vendors: () => {
      try {
        return readdirSync("/sys/class/drm").filter((d) => /^renderD\d+$/.test(d))
          .map((d): [string, string] => { try { return [d, readFileSync(`/sys/class/drm/${d}/device/vendor`, "utf8")]; } catch { return [d, ""]; } });
      } catch { return []; }
    },
    saida: (c, args) => {
      const r = spawnSync(c, args, { encoding: "utf8", timeout: 20000 });
      return r.status === 0 ? r.stdout : null;
    },
    livreBytes: () => { const s = statfsSync(raiz); return s.bavail * s.bsize; },
    pacoteExiste: (p) => comando("apt-cache") !== null && spawnSync("apt-cache", ["show", "--no-all-versions", p], { stdio: "ignore" }).status === 0,
  };
}
