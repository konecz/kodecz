// Testes das regras do comando de render (M08), sem placa e sem Electron: argumentos, sonda da placa (com o
// ambiente injetado) e a escolha entre placa e CPU.
// Rodar: node --test "cli/*.test.ts"
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMINHOS, conferirArquivo, conferirNativo, ErroDeUso, tempoLimite, escolherModo, lerArgumentos, NATIVO_METODOS, sondarPlaca,
  type Ambiente } from "./regras.ts";

const pasta = mkdtempSync(join(tmpdir(), "m08-regras-"));
after(() => rmSync(pasta, { recursive: true, force: true }));
// Entradas do Remotion, que o motor recusa desde 2026-10-31 (docs/adr.md, seção 16): o pacote (index.html sem o bloco
// motor-video) e o projeto (src/index.ts).
const pacote = join(pasta, "pacote");
mkdirSync(pacote);
writeFileSync(join(pacote, "index.html"), "<!doctype html>");
const projeto = join(pasta, "projeto");
mkdirSync(join(projeto, "src"), { recursive: true });
mkdirSync(join(projeto, "public"));
writeFileSync(join(projeto, "src", "index.ts"), "");
// P10: pasta com index.html e o bloco <script id="motor-video"> é a composição em linha do tempo, a única entrada.
const linha = join(pasta, "linha");
mkdirSync(linha);
const declarar = (d: unknown) => `<!doctype html><title>x</title>\n<script type="application/json" id="motor-video">\n${JSON.stringify(d)}\n</script>`;
writeFileSync(join(linha, "index.html"), declarar({ id: "Linha", largura: 960, altura: 540, qps: 30, quadros: 60 }));

const ler = (...a: string[]) => lerArgumentos(a);
const falha = (re: RegExp, ...a: string[]) => assert.throws(() => ler(...a), (e: unknown) => e instanceof ErroDeUso && re.test(e.message));

test("mínimo: composição, id e saída; modo automático, com áudio", () => {
  const a = ler(linha, "Linha", join(pasta, "a.mp4"));
  assert.equal(a.modo, "auto");
  assert.equal(a.entrada.tipo, "linha");
  assert.equal(a.composicao, "Linha");
  assert.equal(a.audio, true);
  assert.equal(a.alfa, false);
  // P01: sem opção, H.264 (toca em todo navegador).
  assert.equal(a.codec, "h264");
  assert.equal(a.de, 0);
  assert.equal(a.quadros, null);
});

// A entrada do Remotion saiu (2026-10-31): pacote, projeto e arquivo de entrada são recusados com o motivo e o que fazer.
test("entrada do Remotion: pacote, projeto e arquivo recusados, com o motivo e o caminho da linha do tempo", () => {
  for (const entrada of [pacote, projeto, join(projeto, "src", "index.ts")]) {
    falha(/entrada do Remotion saiu do motor.*adr\.md, seção 16.*docs\/formatos\/linha-do-tempo\.md/s, entrada, "X", join(pasta, "a.mp4"));
  }
  // As opções que eram só dela também dizem por quê.
  falha(/--props era da entrada do Remotion.*linha-do-tempo\.md/s, linha, "Linha", "s.mp4", "--props", "{}");
  falha(/--public era da entrada do Remotion.*linha-do-tempo\.md/s, linha, "Linha", "s.mp4", "--public", pasta);
  falha(/--captura saiu.*CEF/s, linha, "Linha", "s.mp4", "--captura", "electron");
});

test("linha do tempo: o bloco motor-video faz a entrada, com a declaração lida", () => {
  const a = ler(linha, "Linha", "s.mp4", "--de", "10", "--quadros", "50");
  assert.equal(a.entrada.tipo, "linha");
  assert.deepEqual(a.entrada.tipo === "linha" && a.entrada.declaracao, { id: "Linha", largura: 960, altura: 540, qps: 30, quadros: 60 });
  assert.deepEqual([a.de, a.quadros], [10, 50]);
  // P10.5: o formato tem áudio embutido (<video> e <audio>); --sem-audio desliga, como no Remotion.
  assert.equal(a.audio, true);
  assert.equal(ler(linha, "Linha", "s.mp4", "--sem-audio").audio, false);
});

