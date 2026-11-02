// Os navegadores do motor, como etapas do instalador (P03). A captura do render é só pelo CEF 156.0.14 pronto com o
// host do P02 (etapaCef): o Electron remendado saiu com a entrada do Remotion em 2026-10-31 (docs/adr.md, seção 16).
// O Electron 45.1.0 sem remendo continua só para a conferência (S04) e o teste que toca o MP4 num navegador (P01), que
// precisam do H.264 decodificado na página (o CEF pronto não tem): baixado pelo install.js dele (rodado à parte porque o npm ci vai com
// --ignore-scripts; o npm 11 também bloqueia install scripts).
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Etapa, type Executar, gravarMarca, hashFontes, lerMarca, sha256 } from "./etapas.ts";

type CaminhosElectron = { pasta: string; instalador: string; original: string };

export function etapaElectron(c: CaminhosElectron, x: Executar): Etapa {
  const versaoPedida = () => {
    try { return JSON.parse(readFileSync(join(c.pasta, "package.json"), "utf8")).version as string; } catch { return null; }
  };
  const versaoBaixada = () => { try { return readFileSync(join(c.pasta, "dist", "version"), "utf8").trim(); } catch { return null; } };
  return {
    nome: "Electron for `kodecz check` (unpatched)",
    conferir: () => {
      const pedida = versaoPedida();
      if (!pedida) return "the electron package is missing from node_modules";
      return versaoBaixada() !== pedida || !existsSync(c.original) ? `Electron ${pedida} was not downloaded` : null;
    },
    fazer: () => { x(process.execPath, [c.instalador], { cwd: c.pasta }); },
  };
}

export type CaminhosCef = {
  /** captura/cef: o host (Rust), o preparar-cef.sh e o montar.sh. */
  fonte: string; preparar: string; montar: string;
  /** nativo/: o host inclui o núcleo por caminho, então as fontes dele entram no registro. */
  nucleo: string;
  /** ~/.cache/motor-video/cef/156.0.14 (o pacote baixado e o achatado em rs/, fora do repositório). */
  raiz: string;
  /** O executável montado e o SHA-1 publicado do pacote. */
  host: string; sha1: string;
};

/**
 * P02: o CEF 156.0.14 pronto, baixado de cef-builds.spotifycdn.com com o SHA-1 do índice conferido e achatado
 * (captura/cef/preparar-cef.sh), e o host da captura compilado (captura/cef/montar.sh). É a captura do render, na
 * placa e na CPU. P14: sem as .so do driver (libnvidia-encode e libnvcuvid, `nvenc`), o host é montado sem a feature
 * `placa` (`--no-default-features`: sem o NVENC/NVDEC, que ligam nelas), só com o modo CPU. Com as .so, monta com a
 * placa mesmo que ela não sirva agora (driver recém-atualizado antes do reboot, nvidia-drm descarregado): o estado
 * passageiro não troca um host bom por um sem placa. O registro guarda com qual foi montado; a máquina que ganha (ou
 * perde) o driver remonta.
 */
export function etapaCef(c: CaminhosCef, { cargo, placa: placaAgora, nvenc }: { cargo: string | null; placa: boolean; nvenc: string[] }, x: Executar): Etapa {
  const placa = placaAgora || nvenc.length > 0;
  const marca = join(c.fonte, "target", "motor-video.json");
  const achatado = join(c.raiz, "rs");
  const ligacao = join(c.fonte, "target", "ligacao-nvidia");
  const fontes = () => `${hashFontes(c.fonte)}:${hashFontes(c.nucleo)}`;
  const cefConfere = () => {
    const a = lerMarca(join(achatado, "archive.json"));
    if (!a) return "CEF 156.0.14 is missing (download and flatten)";
    return a.sha1 === c.sha1 ? null : "the flattened CEF does not match the published SHA-1";
  };
  return {
    nome: `capture browser (CEF 156.0.14 and its host${placa ? "" : ", without GPU: CPU mode only"})`,
    conferir: () => {
      const cef = cefConfere();
      if (cef) return cef;
      if (!existsSync(c.host)) return "the CEF host (motor-captura) is missing";
      const m = lerMarca(marca);
      if (!m) return "the host has no build record";
      if (m.fontes !== fontes()) return "the host sources (or the native core) changed";
      // Registro de antes do P14 (sem o campo): era sempre com a placa.
      if ((m.placa ?? "1") !== (placa ? "1" : "0")) {
        return placa ? "the host was built without GPU support and this machine has a GPU" : "the host was built with GPU support and this machine has no driver";
      }
      return m.host === sha256(c.host) ? null : "the host does not match the build";
    },
    fazer: () => {
      if (!cargo) throw new Error("cargo not found");
      const env: NodeJS.ProcessEnv = { ...process.env, CEF_RAIZ: c.raiz, CEF_PATH: achatado, CARGO: cargo,
        PATH: `${dirname(cargo)}:${process.env.PATH ?? ""}` };
      if (cefConfere()) x(c.preparar, [], { cwd: c.fonte, env });
      rmSync(ligacao, { recursive: true, force: true });
      if (placa) {
        mkdirSync(ligacao, { recursive: true });
        for (const so of nvenc) symlinkSync(so, join(ligacao, basename(so).replace(/\.so\.\d+$/, ".so")));
        env.NVIDIA_VIDEO_CODEC_SDK_PATH = ligacao;
      } else delete env.NVIDIA_VIDEO_CODEC_SDK_PATH;
      x(c.montar, placa ? [] : ["--no-default-features"], { cwd: c.fonte, env });
      gravarMarca(marca, { fontes: fontes(), host: sha256(c.host), placa: placa ? "1" : "0" });
    },
  };
}

/** O CEF (a captura do render) e o Electron sem remendo (a conferência). */
export function etapasDoNavegador(c: CaminhosElectron, cef: CaminhosCef, sistema: { cargo: string | null; placa: boolean; nvenc: string[] },
  x: Executar): Etapa[] {
  return [etapaCef(cef, sistema, x), etapaElectron(c, x)];
}

/**
 * O chrome-sandbox do Chromium só funciona com dono root e SUID. Hoje o render usa --no-sandbox (estado-atual.md);
 * o aviso fica para quando sair dele. null se já está certo.
 */
export function avisoSandbox(original: string): string | null {
  const sandbox = join(original, "..", "chrome-sandbox");
  if (!existsSync(sandbox)) return null;
  const s = statSync(sandbox);
  if (s.uid === 0 && (s.mode & 0o4000) !== 0) return null;
  return "Chromium runs without its sandbox (--no-sandbox); it only loads your own local pages, with the network blocked. " +
    `A root-owned SUID chrome-sandbox is the first step to turning it on (README, FAQ): sudo chown root:root ${sandbox} && sudo chmod 4755 ${sandbox}`;
}
