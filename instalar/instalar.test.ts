// Testes do instalador (P03) sem tocar no sistema: o ambiente da conferência dos pré-requisitos e o executor das etapas
// são injetados. A instalação de verdade numa pasta limpa está no LEIAME.md desta pasta (integração, à mão).
// Rodar: node --test "instalar/*.test.ts"
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AmbienteSistema, comandoApt, conferirSistema, DRIVER_MINIMO } from "./sistema.ts";
import { etapaNativo, etapaNpm, type Executar, rodarEtapas } from "./etapas.ts";
import { etapaCef, etapaElectron, etapasDoNavegador } from "./navegador.ts";
import { INSTALACAO } from "./caminhos.ts";

const tmp = mkdtempSync(join(tmpdir(), "motor-instalar-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** Máquina completa (tudo instalado, placa boa); cada teste tira uma peça. */
function maquina(mudar: Partial<AmbienteSistema> = {}): AmbienteSistema {
  return {
    node: "v24.22.0",
    uid: 1000,
    casa: "/home/u",
    comando: (n) => `/usr/bin/${n}`,
    biblioteca: (so) => `/usr/lib/x86_64-linux-gnu/${so}`,
    ler: (c) => (c === "/sys/module/nvidia/version" ? "595.99.02\n" : null),
    existe: () => true,
    vendors: () => [["renderD128", "0x10de\n"]],
    saida: (c) => (c.endsWith("cargo") ? "cargo 1.91.0 (2025-10-10)" : c === "fc-list" ? "/usr/share/fonts/x.ttf: X\n" : ""),
    livreBytes: () => 100e9,
    pacoteExiste: (p) => p.endsWith("t64") || !/^(libgtk-3-0|libasound2|libatk1\.0-0|libcups2|libatk-bridge2\.0-0)$/.test(p),
    ...mudar,
  };
}

test("máquina completa: nada falta, placa presente e o cargo achado", () => {
  const c = conferirSistema(maquina());
  assert.deepEqual(c.faltas, []);
  assert.equal(c.placa, true);
  assert.equal(c.cargo, "/usr/bin/cargo");
  assert.deepEqual(c.nvenc, ["/usr/lib/x86_64-linux-gnu/libnvidia-encode.so.1", "/usr/lib/x86_64-linux-gnu/libnvcuvid.so.1"]);
});

test("comandos do sistema faltando: um pacote do apt por comando, numa linha só, sem repetir", () => {
  const sem = new Set(["weston", "bwrap", "strip"]);
  const c = conferirSistema(maquina({ comando: (n) => (sem.has(n) ? null : `/usr/bin/${n}`) }));
  assert.deepEqual(c.pacotes, ["weston", "bubblewrap", "binutils"]);
  assert.ok(c.faltas.every((f) => f.bloqueia));
  assert.deepEqual(comandoApt(c.pacotes, 1000), ["sudo", "apt-get", "install", "-y", "weston", "bubblewrap", "binutils"]);
  assert.deepEqual(comandoApt(c.pacotes, 0), ["apt-get", "install", "-y", "weston", "bubblewrap", "binutils"]);
});

test("bibliotecas do Electron: o nome t64 quando o apt conhece, senão o antigo", () => {
  const c = conferirSistema(maquina({ biblioteca: (s) => (["libgtk-3.so.0", "libnss3.so"].includes(s) ? null : s) }));
  assert.deepEqual(c.pacotes, ["libnss3", "libgtk-3-0t64"]);
  const antigo = conferirSistema(maquina({ biblioteca: (s) => (s === "libgtk-3.so.0" ? null : s), pacoteExiste: (p) => !p.endsWith("t64") }));
  assert.deepEqual(antigo.pacotes, ["libgtk-3-0"]);
});

// P14: sem driver, o host do CEF é compilado sem a placa (o modo CPU passa por ele): o Rust e o compilador continuam
// pedidos; o Vulkan e as .so do NVENC, não.
test("sem driver da NVIDIA: não bloqueia por ele (o modo CPU instala), diz o comando, pede o Rust e dispensa Vulkan e NVENC", () => {
  const c = conferirSistema(maquina({ ler: () => null, vendors: () => [], existe: (p) => !p.includes(".cargo") && !p.includes("nvidia"),
    comando: (n) => (n === "cargo" ? null : `/usr/bin/${n}`),
    biblioteca: (s) => (/libvulkan|libnvidia|libnvcuvid/.test(s) ? null : s) }));
  assert.equal(c.placa, false);
  assert.equal(c.cargo, null);
  assert.deepEqual(c.pacotes, []);
  assert.deepEqual(c.nvenc, []);
  const driver = c.faltas.find((f) => /driver/.test(f.oQue));
  assert.ok(driver && !driver.bloqueia && /ubuntu-drivers/.test(driver.comando ?? ""));
  assert.deepEqual(c.faltas.filter((f) => f.bloqueia).map((f) => f.oQue), ["Rust (cargo) ausente: o host do CEF (e, com placa, o módulo nativo) é compilado nesta máquina"]);
  const comCargo = conferirSistema(maquina({ ler: () => null, vendors: () => [], existe: (p) => p.startsWith("/etc/ssl/"),
    comando: (n) => (n === "cc" || n === "cmake" || n === "ninja" ? null : `/usr/bin/${n}`) }));
  assert.equal(comCargo.cargo, "/usr/bin/cargo");
  assert.deepEqual(comCargo.pacotes, ["build-essential", "cmake", "ninja-build"]);
});

test("o host do CEF compila com o cmake e o ninja (o cef-dll-sys monta o libcef_dll_wrapper): pedidos também com placa", () => {
  const c = conferirSistema(maquina({ comando: (n) => (n === "cmake" || n === "ninja" ? null : `/usr/bin/${n}`) }));
  assert.deepEqual(c.pacotes, ["cmake", "ninja-build"]);
  assert.equal(c.placa, true);
});

test(`driver abaixo do ${DRIVER_MINIMO}: placa fora, sem bloquear, com a versão achada`, () => {
  const c = conferirSistema(maquina({ ler: () => "550.120\n" }));
  assert.equal(c.placa, false);
  assert.match(c.faltas[0].oQue, /550\.120.*570/);
  assert.equal(c.faltas[0].bloqueia, false);
});

test("placa sem as bibliotecas do NVENC do driver: pede os pacotes da versão do driver", () => {
  const c = conferirSistema(maquina({ biblioteca: (s) => (/libnvidia-encode|libnvcuvid/.test(s) ? null : s) }));
  assert.deepEqual(c.pacotes, ["libnvidia-encode-595", "libnvidia-decode-595"]);
  assert.equal(c.placa, true);
});

test("Rust: sem cargo no PATH acha o do ~/.cargo/bin; sem nenhum, o rustup sem sudo; velho demais, rustup update", () => {
  const noCargo = maquina({ comando: (n) => (n === "cargo" ? null : `/usr/bin/${n}`), existe: (p) => p === "/home/u/.cargo/bin/cargo" || !p.includes(".cargo") });
  assert.equal(conferirSistema(noCargo).cargo, "/home/u/.cargo/bin/cargo");
  const sem = conferirSistema(maquina({ comando: (n) => (n === "cargo" ? null : `/usr/bin/${n}`), existe: (p) => !p.includes(".cargo") }));
  const f = sem.faltas.find((x) => /Rust/.test(x.oQue));
  assert.ok(f && f.bloqueia && /sh\.rustup\.rs/.test(f.comando ?? "") && !/sudo/.test(f.comando ?? ""));
  const velho = conferirSistema(maquina({ saida: (c) => (c.endsWith("cargo") ? "cargo 1.80.1 (x)" : "f.ttf: X") }));
  assert.ok(velho.faltas.some((x) => x.bloqueia && /1\.80.*1\.85/.test(x.oQue) && x.comando === "rustup update stable"));
});

test("placa sem o ICD do Vulkan da NVIDIA em nenhum dos dois lugares: placa fora, sem bloquear", () => {
  const so = conferirSistema(maquina({ existe: (p) => p !== "/usr/share/vulkan/icd.d/nvidia_icd.json" }));
  assert.equal(so.placa, true, "o de /etc/vulkan/icd.d serve");
  const c = conferirSistema(maquina({ existe: (p) => !p.endsWith("nvidia_icd.json") }));
  assert.equal(c.placa, false);
  assert.ok(c.faltas.some((f) => !f.bloqueia && /ICD do Vulkan/.test(f.oQue)));
});

test("bwrap que não cria namespace (userns barrado): aviso com o motivo, sem bloquear a instalação", () => {
  const saida = (cmd: string) => (cmd === "bwrap" ? null : cmd.endsWith("cargo") ? "cargo 1.91.0" : "f.ttf: X");
  const c = conferirSistema(maquina({ saida }));
  const f = c.faltas.find((x) => /bwrap/.test(x.oQue));
  // No Ubuntu 24.04 o perfil do apparmor-profiles fica em extra-profiles: o comando o copia e carrega.
  assert.ok(f && !f.bloqueia && /apparmor_parser -r \/etc\/apparmor\.d\/bwrap-userns-restrict/.test(f.comando ?? ""), JSON.stringify(f));
  // Sem placa não há o que esconder: o modo CPU roda sem o bwrap e não há aviso.
  const semPlaca = conferirSistema(maquina({ saida, ler: () => null }));
  assert.ok(!semPlaca.faltas.some((x) => /bwrap/.test(x.oQue)), JSON.stringify(semPlaca.faltas));
});

test("Node abaixo do 24, sem fonte nenhuma e disco curto: bloqueiam com o que fazer", () => {
  const c = conferirSistema(maquina({ node: "v22.11.0", saida: (c) => (c.endsWith("cargo") ? "cargo 1.91.0" : ""), livreBytes: () => 1e9 }));
  assert.ok(c.faltas.some((f) => f.bloqueia && /Node 22/.test(f.oQue)));
  assert.ok(c.faltas.some((f) => f.bloqueia && /espaço/.test(f.oQue)));
  assert.deepEqual(c.pacotes, ["fonts-dejavu-core"]);
});

// Etapas: o executor falso registra as chamadas e faz o que o comando faria no disco.
function executorFalso(efeito: (cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => void = () => {}) {
  const chamadas: string[] = [];
  const x: Executar = (cmd, args, { cwd, env }) => { chamadas.push(`${cmd} ${args.join(" ")} @${cwd}`); efeito(cmd, args, cwd, env); };
  return { x, chamadas };
}

test("npm: ci --ignore-scripts na primeira vez; de novo não refaz; lock mudado refaz", async () => {
  const pasta = join(tmp, "pacote");
  mkdirSync(pasta);
  writeFileSync(join(pasta, "package-lock.json"), '{"v":1}');
  const { x, chamadas } = executorFalso((_c, _a, cwd) => mkdirSync(join(cwd, "node_modules"), { recursive: true }));
  const etapa = etapaNpm("teste", pasta, x);
  assert.match(etapa.conferir() ?? "", /node_modules/);
  assert.deepEqual((await rodarEtapas([etapa], { verificar: false, avisar: () => {} })).faltas, []);
  assert.deepEqual(chamadas, [`npm ci --ignore-scripts --no-audit --no-fund @${pasta}`]);
  await rodarEtapas([etapa], { verificar: false, avisar: () => {} });
  assert.equal(chamadas.length, 1, "rodar de novo não pode refazer");
  writeFileSync(join(pasta, "package-lock.json"), '{"v":2}');
  assert.match(etapa.conferir() ?? "", /package-lock/);
  await rodarEtapas([etapa], { verificar: false, avisar: () => {} });
  assert.equal(chamadas.length, 2);
});

test("--verificar: não executa nada e devolve o que falta; etapa que falha continua faltando com o erro", async () => {
  const pasta = join(tmp, "pacote-verificar");
  mkdirSync(pasta);
  writeFileSync(join(pasta, "package-lock.json"), "{}");
  const { x, chamadas } = executorFalso();
  const r = await rodarEtapas([etapaNpm("teste", pasta, x)], { verificar: true, avisar: () => {} });
  assert.equal(chamadas.length, 0);
  assert.equal(r.faltas.length, 1);
  assert.match(r.faltas[0], /teste: .*node_modules/);
  const quebrada = executorFalso(() => { throw new Error("npm saiu com 1"); });
  const s = await rodarEtapas([etapaNpm("teste", pasta, quebrada.x)], { verificar: false, avisar: () => {} });
  assert.match(s.faltas[0], /npm saiu com 1/);
});

test("nativo: compila e copia para nativo.node; de novo não refaz; fonte mudada recompila; sem placa, pula", async () => {
  const fonte = join(tmp, "nativo");
  mkdirSync(join(fonte, "src"), { recursive: true });
  for (const [a, t] of [["Cargo.toml", "[package]"], ["Cargo.lock", "x"], ["build.rs", "fn main(){}"], ["src/lib.rs", "// 1"]]) writeFileSync(join(fonte, a), t);
  const c = { fonte, biblioteca: join(fonte, "target", "release", "libnativo.so"), modulo: join(tmp, "nativo.node") };
  const so = join(tmp, "libnvidia-encode.so.1");
  writeFileSync(so, "driver");
  let ligacao = "";
  const { x, chamadas } = executorFalso((_c, _a, cwd, env) => {
    ligacao = env?.NVIDIA_VIDEO_CODEC_SDK_PATH ?? "";
    mkdirSync(join(cwd, "target", "release"), { recursive: true });
    writeFileSync(join(cwd, "target", "release", "libnativo.so"), `so ${readFileSync(join(cwd, "src", "lib.rs"), "utf8")}`);
  });
  const etapa = etapaNativo(c, { cargo: "/x/cargo", placa: true, nvenc: [so] }, x);
  await rodarEtapas([etapa], { verificar: false, avisar: () => {} });
  assert.deepEqual(chamadas, [`/x/cargo build --release --locked @${fonte}`]);
  // Liga na .so.1 do driver por um link sem versão, sem o pacote de desenvolvimento.
  assert.equal(readFileSync(join(ligacao, "libnvidia-encode.so"), "utf8"), "driver");
  assert.equal(readFileSync(c.modulo, "utf8"), "so // 1");
  await rodarEtapas([etapa], { verificar: false, avisar: () => {} });
  assert.equal(chamadas.length, 1);
  writeFileSync(join(fonte, "src", "lib.rs"), "// 2");
  assert.match(etapa.conferir() ?? "", /fontes/);
  await rodarEtapas([etapa], { verificar: false, avisar: () => {} });
  assert.equal(readFileSync(c.modulo, "utf8"), "so // 2");
  writeFileSync(c.modulo, "estragado");
  assert.match(etapa.conferir() ?? "", /nativo\.node/);
  const pulada = etapaNativo(c, { cargo: null, placa: false, nvenc: [] }, x);
  assert.match(pulada.pular ?? "", /CPU/);
  const r = await rodarEtapas([pulada], { verificar: false, avisar: () => {} });
  assert.deepEqual(r.faltas, []);
});

// P02: o CEF é a captura do render, na placa e na CPU (o Electron remendado saiu com a entrada do Remotion).
test("CEF: baixa, confere e achata pelo preparar-cef.sh e compila o host; de novo não refaz; fonte mudada recompila", async () => {
  const fonte = join(tmp, "captura-cef");
  const nucleo = join(tmp, "nucleo");
  for (const d of [join(fonte, "src"), join(nucleo, "src")]) mkdirSync(d, { recursive: true });
  for (const [a, t] of [["Cargo.toml", "[package]"], ["Cargo.lock", "x"], ["src/main.rs", "// 1"]]) writeFileSync(join(fonte, a), t);
  writeFileSync(join(nucleo, "src", "lib.rs"), "// núcleo 1");
  const raiz = join(tmp, "cef", "156.0.14");
  const c = { fonte, nucleo, preparar: join(fonte, "preparar-cef.sh"), montar: join(fonte, "montar.sh"), raiz,
    host: join(fonte, "target", "release", "motor-captura"), sha1: "d091c82a8655113a34616c08cb340bf92310298d" };
  const so = join(tmp, "libnvidia-encode.so.1");
  writeFileSync(so, "driver");
  let ambiente: NodeJS.ProcessEnv | undefined;
  const { x, chamadas } = executorFalso((cmd, _a, cwd, env) => {
    ambiente = env;
    if (cmd.endsWith("preparar-cef.sh")) {
      mkdirSync(join(env!.CEF_RAIZ!, "rs"), { recursive: true });
      writeFileSync(join(env!.CEF_RAIZ!, "rs", "archive.json"), JSON.stringify({ sha1: c.sha1 }));
    } else {
      mkdirSync(join(cwd, "target", "release"), { recursive: true });
      writeFileSync(c.host, `host ${readFileSync(join(fonte, "src", "main.rs"), "utf8")}`);
    }
  });
  const etapa = etapaCef(c, { cargo: "/x/cargo", placa: true, nvenc: [so] }, x);
  assert.match(etapa.conferir() ?? "", /falta o CEF/);
  assert.deepEqual((await rodarEtapas([etapa], { verificar: false, avisar: () => {} })).faltas, []);
  assert.deepEqual(chamadas, [`${c.preparar}  @${fonte}`, `${c.montar}  @${fonte}`]);
  // O CEF vai para a pasta do cache do motor; o cargo e as .so do driver chegam ao montar.sh.
  assert.equal(ambiente?.CEF_PATH, join(raiz, "rs"));
  assert.match(ambiente?.PATH ?? "", /^\/x:/);
  assert.equal(readFileSync(join(ambiente!.NVIDIA_VIDEO_CODEC_SDK_PATH!, "libnvidia-encode.so"), "utf8"), "driver");
  await rodarEtapas([etapa], { verificar: false, avisar: () => {} });
  assert.equal(chamadas.length, 2, "rodar de novo não pode refazer");
  // O host inclui o núcleo do nativo por caminho: mudar o núcleo recompila (sem baixar de novo).
  writeFileSync(join(nucleo, "src", "lib.rs"), "// núcleo 2");
  assert.match(etapa.conferir() ?? "", /fontes/);
  await rodarEtapas([etapa], { verificar: false, avisar: () => {} });
  assert.deepEqual(chamadas.slice(2), [`${c.montar}  @${fonte}`]);
  // CEF trocado: baixa de novo.
  writeFileSync(join(raiz, "rs", "archive.json"), JSON.stringify({ sha1: "outro" }));
  assert.match(etapa.conferir() ?? "", /não confere/);
});

// P14: sem driver, o host é montado sem a feature `placa` (sem o NVENC/NVDEC, que ligam nas .so do driver), e a troca
// de máquina (driver instalado ou removido) remonta.
test("CEF sem placa: não pula, monta o host com --no-default-features e sem as .so do driver; placa que muda remonta", async () => {
  const fonte = join(tmp, "captura-cef-sem-placa");
  const nucleo = join(tmp, "nucleo-sem-placa");
  for (const d of [join(fonte, "src"), join(nucleo, "src")]) mkdirSync(d, { recursive: true });
  for (const [a, t] of [["Cargo.toml", "[package]"], ["Cargo.lock", "x"], ["src/main.rs", "// 1"]]) writeFileSync(join(fonte, a), t);
  writeFileSync(join(nucleo, "src", "lib.rs"), "// núcleo");
  const raiz = join(tmp, "cef-sem-placa", "156.0.14");
  mkdirSync(join(raiz, "rs"), { recursive: true });
  const sha1 = "d091c82a8655113a34616c08cb340bf92310298d";
  writeFileSync(join(raiz, "rs", "archive.json"), JSON.stringify({ sha1 }));
  const c = { fonte, nucleo, preparar: join(fonte, "preparar-cef.sh"), montar: join(fonte, "montar.sh"), raiz,
    host: join(fonte, "target", "release", "motor-captura"), sha1 };
  let ambiente: NodeJS.ProcessEnv | undefined;
  const { x, chamadas } = executorFalso((_cmd, args, cwd, env) => {
    ambiente = env;
    mkdirSync(join(cwd, "target", "release"), { recursive: true });
    writeFileSync(c.host, `host ${args.join(" ")}`);
  });
  const sem = etapaCef(c, { cargo: "/x/cargo", placa: false, nvenc: [] }, x);
  assert.equal(sem.pular, undefined, "sem placa o host é montado (o modo CPU passa por ele)");
  assert.deepEqual((await rodarEtapas([sem], { verificar: false, avisar: () => {} })).faltas, []);
  assert.deepEqual(chamadas, [`${c.montar} --no-default-features @${fonte}`]);
  assert.equal(ambiente?.NVIDIA_VIDEO_CODEC_SDK_PATH, undefined);
  assert.equal(sem.conferir(), null);
  // O driver chegou: o host sem a placa não serve mais; remonta com ela.
  const com = etapaCef(c, { cargo: "/x/cargo", placa: true, nvenc: [] }, x);
  assert.match(com.conferir() ?? "", /sem a placa/);
  await rodarEtapas([com], { verificar: false, avisar: () => {} });
  assert.deepEqual(chamadas.slice(1), [`${c.montar}  @${fonte}`]);
  assert.equal(com.conferir(), null);
  assert.match(sem.conferir() ?? "", /com a placa/);
  // Placa fora só agora (driver novo antes do reboot, nvidia-drm descarregado), com as .so do driver no lugar: o host
  // com a placa fica; não é trocado por um sem placa.
  const so = join(tmp, "libnvcuvid.so.1");
  writeFileSync(so, "driver");
  const passageira = etapaCef(c, { cargo: "/x/cargo", placa: false, nvenc: [so] }, x);
  assert.equal(passageira.conferir(), null);
});

test("sistema: as .so do driver são achadas mesmo com a placa fora agora; sem uma delas, nenhuma (host sem placa)", () => {
  const fora = conferirSistema(maquina({ existe: (p) => p !== "/dev/nvidiactl" }));
  assert.equal(fora.placa, false);
  assert.equal(fora.nvenc.length, 2);
  assert.deepEqual(fora.pacotes, []);
  const meia = conferirSistema(maquina({ ler: () => null, biblioteca: (s) => (s === "libnvcuvid.so.1" ? null : s) }));
  assert.deepEqual([meia.placa, meia.nvenc, meia.pacotes], [false, [], []]);
});

// A entrada do Remotion saiu (2026-10-31): o instalador não remenda nem pede o Electron remendado, nem instala o
// Remotion; o Electron que fica é o sem remendo, baixado pelo install.js dele, só para a conferência.
test("sem o Remotion: nada do Electron remendado nem do composicao/ no instalador; o Electron da conferência só baixa", async () => {
  assert.deepEqual(INSTALACAO.pacotesNpm.map((p) => p.pasta.split("/").pop()), ["captura", "conferencia"]);
  assert.deepEqual(Object.keys(INSTALACAO.electron).sort(), ["instalador", "original", "pasta"]);
  const etapas = etapasDoNavegador(INSTALACAO.electron, INSTALACAO.cef, { cargo: null, placa: true, nvenc: [] }, () => {});
  for (const e of etapas) assert.doesNotMatch(e.nome, /remendad/i, e.nome);
  const pasta = join(tmp, "electron");
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, "package.json"), JSON.stringify({ version: "45.1.0" }));
  const c = { pasta, instalador: join(pasta, "install.js"), original: join(pasta, "dist", "electron") };
  const { x, chamadas } = executorFalso((_c, _a, cwd) => {
    mkdirSync(join(cwd, "dist"), { recursive: true });
    writeFileSync(join(cwd, "dist", "version"), "45.1.0");
    writeFileSync(join(cwd, "dist", "electron"), "");
  });
  const etapa = etapaElectron(c, x);
  assert.match(etapa.conferir() ?? "", /não foi baixado/);
  assert.deepEqual((await rodarEtapas([etapa], { verificar: false, avisar: () => {} })).faltas, []);
  assert.equal(etapa.conferir(), null, "baixado basta: sem a cópia remendada (dist-nativo)");
  assert.deepEqual(chamadas, [`${process.execPath} ${c.instalador} @${pasta}`]);
});