test("linha do tempo: só o bloco de verdade conta (atributo id, fora de comentário)", () => {
  const html = (corpo: string) => { const p = mkdtempSync(join(pasta, "bloco-")); writeFileSync(join(p, "index.html"), corpo); return p; };
  const d = '{"id":"L","largura":960,"altura":540,"qps":30,"quadros":60}';
  // Sem o bloco de verdade, não é linha do tempo: a pasta é recusada (como o pacote do Remotion).
  falha(/entrada do Remotion saiu do motor/, html(`<script type="application/json" data-id="motor-video">${d}</script>`), "L", "s.mp4");
  falha(/entrada do Remotion saiu do motor/, html(`<!-- <script type="application/json" id="motor-video">${d}</script> -->`), "L", "s.mp4");
  assert.equal(ler(html(`<script type=application/json id=motor-video>${d}</script>`), "L", "s.mp4").entrada.tipo, "linha");
  falha(/type="application\/json"/, html(`<script id="motor-video">${d}</script>`), "L", "s.mp4");
});

test("linha do tempo: id e trecho conferidos contra a declaração", () => {
  falha(/composição «Outra» não existe.*Linha/, linha, "Outra", "s.mp4");
  falha(/--de 60 fora da composição \(60 quadros\)/, linha, "Linha", "s.mp4", "--de", "60");
  falha(/--de 10 --quadros 51 passa do fim \(60 quadros\)/, linha, "Linha", "s.mp4", "--de", "10", "--quadros", "51");
});

