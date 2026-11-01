// Etapas do instalador (P03) que não pedem sudo. Cada uma confere antes (null = já está certo, pelo hash gravado na
// última vez que fez) e só faz o que falta; por isso rodar de novo não refaz nada. O executor é injetável (testes).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

export type Executar = (comando: string, args: string[], opcoes: { cwd: string; env?: NodeJS.ProcessEnv }) => void;
/** pular: o motivo de não se aplicar nesta máquina (ex.: o nativo sem placa). */
export type Etapa = { nome: string; pular?: string; conferir: () => string | null; fazer: () => void | Promise<void> };

export const sha256 = (arquivo: string) => createHash("sha256").update(readFileSync(arquivo)).digest("hex");
export function lerMarca(arquivo: string): Record<string, string> | null {
  try { return JSON.parse(readFileSync(arquivo, "utf8")); } catch { return null; }
}
export function gravarMarca(arquivo: string, dados: Record<string, string>) {
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, `${JSON.stringify(dados, null, 2)}\n`);
}

/**
 * Roda as etapas em ordem. --verificar só confere. Instalando, para na primeira que falhar (as seguintes dependem
 * dela) e devolve o que faltou, com o erro.
 */
export async function rodarEtapas(etapas: Etapa[], { verificar, avisar }: { verificar: boolean; avisar: (linha: string) => void }) {
  const faltas: string[] = [];
  for (const e of etapas) {
    if (e.pular) { avisar(`– ${e.nome}: pulado (${e.pular})`); continue; }
    const antes = e.conferir();
    if (!antes) { avisar(`✓ ${e.nome}`); continue; }
    if (verificar) { avisar(`✗ ${e.nome}: ${antes}`); faltas.push(`${e.nome}: ${antes}`); continue; }
    avisar(`… ${e.nome}: ${antes}; instalando`);
    let depois: string | null;
    try { await e.fazer(); depois = e.conferir(); } catch (erro) { depois = (erro as Error).message; }
    if (depois) { avisar(`✗ ${e.nome}: ${depois}`); faltas.push(`${e.nome}: ${depois}`); break; }
    avisar(`✓ ${e.nome}`);
  }
  return { faltas };
}

/** `npm ci --ignore-scripts`: os install scripts que importam rodam como etapa à parte (o do Electron). */
export function etapaNpm(nome: string, pasta: string, x: Executar): Etapa {
  const lock = join(pasta, "package-lock.json");
  const marca = join(pasta, "node_modules", ".motor-video.json");
  return {
    nome: `dependências: ${nome}`,
    conferir: () => {
      if (!existsSync(lock)) return `sem package-lock.json em ${pasta}`;
      const m = lerMarca(marca);
      if (!m) return existsSync(join(pasta, "node_modules")) ? "node_modules sem registro do instalador" : "falta o node_modules";
      return m.lock === sha256(lock) ? null : "o package-lock.json mudou desde o último npm ci";
    },
    fazer: () => {
      x("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: pasta });
      gravarMarca(marca, { lock: sha256(lock) });
    },
  };
}

/** Hash das fontes do nativo (Cargo.toml, Cargo.lock, build.rs e src/), com o caminho de cada arquivo. */
export function hashFontes(fonte: string) {
  const arquivos = ["Cargo.toml", "Cargo.lock", "build.rs"].map((a) => join(fonte, a)).filter(existsSync);
  const andar = (d: string): string[] => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? andar(join(d, e.name)) : [join(d, e.name)]));
  if (existsSync(join(fonte, "src"))) arquivos.push(...andar(join(fonte, "src")));
  const h = createHash("sha256");
  for (const a of arquivos.sort()) h.update(`${relative(fonte, a)}\0`).update(readFileSync(a)).update("\0");
  return h.digest("hex");
}

/**
 * O módulo nativo é compilado aqui (decisão do P03: sem binário pré-compilado enquanto o produto é o serviço no nosso
 * servidor; a distribuição de binários ainda não está decidida). Recompila se as fontes ou o nativo.node mudaram.
 */
export function etapaNativo(c: { fonte: string; biblioteca: string; modulo: string },
  { cargo, placa, nvenc }: { cargo: string | null; placa: boolean; nvenc: string[] }, x: Executar): Etapa {
  const marca = join(c.fonte, "target", "motor-video.json");
  // O build do nvidia-video-codec-sdk liga em libnvidia-encode.so e libnvcuvid.so sem versão, que só o pacote de
  // desenvolvimento traz; links próprios para as .so.1 do driver dispensam o sudo (o binário pede a .so.1 do mesmo jeito).
  const ligacao = join(c.fonte, "target", "ligacao-nvidia");
  return {
    nome: "módulo nativo (Rust: Vulkan e NVENC)",
    pular: placa ? undefined : "sem placa NVIDIA: o modo CPU não usa o nativo",
    conferir: () => {
      if (!existsSync(c.modulo)) return "falta o nativo.node";
      const m = lerMarca(marca);
      if (!m) return "nativo.node sem registro de compilação";
      if (m.fontes !== hashFontes(c.fonte)) return "as fontes do nativo mudaram";
      return m.modulo === sha256(c.modulo) ? null : "o nativo.node não confere com o compilado";
    },
    fazer: () => {
      if (!cargo) throw new Error("sem cargo");
      rmSync(ligacao, { recursive: true, force: true });
      mkdirSync(ligacao, { recursive: true });
      for (const so of nvenc) symlinkSync(so, join(ligacao, basename(so).replace(/\.so\.\d+$/, ".so")));
      x(cargo, ["build", "--release", "--locked"], { cwd: c.fonte,
        env: { ...process.env, PATH: `${dirname(cargo)}:${process.env.PATH ?? ""}`, NVIDIA_VIDEO_CODEC_SDK_PATH: ligacao } });
      copyFileSync(c.biblioteca, c.modulo);
      gravarMarca(marca, { fontes: hashFontes(c.fonte), modulo: sha256(c.modulo) });
    },
  };
}

/** Modelo de rosto e retrato de teste da conferência (S04), pelo preparar.ts dela, que confere o SHA-256 de cada um. */
export function etapaConferencia(c: { pasta: string; preparar: string }, conferir: () => string | null, x: Executar): Etapa {
  return {
    nome: "conferência (modelo de rosto e retrato de teste)",
    conferir,
    fazer: () => x(process.execPath, [c.preparar], { cwd: c.pasta }),
  };
}
