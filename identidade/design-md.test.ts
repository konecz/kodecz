// Testes do leitor de DESIGN.md (S03, docs/formatos/design-md.md). Marca fictícia em fixtures/ (R01).
// Rodar: node --test identidade/design-md.test.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { analisarDesignMd, lerDesignMd, paraCss, analisarYaml } from "./design-md.ts";

const FIXTURE = new URL("./fixtures/marca-ficticia/DESIGN.md", import.meta.url).pathname;
const CLI = new URL("./design-md.ts", import.meta.url).pathname;
const TEXTO = readFileSync(FIXTURE, "utf8");

/** Troca um trecho da fixture, falhando se o trecho não existe (o teste não pode passar por engano). */
const trocar = (de: string, para: string, texto: string = TEXTO): string => {
  assert.ok(texto.includes(de), `trecho ausente na fixture: ${de}`);
  return texto.replace(de, para);
};
const caminhos = (r: { erros: { caminho: string }[] }): string[] => r.erros.map((e) => e.caminho);
/** Número da linha (de 1 em diante) da ocorrência de um trecho a partir da posição `depois`. */
const linhaDe = (texto: string, trecho: string, depois = 0): number => {
  const k = texto.indexOf(trecho, depois);
  assert.ok(k >= 0, `trecho ausente: ${trecho}`);
  return texto.slice(0, k).split("\n").length;
};

test("a marca fictícia é válida e expõe os tokens", () => {
  const r = analisarDesignMd(TEXTO);
  assert.deepEqual(r.erros, []);
  assert.equal(r.ok, true);
  assert.equal(r.tokens!.name, "Zunzum Torrefação (marca fictícia)");
  assert.equal(r.tokens!.colors.ground, "#F7F4EC");
  assert.equal(r.tokens!.colors["accent-2"], "#2E86AB");
  assert.deepEqual(r.tokens!.typography.display, {
    fontFamily: "Crimson Pro", fontWeight: 800, fontSize: "96px", lineHeight: 1, letterSpacing: "-0.02em",
  });
  assert.equal(r.tokens!.motion.duration.enter, "400ms");
  assert.deepEqual(r.tokens!.voice.avoid, ["incrível", "revolucionário", "o melhor do mundo"]);
  assert.equal(r.tokens!.logo.src, "marca/logo.svg");
  assert.match(r.tokens!.description, /^Torrefação de bairro inventada para os testes do motor-video\. Calor/);
  assert.ok(r.secoes["Visão geral"].includes("papel de embalagem"));
  assert.ok("Tom de voz" in r.secoes);
});

test("sem frontmatter é erro", () => {
  const r = analisarDesignMd("# Marca\n\n## Visão geral\n\nx\n\n## Tom de voz\n\ny\n");
  assert.equal(r.ok, false);
  assert.deepEqual(caminhos(r), ["frontmatter"]);
});

test("cor obrigatória ausente aponta o caminho", () => {
  const r = analisarDesignMd(trocar('  accent: "#E4572E"\n', ""));
  assert.equal(r.ok, false);
  assert.ok(caminhos(r).includes("colors.accent"), JSON.stringify(r.erros));
});

test("cor sem aspas vira comentário em YAML: erro que explica", () => {
  const r = analisarDesignMd(trocar('ground: "#F7F4EC"', "ground: #F7F4EC"));
  assert.equal(r.ok, false);
  const erro = r.erros.find((e) => e.caminho === "colors.ground");
  assert.ok(erro, JSON.stringify(r.erros));
  assert.match(erro.mensagem, /aspas/);
});

test("cor fora do hexadecimal é erro", () => {
  for (const ruim of ['"#12"', '"rgb(1, 2, 3)"', '"laranja"']) {
    const r = analisarDesignMd(trocar('accent: "#E4572E"', `accent: ${ruim}`));
    assert.ok(caminhos(r).includes("colors.accent"), `${ruim}: ${JSON.stringify(r.erros)}`);
  }
});

test("tipografia obrigatória sem família é erro; dimensão inválida também", () => {
  const r = analisarDesignMd(trocar('display: { fontFamily: "Crimson Pro", ', "display: { "));
  assert.ok(caminhos(r).includes("typography.display.fontFamily"), JSON.stringify(r.erros));
  const r2 = analisarDesignMd(trocar('fontSize: "64px"', 'fontSize: "grande"'));
  assert.ok(caminhos(r2).includes("typography.title.fontSize"), JSON.stringify(r2.erros));
});

