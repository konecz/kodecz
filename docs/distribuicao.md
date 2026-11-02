# Distribuição para agentes

> Doc interno. O que fica pronto no repositório para os agentes acharem e instalarem o Kodecz, e o texto exato de
> cada envio externo. **Nada daqui foi enviado:** o responsável envia depois que a interface em inglês
> (`kodecz render|preview|check`) estiver na `main`. Regras de cada lista conferidas em 2026-11-02.

## O que está no repositório

| Peça | Onde | Como instala |
|---|---|---|
| Skills (formato aberto Agent Skills) | `skills/kodecz`, `skills/remotion-to-kodecz`, `skills/hyperframes-to-kodecz` | `npx skills add konecz/kodecz` (Codex, Cursor, Gemini CLI, Copilot, Claude Code...) |
| Plugin do Claude Code | `.claude-plugin/plugin.json` (a raiz do repositório é o plugin) e `.claude-plugin/marketplace.json` | `/plugin install kodecz --marketplace konecz/kodecz` |
| Servidor MCP | `mcp/kodecz-mcp.mjs` (sem dependência), pacote npm `kodecz-mcp` | o plugin já liga; fora dele, `npx -y kodecz-mcp` |
| Entrada do registro MCP | `server.json` (`io.github.konecz/kodecz`) | `mcp-publisher publish` |

A skill `pr` do próprio repositório (`.claude/skills/pr`) tem `metadata.internal: true` e fica fora do
`npx skills add`. O validador do plugin dá um aviso que fica: «CLAUDE.md at the plugin root is not loaded» (o
`CLAUDE.md` é de quem trabalha no repositório, não do plugin).

## Ordem dos envios

1. **Antes de tudo:** a interface em inglês e este PR na `main`. Conferir que os nomes usados nas skills e no MCP
   (`kodecz render|preview|check`, `--frame`, `--from`, `--frames`, `--alpha`, `--cpu`, `--hevc`, `id="kodecz"`,
   `width`, `height`, `fps`, `frames`, `window.kodecz_frame`) são os que o comando aceita; corrigir o que mudou.
2. **npm:** `cd mcp && npm publish --access public` (conta npm da Konecz; o nome `kodecz-mcp` estava livre em
   2026-11-02, conferir de novo). A versão do `mcp/package.json` e do `server.json` têm de ser iguais
   (`scripts/agentes.test.mjs` confere).
3. **Registro oficial do MCP** (abaixo). Precisa do pacote no npm.
4. **skills.sh:** não tem envio (abaixo).
5. **Listas** (awesome-mcp-servers, awesome-video) já podem; **awesome-claude-code** a partir de **2026-11-14**
   (14 dias do primeiro commit, de 2026-10-31); as listas de skills pedem estrelas e uso (abaixo).

A cada versão nova do plugin, subir o `version` do `.claude-plugin/plugin.json` (sem isso, quem instalou não recebe
a atualização).

---

## Registro oficial do MCP (registry.modelcontextprotocol.io)

Regras (quickstart do registro): o nome tem de começar com `io.github.<usuário>/` quando o login é pelo GitHub (a
conta `konecz` é de usuário, então `io.github.konecz/kodecz` vale); o pacote npm tem de ter `mcpName` igual ao
`name` do `server.json` (já tem); `description` com até 100 caracteres (tem 88). O `server.json` foi validado
contra o esquema `2025-12-11`.

```bash
# instalar o mcp-publisher (binário da página de releases de modelcontextprotocol/registry)
mcp-publisher login github      # entra como konecz
mcp-publisher publish           # na raiz do repositório, lê o server.json
```

Depois: `curl "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.konecz/kodecz"`.

## skills.sh

Não há formulário. O ranking sai da telemetria anônima do `npx skills`: a skill aparece quando alguém instala.
Conferir antes: `npx skills add konecz/kodecz --list` mostra `kodecz`, `remotion-to-kodecz` e
`hyperframes-to-kodecz` (e não a `pr`). Depois da primeira instalação, a página fica em
`https://skills.sh/konecz/kodecz`. Há auditoria de segurança periódica das skills listadas.

## Diretório da Anthropic (claude.ai/directory) — opcional

Envio pelo portal `claude.ai/directory/manage`, com plano pago do claude.ai. Antes, `claude plugin validate
--strict .` (hoje falha só pelo aviso do `CLAUDE.md` na raiz; o portal tem regras próprias). O plugin já tem
`icon`, `documentationUrl` e `supportUrl`. Atenção: o servidor MCP precisa do Kodecz instalado na máquina (Linux),
então no claude.ai e no Cowork só as skills servem.

## awesome-claude-code (hesreallyhim/awesome-claude-code)

Regras do `CONTRIBUTING.md`: recurso com **14 dias ou mais** desde o primeiro commit e desenvolvimento ativo, **ou**
100 estrelas; um recurso por vez; **só pelo formulário da web** (não abrir PR; não dá pelo `gh`); a recomendação
**tem de ser feita por uma pessoa**, não por agente; descrição descritiva, sem propaganda, sem falar com o leitor,
uma linha, sem emoji; 10 a 500 caracteres. Liberado a partir de **2026-11-14**.

Formulário: <https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml>

