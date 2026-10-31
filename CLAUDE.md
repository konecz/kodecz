# CLAUDE.md — kodecz

O Kodecz é o motor de vídeo por código da Konecz em **código aberto** (Apache-2.0): a página web vira vídeo
renderizado na placa da NVIDIA, sem a «foto» de cada quadro passar pela CPU. Ele nasce do `sistemas/motor-video`
(privado), que fica como arquivo e histórico. O repositório é **privado até a abertura** (decisão do responsável,
2026-10-31); o que falta para abrir está em `docs/estado-atual.md`.

## Regras

- **Nada de cliente aqui**: nem vídeo, áudio, roteiro ou nome de cliente, nem caminho do servidor da Konecz. Antes de
  cada commit, conferir o diff.
- **Nada do Remotion**: nenhuma dependência e nenhum código derivado dele (a licença do Remotion não é aberta). As
  comparações com ele ficam só como números em `docs/medidas.md`.
- Número publicado só com a medida registrada em `docs/medidas.md`.
- Código, README e docs públicos em inglês; `LEIAME.md` e os docs internos (`docs/estado-atual.md`, `docs/marca.md`)
  em português.
- Marca: `marca/` sai inteira de `node scripts/marca.mjs`; ver `docs/marca.md`.
- Git: o mesmo processo do motor-video (uma tarefa, uma branch, PR, squash). Sem merge, push na `main` nem PR sem
  autorização. Conventional Commits em português.