test("nome de token fora do kebab-case é erro (vira variável CSS)", () => {
  const r = analisarDesignMd(trocar("  muted:", "  Muted_Cor:"));
  assert.ok(caminhos(r).includes("colors.Muted_Cor"), JSON.stringify(r.erros));
});

test("referência quebrada é erro", () => {
  const r = analisarDesignMd(trocar('"{colors.ink}"', '"{colors.nao-existe}"'));
  assert.ok(caminhos(r).includes("components.caption-box.backgroundColor"), JSON.stringify(r.erros));
});

test("chave duplicada é erro, com a linha exata do arquivo", () => {
  const texto = trocar('  muted: "#6B6F7A"\n', '  muted: "#6B6F7A"\n  muted: "#000000"\n');
  const r = analisarDesignMd(texto);
  assert.equal(r.ok, false);
  const linha = linhaDe(texto, '  muted: "#000000"');
  assert.deepEqual(r.erros.map((e) => [e.caminho, e.linha]), [["frontmatter", linha]]);
  assert.match(r.erros[0].mensagem, new RegExp(`^linha ${linha}: chave duplicada: muted$`));
});

test("seção obrigatória ausente ou repetida é erro, com a linha exata", () => {
  const r = analisarDesignMd(trocar("## Tom de voz", "## Voz"));
  assert.ok(caminhos(r).includes("secoes.Tom de voz"), JSON.stringify(r.erros));
  const texto = TEXTO + "\n## Cores\n\nde novo\n";
  const r2 = analisarDesignMd(texto);
  const erro = r2.erros.find((e) => e.caminho === "secoes.Cores");
  assert.ok(erro, JSON.stringify(r2.erros));
  const linha = linhaDe(texto, "## Cores", texto.indexOf("## Cores") + 1);
  assert.equal(erro.linha, linha);
  assert.match(erro.mensagem, new RegExp(`linha ${linha}\\b`));
});

test("seção ## com nome de protótipo não contamina o objeto", () => {
  const r = analisarDesignMd(TEXTO + "\n## __proto__\n\nx\n");
  assert.equal(Object.hasOwn(r.secoes, "__proto__"), true);
  assert.equal(r.secoes["__proto__"], "x");
  assert.equal(r.ok, true, JSON.stringify(r.erros));
});

test("fontWeight é número inteiro de 1 a 1000, como fonts.weight", () => {
  for (const ruim of ['"700"', "700.5", "0", "1001"]) {
    const r = analisarDesignMd(trocar("fontWeight: 800", `fontWeight: ${ruim}`));
    assert.ok(caminhos(r).includes("typography.display.fontWeight"), `${ruim}: ${JSON.stringify(r.erros)}`);
  }
});

test("fonts.weight aceita a faixa da fonte variável, \"min max\" entre aspas, e o @font-face a declara", () => {
  // Visto no primeiro vídeo real (S03): a fonte da marca era um woff2 variável (wght 100 a 900); com um peso só no
  // @font-face, o navegador prende o eixo nele e o texto de outro peso sai no peso errado.
  const com = (w: string) => trocar("spacing:\n", `fonts:\n  - { family: "Crimson Pro", src: "marca/f.woff2", weight: ${w} }\n\nspacing:\n`);
  const bom = analisarDesignMd(com('"100 900"'));
  assert.deepEqual(bom.erros, []);
  assert.match(paraCss(bom.tokens!), /font-weight: 100 900;/);
  for (const ruim of ['"900 100"', '"100 900 950"', '"0 900"', '"100 1001"', '"100.5 900"', '"cem 900"', '"700"']) {
    const r = analisarDesignMd(com(ruim));
    assert.ok(caminhos(r).includes("fonts.0.weight"), `${ruim}: ${JSON.stringify(r.erros)}`);
  }
});

test("fonts.src e logo.src: sem URL nem caracteres que quebram o url() do CSS", () => {
  const com = (src: string) => trocar("spacing:\n", `fonts:\n  - { family: "Crimson Pro", src: ${src}, weight: 800 }\n\nspacing:\n`);
  for (const ruim of ['"https://exemplo.invalid/f.woff2"', '"data:font/woff2;base64,AAAA.woff2"', '"../f.woff2"',
    '"marca/a\\").woff2"', '"marca/a(b).woff2"', '"marca/a;b.woff2"', '"marca/a\\\\b.woff2"', '"marca/a\\nb.woff2"']) {
    const r = analisarDesignMd(com(ruim));
    assert.ok(caminhos(r).includes("fonts.0.src"), `${ruim}: ${JSON.stringify(r.erros)}`);
  }
  for (const ruim of ['"marca/lo\\"go.svg"', '"marca/lo)go.svg"']) {
    const r = analisarDesignMd(trocar('src: "marca/logo.svg"', `src: ${ruim}`));
    assert.ok(caminhos(r).includes("logo.src"), `${ruim}: ${JSON.stringify(r.erros)}`);
  }
});