| Campo | Valor |
|---|---|
| Display Name | `Kodecz` |
| Category | `Creative Media` |
| Link | `https://github.com/konecz/kodecz` |
| Author Name | `konecz` |
| Author Link | `https://github.com/konecz` |
| Description | `Claude Code plugin and skills for Kodecz, an Apache-2.0 engine that renders a web page into an MP4 on an NVIDIA GPU or a CPU. The skills teach a write, preview, check and render loop, with frame previews as PNG and automatic checks of every frame, and port Remotion and HyperFrames projects with one-to-one API mappings. Includes an MCP server with render, preview and check tools.` |

Os cinco primeiros itens da lista de conferência são para marcar de verdade (o responsável olha a lista antes); o
último fica desmarcado (é a pegadinha do formulário).

## awesome-mcp-servers (punkpeye/awesome-mcp-servers)

Regras do `CONTRIBUTING.md`: só servidor com repositório público no GitHub que a pessoa instala e roda (é o caso);
fork, branch, editar o `README.md`, PR; uma linha por servidor; ordem alfabética dentro da categoria. Legenda do
README: 📇 TypeScript/JavaScript, 🏠 serviço local, 🐧 Linux. O selo da Glama é opcional (a Glama indexa sozinha a
partir do GitHub). Um agente pode abrir o PR com `🤖🤖🤖` no fim do título (via rápida), mas o envio é do
responsável.

- **Categoria:** `🎥 Multimedia Process`.
- **Posição:** entre `keiver/image-tiler-mcp-server` e `korovin-aa97/talkthrough-mcp` (ordem alfabética).
- **Linha:**

```markdown
- [konecz/kodecz](https://github.com/konecz/kodecz) 📇 🏠 🐧 - Render, preview and check videos written as web pages: HTML, CSS and JS to MP4 on an NVIDIA GPU (NVENC) or any CPU, with frames returned as images and automatic checks of every frame.
```

- **Título do PR:** `Add konecz/kodecz (video rendering from web pages)`
- **Corpo do PR:**

```markdown
Adds Kodecz to Multimedia Process.

Kodecz is an Apache-2.0 engine that renders a web page into an MP4 on an NVIDIA GPU (NVENC) or on any CPU (x264).
Its MCP server (`mcp/`, npm `kodecz-mcp`, registry `io.github.konecz/kodecz`) exposes three tools: `render`,
`preview` (frames come back as PNG images) and `check` (automatic checks of every frame, as JSON). Local, stdio,
Linux.
```

## awesome-video (krzemienski/awesome-video)

Regras do `CONTRIBUTING.md`: pelo site <https://awesome.video> («Submit Resource») ou por PR que edita o
**`contents.json`** (não o `README.md`, que é gerado); categoria que já existe; descrição de 1 a 2 frases,
terminando em ponto; sem propaganda; projeto mantido. O Remotion está na categoria `media-tools`.

Entrada no fim do array `projects`:

```json
{
  "title": "Kodecz",
  "description": "Open-source engine that renders a web page (HTML, CSS, JavaScript, WebGL) into an MP4 frame by frame, on an NVIDIA GPU with NVENC or on any CPU with x264, without a screenshot per frame.",
  "homepage": "https://github.com/konecz/kodecz",
  "category": ["media-tools"],
  "tags": ["video-generation", "programmatic-video", "html", "nvenc", "gpu", "mp4-export"]
}
```

- **Título do PR:** `Add Kodecz (programmatic video from web pages)`

## Listas de skills

**VoltAgent/awesome-agent-skills** (`CONTRIBUTING.md`): só skill com uso real da comunidade («brand new skills
that were just created are not accepted»); descrição com **10 palavras ou menos**; prefixo autor/nome; título do
PR `Add skill: author/skill-name`; linha no fim da subcategoria. O HyperFrames está em Community Skills →
Marketing. Enviar quando houver instalações no skills.sh e estrelas.

```markdown
- **[konecz/kodecz](https://github.com/konecz/kodecz/tree/main/skills/kodecz)** - Write, preview, check and render web-page videos on GPU
```

**heilcheng/awesome-agent-skills** (`CONTRIBUTING.md` e `AGENTS.md` de lá): repositório com `SKILL.md`, **20
estrelas ou mais**, mais de 14 dias, uma linha no fim da categoria, descrição com menos de 100 caracteres, só PR
(issue não é lida). Categoria: Community Skills → **Creative and Media**.

```markdown
- [konecz/kodecz](https://github.com/konecz/kodecz) - Make videos as web pages: write, preview, check, render; port Remotion and HyperFrames
```

## Smithery — não dá

A Smithery desligou em **2026-10-31** as contas, a API, a CLI e a publicação; o site ficou só como diretório
público de servidores verificados escolhidos por eles (aviso em smithery.ai, «Smithery is now part of Arcade»).
Não há envio. Se o diretório reabrir, o `server.json` e o pacote npm servem de base.

## Listas de Remotion

Não existe lista «awesome» de Remotion mantida (busca no GitHub em 2026-11-02). A página de recursos da
documentação do Remotion é deles e não é lugar para um concorrente. O caminho para quem usa Remotion é a skill
`remotion-to-kodecz` (no skills.sh, buscável por «remotion») e o awesome-video, onde o Remotion já está.