test("linha do tempo: declaração inválida diz o campo", () => {
  const casos: [unknown, RegExp][] = [
    ["{", /motor-video"> não é JSON válido/],
    [{ largura: 960, altura: 540, qps: 30, quadros: 60 }, /«id»/],
    [{ id: "L", largura: 640, altura: 540, qps: 30, quadros: 60 }, /«largura».*≥ 800/],
    [{ id: "L", largura: 961, altura: 540, qps: 30, quadros: 60 }, /«largura».*par/],
    [{ id: "L", largura: 960, altura: 15, qps: 30, quadros: 60 }, /«altura»/],
    [{ id: "L", largura: 8194, altura: 540, qps: 30, quadros: 60 }, /«largura».*≤ 8192/],
    [{ id: "L", largura: 960, altura: 540, qps: 0, quadros: 60 }, /«qps»/],
    [{ id: "L", largura: 960, altura: 540, qps: 30, quadros: 1.5 }, /«quadros»/],
  ];
  for (const [d, re] of casos) {
    const p = mkdtempSync(join(pasta, "decl-"));
    writeFileSync(join(p, "index.html"), typeof d === "string" ? `<script id="motor-video" type="application/json">${d}</script>` : declarar(d));
    falha(re, p, "L", "s.mp4");
  }
});

test("--placa, --cpu, trecho e quadros gravados", () => {
  assert.equal(ler(linha, "Linha", "s.mp4", "--placa").modo, "placa");
  assert.equal(ler(linha, "Linha", "s.mp4", "--cpu").modo, "cpu");
  const a = ler(linha, "Linha", "s.mp4", "--de", "10", "--quadros", "20");
  assert.deepEqual([a.de, a.quadros], [10, 20]);
  assert.deepEqual(ler(linha, "Linha", "s.mp4", "--gravar", "0,5,9", "--gravar-pasta", pasta).gravar, [0, 5, 9]);
});

test("argumentos inválidos dão erro de uso com a correção", () => {
  falha(/faltam argumentos.*<entrada> <composição> <saída.mp4>/s);
  falha(/faltam argumentos/, linha, "Linha");
  falha(/--placa e --cpu juntos/, linha, "Linha", "s.mp4", "--placa", "--cpu");
  falha(/a saída tem de terminar em \.mp4/, linha, "Linha", "s.mov");
  falha(/entrada não existe/, join(pasta, "nada"), "X", "s.mp4");
  falha(/não é uma composição da linha do tempo.*falta index\.html.*linha-do-tempo\.md/s, pasta, "X", "s.mp4");
  falha(/--quadros tem de ser inteiro ≥ 1/, linha, "Linha", "s.mp4", "--quadros", "0");
  falha(/--de tem de ser inteiro ≥ 0/, linha, "Linha", "s.mp4", "--de=-3");
  falha(/--de tem de ser inteiro ≥ 0/, linha, "Linha", "s.mp4", "--de", "1.5");
  falha(/opção desconhecida.*--gpu/s, linha, "Linha", "s.mp4", "--gpu");
  falha(/argumento a mais/, linha, "Linha", "s.mp4", "sobra");
  falha(/--gravar pede --gravar-pasta/, linha, "Linha", "s.mp4", "--gravar", "1");
  falha(/--gravar: lista de quadros/, linha, "Linha", "s.mp4", "--gravar", "1,a", "--gravar-pasta", pasta);
});

test("--alfa: só na placa, saída .hevc e sem áudio (camada do M05)", () => {
  const a = ler(linha, "Linha", "camada.hevc", "--alfa");
  assert.deepEqual([a.alfa, a.audio, a.modo, a.codec], [true, false, "placa", "hevc"]);
  // --hevc junto não muda nada: a camada já é HEVC.
  assert.equal(ler(linha, "Linha", "camada.hevc", "--alfa", "--hevc").codec, "hevc");
  falha(/--alfa só existe no modo placa/, linha, "Linha", "camada.hevc", "--alfa", "--cpu");
  falha(/com --alfa a saída é \.hevc/, linha, "Linha", "camada.mp4", "--alfa");
});

test("--hevc (P01): HEVC em MP4, só na placa e com áudio; sem ele, H.264 nos dois modos", () => {
  const a = ler(linha, "Linha", "s.mp4", "--hevc");
  assert.deepEqual([a.codec, a.modo, a.audio, a.alfa], ["hevc", "placa", true, false]);
  assert.equal(ler(linha, "Linha", "s.mp4", "--hevc", "--placa").codec, "hevc");
  assert.equal(ler(linha, "Linha", "s.mp4", "--placa").codec, "h264");
  assert.equal(ler(linha, "Linha", "s.mp4", "--cpu").codec, "h264");
  falha(/--hevc só existe no modo placa.*sem --hevc/s, linha, "Linha", "s.mp4", "--hevc", "--cpu");
  falha(/opção desconhecida.*--codec/s, linha, "Linha", "s.mp4", "--codec", "hevc");
});

// Ambiente falso da sonda: tudo presente, com cada peça removível.
const ambiente = (mudar: Partial<Ambiente> = {}): Ambiente => ({
  env: {},
  existe: () => true,
  vendors: () => [["renderD128", "0x1002"], ["renderD129", "0x10de"]],
  noPath: () => true,
  sondarNvenc: () => null,
  sondarNativo: () => null,
  ...mudar,
});

test("sonda: tudo presente dá a placa com o render node da NVIDIA (achado pelo vendor)", () => {
  assert.deepEqual(sondarPlaca(ambiente()), { ok: true, renderNode: "/dev/dri/renderD129" });
});

test("sonda: sem placa NVIDIA (ausente) × placa presente que não serve agora", () => {
  const falha = (a: Ambiente, alfa = false) => { const r = sondarPlaca(a, { codec: alfa ? "hevc" : "h264", alfa }); assert.equal(r.ok, false); return r.ok ? null : r; };
  // Ausente: não há placa NVIDIA (ou driver) nesta máquina; só aqui o automático cai para a CPU.
  for (const [a, re] of [
    [ambiente({ env: { MOTOR_SEM_PLACA: "1" } }), /MOTOR_SEM_PLACA=1/],
    [ambiente({ vendors: () => [["renderD128", "0x1002"]] }), /nenhum render node da NVIDIA/],
    [ambiente({ existe: (p) => !p.startsWith("/dev/nvidia") }), /\/dev\/nvidiactl/],
  ] as [Ambiente, RegExp][]) {
    const r = falha(a)!;
    assert.match(r.motivo, re);
    assert.equal(r.ausente, true, r.motivo);
  }
  // Presente, mas não serve: falta peça do motor, NVENC sem sessão, VRAM cheia, a camada de alfa não abre.
  for (const [a, re, alfa] of [
    [ambiente({ noPath: (b) => b !== "weston" }), /weston/, false],
    [ambiente({ existe: (p) => !p.endsWith("motor-captura") }), /host do CEF.*captura\/cef\/montar\.sh/, false],
    [ambiente({ existe: (p) => !p.endsWith("nativo.node") }), /nativo\.node/, false],
    [ambiente({ sondarNvenc: () => "iniciar NVENC: NV_ENC_ERR_OUT_OF_MEMORY (sem sessão livre)" }), /NVENC.*sem sessão livre/, false],
    [ambiente({ sondarNvenc: () => "vkAllocateMemory: ERROR_OUT_OF_DEVICE_MEMORY" }), /OUT_OF_DEVICE_MEMORY/, false],
    [ambiente({ sondarNvenc: (_n, c) => (c.alfa ? "iniciar NVENC (alfa=true): sem camada de alfa" : null) }), /alfa=true/, true],
  ] as [Ambiente, RegExp, boolean][]) {
    const r = falha(a, alfa)!;
    assert.match(r.motivo, re);
    assert.equal(r.ausente, false, r.motivo);
  }
});

test("sonda: o NVENC é aberto no codec do render (H.264 por padrão; HEVC, e com a camada de alfa, se pedidos)", () => {
  const pedidos: string[] = [];
  const a = ambiente({ sondarNvenc: (_n, c) => { pedidos.push(`${c.codec}${c.alfa ? "+alfa" : ""}`); return null; } });
  sondarPlaca(a, { codec: "hevc", alfa: true });
  sondarPlaca(a, { codec: "hevc" });
  sondarPlaca(a);
  assert.deepEqual(pedidos, ["hevc+alfa", "hevc", "h264"]);
  const r = sondarPlaca(ambiente({ sondarNvenc: (_n, c) => (c.codec === "h264" ? "sem H.264" : null) }));
  assert.ok(!r.ok && /Vulkan\/NVENC em H\.264 não abriu: sem H\.264/.test(r.motivo), JSON.stringify(r));
});

// P04: a sonda do nativo.node (existe, carrega, expõe o que o motor usa), antes do NVENC.
const nativoFalso = (sem: string[] = []) => {
  class Motor {}
  for (const m of NATIVO_METODOS.filter((m) => !sem.includes(`Motor.${m}`))) (Motor.prototype as any)[m] = () => {};
  const r: Record<string, unknown> = { Motor, lerMarca: () => 0, versao: () => "0.1.0" };
  for (const f of sem) delete r[f];
  return r;
};

test("sonda do nativo: com tudo dá null; sem uma função ou um método, diz o que falta e como compilar", () => {
  assert.equal(conferirNativo(() => nativoFalso()), null);
  for (const [sem, re] of [[["versao"], /não tem versao/], [["lerMarca"], /não tem lerMarca/], [["Motor.repetir"], /não tem Motor\.repetir/],
    [["Motor"], /não tem Motor, Motor\.quadro/]] as [string[], RegExp][]) {
    const m = conferirNativo(() => nativoFalso(sem));
    assert.match(m ?? "", re);
    assert.match(m ?? "", /cargo build --release/);
  }
});

test("sonda do nativo: arquivo faltando ou quebrado não carrega, com a instrução de compilar", () => {
  const exigir = createRequire(import.meta.url);
  const falta = conferirNativo(() => exigir(join(pasta, "nao-existe.node")));
  assert.match(falta ?? "", /não carrega.*cargo build --release/s);
  const quebrado = join(pasta, "quebrado.node");
  writeFileSync(quebrado, "isto não é uma biblioteca");
  assert.match(conferirNativo(() => exigir(quebrado)) ?? "", /não carrega \(.*\); compile com: .*cargo build --release/);
});

test("sonda do nativo: o nativo.node compilado de nativo/ serve (o de verdade, sem placa)", { skip: !existsSync(CAMINHOS.nativo) && `falta ${CAMINHOS.nativo}` }, () => {
  assert.equal(conferirNativo(() => createRequire(import.meta.url)(CAMINHOS.nativo)), null);
});

test("sonda da placa: nativo.node que não serve para antes do NVENC, sem cair para a CPU", () => {
  let nvenc = 0;
  const r = sondarPlaca(ambiente({ sondarNativo: () => "o nativo.node não tem versao", sondarNvenc: () => { nvenc++; return null; } }));
  assert.ok(!r.ok && !r.ausente && /não tem versao/.test(r.motivo), JSON.stringify(r));
  assert.equal(nvenc, 0);
});

test("sonda: MOTOR_SEM_PLACA nem chega a abrir o NVENC", () => {
  let abriu = false;
  sondarPlaca(ambiente({ env: { MOTOR_SEM_PLACA: "1" }, sondarNvenc: () => { abriu = true; return null; } }));
  assert.equal(abriu, false);
});

test("escolha: automático usa a placa; cai para CPU avisando só sem placa NVIDIA", () => {
  assert.deepEqual(escolherModo("auto", () => ({ ok: true, renderNode: "/dev/dri/renderD129" })),
    { modo: "placa", renderNode: "/dev/dri/renderD129", aviso: null });
  const r = escolherModo("auto", () => ({ ok: false, ausente: true, motivo: "nenhum render node da NVIDIA" }));
  assert.equal(r.modo, "cpu");
  assert.match(r.aviso ?? "", /sem placa \(nenhum render node da NVIDIA\).*CPU/);
});

test("escolha: automático com a placa presente e ocupada sai com 3, sem cair para a CPU", () => {
  assert.throws(() => escolherModo("auto", () => ({ ok: false, ausente: false, motivo: "Vulkan/NVENC não abriu: sem sessão livre" })),
    (e: unknown) => e instanceof ErroDeUso && e.codigo === 3
      && /placa NVIDIA está aqui, mas não serve agora: Vulkan\/NVENC não abriu: sem sessão livre.*esperar.*--cpu/s.test(e.message));
});

test("escolha: --placa sem placa falha (não cai sozinho); --cpu nem sonda", () => {
  for (const ausente of [true, false]) {
    assert.throws(() => escolherModo("placa", () => ({ ok: false, ausente, motivo: "weston fora do PATH" })),
      (e: unknown) => e instanceof ErroDeUso && e.codigo === 3 && /--placa.*weston fora do PATH.*--cpu/s.test(e.message));
  }
  let sondou = false;
  assert.deepEqual(escolherModo("cpu", () => { sondou = true; return { ok: true, renderNode: "x" }; }),
    { modo: "cpu", renderNode: null, aviso: null });
  assert.equal(sondou, false);
});

test("arquivo final: quadros iguais ao render e áudio com a duração do vídeo", () => {
  const ok = { quadros: 150, video: "h264", audio: "aac", duracaoVideo: 4.999956, duracaoAudio: 5 };
  assert.equal(conferirArquivo(ok, { quadros: 150, fps: 30, audio: true }), null);
  assert.equal(conferirArquivo({ ...ok, audio: null, duracaoAudio: null }, { quadros: 150, fps: 30, audio: false }), null);
  assert.match(conferirArquivo({ ...ok, quadros: 149 }, { quadros: 150, fps: 30, audio: true }) ?? "", /149 quadros de vídeo; o render mandou 150/);
  assert.match(conferirArquivo({ ...ok, quadros: null }, { quadros: 150, fps: 30, audio: true }) ?? "", /sem faixa de vídeo legível/);
  assert.match(conferirArquivo({ ...ok, audio: null, duracaoAudio: null }, { quadros: 150, fps: 30, audio: true }) ?? "", /sem a faixa de áudio/);
  // Mais de um quadro (1/30 s) de diferença entre áudio e vídeo.
  assert.match(conferirArquivo({ ...ok, duracaoAudio: 4.5 }, { quadros: 150, fps: 30, audio: true }) ?? "", /áudio dura 4\.500 s; o vídeo, 5\.000 s/);
  assert.equal(conferirArquivo({ ...ok, duracaoAudio: 5.02 }, { quadros: 150, fps: 30, audio: true }), null);
});

test("tempo-limite: proporcional aos quadros, mais folgado na CPU; sem a duração, o padrão de 3000 quadros", () => {
  assert.equal(tempoLimite(150, "cpu"), 270_000);
  assert.equal(tempoLimite(150, "placa"), 240_000);
  assert.equal(tempoLimite(null, "placa"), tempoLimite(3000, "placa"));
  assert.ok(tempoLimite(11389, "cpu") > tempoLimite(3000, "cpu"));
});

// P02 e a saída do Remotion (2026-10-31): a captura é sempre pelo CEF; a sonda pede o host montado e não olha o
// Electron (o remendado saiu do motor).
test("sonda: pede o host do CEF montado, não o Electron", () => {
  assert.deepEqual(sondarPlaca(ambiente({ existe: (p) => !p.includes("electron") })), { ok: true, renderNode: "/dev/dri/renderD129" });
  const r = sondarPlaca(ambiente({ existe: (p) => !p.endsWith("motor-captura") }));
  assert.ok(!r.ok && !r.ausente && /host do CEF.*captura\/cef\/montar\.sh/.test(r.motivo), JSON.stringify(r));
});