test("paraCss escapa a família e o caminho mesmo sem validação", () => {
  const css = paraCss({ typography: { body: { fontFamily: 'A"B' } }, fonts: [{ family: 'A"B', src: 'x")\\y.woff2' }] });
  assert.match(css, /--font-body: "A\\"B";/);
  assert.match(css, /font-family: "A\\"B"; src: url\("x\\"\)\\\\y\.woff2"\)/);
});

test("logo por URL ou fora do projeto é erro (sem rede, R03)", () => {
  for (const ruim of ['"https://exemplo.invalid/logo.svg"', '"../outra/logo.svg"', '"/abs/logo.svg"']) {
    const r = analisarDesignMd(trocar('src: "marca/logo.svg"', `src: ${ruim}`));
    assert.ok(caminhos(r).includes("logo.src"), `${ruim}: ${JSON.stringify(r.erros)}`);
  }
});

test("movimento: tempo e curva validados", () => {
  const r = analisarDesignMd(trocar('enter: "400ms"', 'enter: "400"'));
  assert.ok(caminhos(r).includes("motion.duration.enter"), JSON.stringify(r.erros));
  const r2 = analisarDesignMd(trocar('exit: "ease-in"', 'exit: "mola"'));
  assert.ok(caminhos(r2).includes("motion.easing.exit"), JSON.stringify(r2.erros));
});

test("idioma da voz em BCP 47", () => {
  const r = analisarDesignMd(trocar("language: pt-BR", "language: portugues brasileiro"));
  assert.ok(caminhos(r).includes("voice.language"), JSON.stringify(r.erros));
});

test("chave desconhecida no topo é só aviso", () => {
  const r = analisarDesignMd(trocar("colors:\n", "colours: 1\ncolors:\n"));
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.deepEqual(r.avisos.map((a) => a.caminho), ["colours"]);
});

