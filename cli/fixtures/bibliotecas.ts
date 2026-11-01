// S01: GSAP e lottie-web só para os testes, fora do repositório. O serviço é «compatível com GSAP»: o cliente traz a
// biblioteca na pasta dele; nós não a distribuímos nem a pomos no git (docs/pesquisa/
// parecer-juridico.md). O lottie-web é MIT, mas segue a mesma regra: quem traz é o cliente.
//
// Nenhum arquivo do GSAP vai no repositório: a licença dele não é compatível com a Apache-2.0 do Kodecz (L01 da
// auditoria de abertura). O teste baixa a biblioteca na hora para o cache local (~/.cache/motor-video/bibliotecas, ou
// $MOTOR_CACHE/bibliotecas, fora do repositório) e a copia para uma cópia temporária da fixture; sem rede, o teste é
// pulado com o motivo. Para baixar antes, à mão:
//   node cli/fixtures/bibliotecas.ts            baixa as que faltam (pacote do npm, versão fixa)
// O pacote do npm é conferido pelo sha512 publicado (dist.integrity) e o arquivo extraído, pelo sha256 daqui; na
// leitura, o sha256 é conferido de novo.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** Licenças conferidas em 2026-10-30: GSAP pela https://gsap.com/standard-license (uso em site ou aplicação é
 * permitido; ferramenta visual de animação sem código que concorra com o Webflow, não); lottie-web pelo LICENSE.md
 * (MIT). */
export const BIBLIOTECAS = {
  gsap: {
    versao: "3.15.0",
    pacote: "https://registry.npmjs.org/gsap/-/gsap-3.15.0.tgz",
    integridade: "sha512-dMW4CWBTUK1AEEDeZc1g4xpPGIrSf9fJF960qbTZmN/QwZIWY5wgliS6JWl9/25fpTGJrMRtSjGtOmPnfjZB+A==",
    dentro: "package/dist/gsap.min.js",
    arquivo: "gsap.min.js",
    sha256: "92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb",
  },
  lottie: {
    versao: "5.13.0",
    pacote: "https://registry.npmjs.org/lottie-web/-/lottie-web-5.13.0.tgz",
    integridade: "sha512-+gfBXl6sxXMPe8tKQm7qzLnUy5DUPJPKIyRHwtpCpyUEYjHYRJC/5gjUvdkuO2c3JllrPtHXH5UJJK8LRYl5yQ==",
    dentro: "package/build/player/lottie.min.js",
    arquivo: "lottie.min.js",
    sha256: "2eb762973aec914d981f426123040bfac9d26217239605e225ddc7cee17618ac",
  },
} as const;
export type Biblioteca = keyof typeof BIBLIOTECAS;

/** A mesma pasta do cache do motor (conferencia/rosto.ts, CACHE). */
const PASTA = join(process.env.MOTOR_CACHE ?? join(homedir(), ".cache", "motor-video"), "bibliotecas");
const destino = (nome: Biblioteca) => join(PASTA, `${nome}-${BIBLIOTECAS[nome].versao}`, BIBLIOTECAS[nome].arquivo);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** O arquivo da biblioteca no cache, conferido, ou o motivo de não estar lá (para o skip do teste). */
export function bibliotecaDeTeste(nome: Biblioteca): { arquivo: string; nome: string } | { falta: string } {
  const b = BIBLIOTECAS[nome], caminho = destino(nome);
  const comando = "node cli/fixtures/bibliotecas.ts";
  if (!existsSync(caminho)) return { falta: `${nome} ${b.versao} não está no cache (${caminho}); baixar com ${comando} (fora do git, parecer J5)` };
  if (sha256(readFileSync(caminho)) !== b.sha256) return { falta: `${caminho} não confere com o sha256 esperado; apagar e baixar de novo com ${comando}` };
  return { arquivo: caminho, nome: b.arquivo };
}

/** Copia a fixture (só arquivos, um nível) e a biblioteca do cache para `pasta`. */
export function fixtureComBiblioteca(fixture: string, pasta: string, nome: Biblioteca, arquivos: string[]) {
  const b = bibliotecaDeTeste(nome);
  if ("falta" in b) throw new Error(b.falta);
  mkdirSync(pasta, { recursive: true });
  for (const a of arquivos) copyFileSync(join(fixture, a), join(pasta, a));
  copyFileSync(b.arquivo, join(pasta, b.nome));
  return pasta;
}

/** Baixa a biblioteca para o cache, se ainda não estiver lá, conferindo o sha512 do pacote e o sha256 do arquivo. */
export async function baixar(nome: Biblioteca, log: (m: string) => void = console.log) {
  const b = BIBLIOTECAS[nome];
  if (!("falta" in bibliotecaDeTeste(nome))) { log(`${nome} ${b.versao}: já no cache (${destino(nome)})`); return; }
  const r = await fetch(b.pacote, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${b.pacote}: HTTP ${r.status}`);
  const tgz = Buffer.from(await r.arrayBuffer());
  const [algoritmo, esperado] = b.integridade.split(/-(.*)/s);
  const obtido = createHash(algoritmo).update(tgz).digest("base64");
  if (obtido !== esperado) throw new Error(`${nome}: o pacote não confere com o ${algoritmo} publicado (${obtido})`);
  const tmp = mkdtempSync(join(tmpdir(), "motor-bibliotecas-"));
  try {
    writeFileSync(join(tmp, "pacote.tgz"), tgz);
    const t = spawnSync("tar", ["-xzf", join(tmp, "pacote.tgz"), "-C", tmp, b.dentro], { encoding: "utf8" });
    if (t.status !== 0) throw new Error(`${nome}: tar falhou: ${t.stderr}`);
    const arquivo = readFileSync(join(tmp, b.dentro));
    if (sha256(arquivo) !== b.sha256) throw new Error(`${nome}: ${b.dentro} não confere com o sha256 esperado`);
    mkdirSync(join(PASTA, `${nome}-${b.versao}`), { recursive: true });
    writeFileSync(destino(nome), arquivo);
    log(`${nome} ${b.versao}: ${destino(nome)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const nome of Object.keys(BIBLIOTECAS) as Biblioteca[]) await baixar(nome);
}