test("variáveis CSS e @font-face", () => {
  const { tokens } = analisarDesignMd(TEXTO);
  const css = paraCss(tokens!);
  assert.match(css, /^:root \{\n/);
  assert.match(css, /\n  --color-ground: #F7F4EC;\n/);
  assert.match(css, /\n  --color-accent-2: #2E86AB;\n/);
  assert.match(css, /\n  --font-display: "Crimson Pro";\n/);
  assert.match(css, /\n  --font-display-weight: 800;\n/);
  assert.match(css, /\n  --font-display-size: 96px;\n/);
  assert.match(css, /\n  --font-display-line-height: 1;\n/);
  assert.match(css, /\n  --font-display-letter-spacing: -0.02em;\n/);
  assert.match(css, /\n  --spacing-margin: 96px;\n/);
  assert.match(css, /\n  --rounded-pill: 999px;\n/);
  assert.match(css, /\n  --motion-duration-enter: 400ms;\n/);
  assert.match(css, /\n  --motion-easing-enter: cubic-bezier\(0\.16, 1, 0\.3, 1\);\n/);
  assert.doesNotMatch(css, /@font-face/);

  const comFontes = trocar("spacing:\n", 'fonts:\n  - { family: "Crimson Pro", src: "marca/fontes/crimson-pro-800.woff2", weight: 800 }\n\nspacing:\n');
  const r = analisarDesignMd(comFontes);
  assert.deepEqual(r.erros, []);
  const css2 = paraCss(r.tokens!, { base: "../projeto/" });
  assert.match(css2, /@font-face \{ font-family: "Crimson Pro"; src: url\("\.\.\/projeto\/marca\/fontes\/crimson-pro-800\.woff2"\) format\("woff2"\); font-weight: 800; font-style: normal; font-display: block; \}/);
});

test("lerDesignMd confere os arquivos do logo e das fontes", () => {
  const ok = lerDesignMd(FIXTURE);
  assert.deepEqual(ok.erros, []);
  assert.equal(ok.ok, true);

  const dir = mkdtempSync(join(tmpdir(), "s03-"));
  try {
    const texto = trocar("spacing:\n", 'fonts:\n  - { family: "Crimson Pro", src: "marca/fontes/f.woff2", weight: 800 }\n\nspacing:\n');
    writeFileSync(join(dir, "DESIGN.md"), texto);
    const r = lerDesignMd(join(dir, "DESIGN.md"));
    assert.deepEqual(caminhos(r).sort(), ["fonts.0.src", "logo.src", "logo.srcOnDark"]);
    mkdirSync(join(dir, "marca/fontes"), { recursive: true });
    for (const f of ["marca/logo.svg", "marca/logo-claro.svg", "marca/fontes/f.woff2"]) writeFileSync(join(dir, f), "");
    assert.deepEqual(lerDesignMd(join(dir, "DESIGN.md")).erros, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: conferir sai com 0 ou 1 e escreve JSON; css escreve as variáveis", () => {
  const ok = spawnSync(process.execPath, [CLI, "conferir", FIXTURE], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).ok, true);

  const dir = mkdtempSync(join(tmpdir(), "s03-"));
  try {
    writeFileSync(join(dir, "DESIGN.md"), "---\nname: x\n---\n");
    const ruim = spawnSync(process.execPath, [CLI, "conferir", join(dir, "DESIGN.md")], { encoding: "utf8" });
    assert.equal(ruim.status, 1);
    assert.ok(JSON.parse(ruim.stdout).erros.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const css = spawnSync(process.execPath, [CLI, "css", FIXTURE], { encoding: "utf8" });
  assert.equal(css.status, 0, css.stderr);
  assert.match(css.stdout, /--color-ink: #1B1F2A;/);
});

test("CLI: mensagem do erro, css com erro, uso errado e --base", () => {
  const dir = mkdtempSync(join(tmpdir(), "s03-"));
  try {
    const ruim = join(dir, "ruim.md");
    writeFileSync(ruim, "---\nname: x\n---\n");
    const c = spawnSync(process.execPath, [CLI, "conferir", ruim], { encoding: "utf8" });
    assert.equal(c.status, 1);
    const erros: { caminho: string }[] = JSON.parse(c.stdout).erros;
    assert.deepEqual(erros.find((e) => e.caminho === "colors"), { caminho: "colors", mensagem: "obrigatório" });

    const css = spawnSync(process.execPath, [CLI, "css", ruim], { encoding: "utf8" });
    assert.equal(css.status, 1);
    assert.equal(css.stdout, "");
    assert.match(css.stderr, /"caminho": "colors"/);

    for (const args of [[], ["listar", FIXTURE], ["conferir"]]) {
      const u = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
      assert.equal(u.status, 2, args.join(" "));
      assert.match(u.stderr, /^uso: node identidade\/design-md\.ts conferir\|css/);
    }

    const bom = join(dir, "DESIGN.md");
    writeFileSync(bom, trocar("spacing:\n", 'fonts:\n  - { family: "Crimson Pro", src: "marca/f.woff2", weight: 800 }\n\nspacing:\n'));
    mkdirSync(join(dir, "marca"));
    for (const f of ["marca/logo.svg", "marca/logo-claro.svg", "marca/f.woff2"]) writeFileSync(join(dir, f), "");
    const b = spawnSync(process.execPath, [CLI, "css", bom, "--base", "../projeto/"], { encoding: "utf8" });
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /src: url\("\.\.\/projeto\/marca\/f\.woff2"\) format\("woff2"\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// O subconjunto de YAML: o que ele aceita é YAML 1.2 válido e dá o mesmo valor no PyYAML (YAML 1.1); o resto é erro.
const ACEITOS = [
  "# comentário",
  "a: 1",
  "b: -2.5",
  "c: true",
  "d: ~",
  'e: "x # não é comentário"',
  "f: 'it''s'",
  "g: texto solto # comentário",
  "h:",
  "  i: { j: 1, k: \"a, b\", w: d'água }",
  "  l: [um, \"dois\", 3, d'água]",
  "m:",
  "  - x",
  "  - { n: 1 }",
  "  - it's # x",
  "o: >",
  "  linha um",
  "  linha dois",
  "",
  "  parágrafo",
  "p: |",
  "  literal",
  "  mantém",
  "q: \"aspas \\\"dentro\\\"\"",
  "r: Gota d'água # nota",
  "s: 96px",
  "t: 1.0",
  "u: \"16:9\"",
  "v: 5\" polegadas # nota",
  "x: .5",
  "y: a,'b # c",
].join("\n");
const ESPERADO = {
  a: 1, b: -2.5, c: true, d: null, e: "x # não é comentário", f: "it's", g: "texto solto",
  h: { i: { j: 1, k: "a, b", w: "d'água" }, l: ["um", "dois", 3, "d'água"] },
  m: ["x", { n: 1 }, "it's"],
  o: "linha um linha dois\nparágrafo\n",
  p: "literal\nmantém\n",
  q: 'aspas "dentro"',
  r: "Gota d'água", s: "96px", t: 1, u: "16:9", v: '5" polegadas', x: 0.5, y: "a,'b",
};

test("YAML: mapas, listas, blocos dobrados, comentários e escalares", () => {
  assert.deepEqual(analisarYaml(ACEITOS), ESPERADO);
  assert.deepEqual(analisarYaml("description: Gota d'água # nota"), { description: "Gota d'água" });
  assert.deepEqual(analisarYaml("l:\n  - it's # x"), { l: ["it's"] });
  assert.deepEqual(analisarYaml("avoid: [d'água, x]"), { avoid: ["d'água", "x"] });
});

// PyYAML como segundo leitor, se houver; python3 -I não põe o diretório atual no caminho de importação.
const temPyYaml = spawnSync("python3", ["-I", "-c", "import yaml"]).status === 0;
const lerComPyYaml = (texto: string): unknown => {
  const r = spawnSync("python3", ["-I", "-c", "import sys, json, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))"], { input: texto, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("YAML: o PyYAML lê igual os casos aceitos e o frontmatter da fixture", { skip: !temPyYaml && "PyYAML ausente" }, () => {
  assert.deepEqual(lerComPyYaml(ACEITOS), JSON.parse(JSON.stringify(analisarYaml(ACEITOS))));
  const frontmatter = TEXTO.split("\n---\n")[0].slice(4);
  assert.deepEqual(lerComPyYaml(frontmatter), JSON.parse(JSON.stringify(analisarYaml(frontmatter))));
});

test("YAML: o que fica fora do subconjunto é erro com a linha exata", () => {
  const casos: [string, RegExp, number][] = [
    ["a: &x 1\nb: *x", /âncora/, 1],
    ["a: !!str 1", /tag/, 1],
    ["a:\n\tb: 1", /tabulação/, 2],
    ["a: 1\na: 2", /duplicada/, 2],
    ["a: b: c", /aspas/, 1],
    ["a:\n  - b: 1", /\{ chave: valor \}/, 2],
    ["a: { b: { c: 1 } }", /aninhado/, 1],
    ["a: 1\n---\nb: 2", /vários documentos/, 2],
    ["a: 1\n...", /vários documentos/, 2],
    ["a: 0x1F", /número/, 1],
    ["a: .inf", /número/, 1],
    ["a: |+\n  x", /bloco/, 1],
    ["a: |2\n  x", /bloco/, 1],
    ["a:\n  -", /item de lista/, 2],
    ["a:\n  b: 1\n   c: 2", /recuo/, 3],
    ["a:\n    b: 1\n  c: 2", /recuo/, 3],
    ['a: "abc\\"', /aspas sem fechar/, 1],
    ["a: 'x'''y'", /aspas/, 1],
    ['a: "x" y', /aspas/, 1],
    ["a: , x", /indicador/, 1],
    ["a: ] x", /indicador/, 1],
    ["a: } x", /indicador/, 1],
    ["__proto__: 1", /reservada/, 1],
    ["a: { __proto__: 1 }", /reservada/, 1],
    ["constructor: 1", /reservada/, 1],
  ];
  for (const valor of ["yes", "no", "on", "off", "Yes", "NO", "y", "n"]) casos.push([`a: ${valor}`, /booleano/, 1]);
  for (const valor of ["16:9", "1:30:00", "0700", "-012", "1e3", "2.5E-2", "1_000", "0b101", "2026-10-29", "2026-10-29T10:00:00Z", "-.5", "="]) {
    casos.push([`x: 1\nb: ${valor}`, /ambíguo.*aspas/, 2]);
    casos.push([`l: [${valor}]`, /ambíguo.*aspas/, 1]);
  }
  for (const [texto, padrao, linha] of casos) {
    assert.throws(() => analisarYaml(texto), (e: Error) => {
      assert.match(e.message, new RegExp(`^linha ${linha}: `), texto);
      assert.match(e.message, padrao, texto);
      return true;
    }, texto);
  }
});
