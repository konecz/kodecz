# Instalação (P03)

Numa máquina Linux com placa NVIDIA (ou sem placa, só o modo CPU), na raiz do repositório:

```sh
./instalar.sh              # confere o sistema, instala o motor sem sudo e renderiza a composição de verificação
./instalar.sh --sistema    # o mesmo, instalando antes os pacotes do apt que faltam (pede sudo)
./instalar.sh --verificar  # só confere e diz o que falta (não instala nem renderiza)
./instalar.sh --sem-render # instala sem o render de verificação
```

Saída 0 é «pronto»; 1 traz a lista do que falta, cada item com o comando exato. Rodar de novo não refaz o que está
certo: cada etapa grava o hash do que fez (`package-lock.json`, o CEF achatado e o host, binário do Electron, fontes do
nativo e o `nativo.node`) e confere antes. Os logs longos (npm, cargo) ficam em `tmp/logs/instalar/`.

## O que pede sudo (só com `--sistema`, ou à mão)

- Pacotes do apt: ffmpeg (o do sistema), weston, bubblewrap, binutils (o `strip` do CEF), fontconfig e uma
  fonte, as bibliotecas que o Electron carrega, `build-essential`, `cmake` e `ninja-build` (o host do CEF é compilado
  aqui, com ou sem placa) e `libvulkan1` (só com placa). O instalador imprime a
  linha `sudo apt-get install -y …` com o que falta; como root (contêiner), sem o `sudo`.
- Fora do `--sistema`, por serem de risco: o driver da NVIDIA (≥ 570: o primeiro com a RTX 50 e com o Video Codec SDK 13)
  e o `chrome-sandbox` com SUID (aviso: o render ainda usa `--no-sandbox`; `docs/adr.md`, seção 3). O
  instalador só diz o comando.
- O namespace de usuário do bwrap (o modo CPU esconde a placa com ele): no Ubuntu 24.04+ vem do perfil
  `bwrap-userns-restrict` do AppArmor, que o pacote `apparmor-profiles` do 24.04 só põe em
  `/usr/share/apparmor/extra-profiles/` (copiar para `/etc/apparmor.d/` e carregar com `apparmor_parser -r`; o 26.04
  já traz carregado); em contêiner, de `--cap-add SYS_ADMIN --security-opt seccomp=unconfined
  --security-opt apparmor=unconfined` (com `kernel.apparmor_restrict_unprivileged_userns=1` no hospedeiro, o namespace de
  usuário falha mesmo sem o seccomp; com o `CAP_SYS_ADMIN`, o bwrap do root cria só o de montagem). Sem ele o modo CPU
  não cai: cada render testa o bwrap e, barrado, roda sem esconder a placa (o desenho continua por software). O
  instalador só avisa, com o comando, quando há placa para esconder.
- Fora do Debian/Ubuntu (sem `apt-get`): o instalador diz o que falta com os nomes dos pacotes do Debian e o
  `--sistema` recusa; instalar os equivalentes da distribuição à mão.

## O que faz sem sudo

1. Node 24 (o `instalar.sh` confere; sem ele, diz o comando do nvm) e Rust ≥ 1.85 (sem ele, o comando do rustup, que
   instala em `~/.cargo`).
2. `npm ci --ignore-scripts` nas pastas com `package-lock.json` (captura, conferência); o único install
   script que importa, o do Electron (`install.js`), roda à parte.
3. Navegadores da captura (`instalar/navegador.ts`):
   - **CEF 156.0.14, a captura do render (P02):** `captura/cef/preparar-cef.sh` baixa o pacote mínimo de
     `cef-builds.spotifycdn.com`, confere o SHA-1 publicado no índice e o achata em `~/.cache/motor-video/cef/156.0.14/rs`
     (ou em `MOTOR_CACHE`); `captura/cef/montar.sh` compila o host (`cargo build --release --locked`; com as `.so.1`
     do driver, pelos mesmos links do nativo). Refaz se as fontes do host ou do núcleo do `nativo/` mudarem. Sem as
     `.so` do driver (P14), monta o host sem a feature `placa` (`montar.sh --no-default-features`): sem o núcleo do M02,
     que liga no NVENC e no NVDEC, só com o modo CPU. Com elas, monta com a placa mesmo se ela não servir agora (driver
     novo antes do reboot). Refaz também se a máquina ganhar ou perder o driver.
   - **Electron 45.1.0 sem remendo, da conferência:** baixado pelo `install.js` (a conferência S04 e o teste que toca o
     MP4 no navegador, que precisam do H.264 na página; o CEF pronto não tem). O remendado saiu com a entrada do Remotion (`docs/adr.md`,
     seção 16).
4. Módulo nativo: `cargo build --release --locked` e a cópia para `nativo.node`. Liga nas `.so.1` do driver por links
   próprios em `target/ligacao-nvidia/`, então não precisa do pacote de desenvolvimento do NVENC. Sem placa, pulado.
5. Conferência: `conferencia/preparar.ts` (modelo de rosto e retrato de teste, por SHA-256, em `~/.cache/motor-video/`).
6. Sonda da placa (Vulkan e NVENC abrem) e render da `cli/fixtures/linha-sintetica` (60 quadros) na CPU e duas vezes na
   placa, iguais quadro a quadro (R03).

## Prova sem driver NVIDIA (P14)

`instalar/sem-nvidia.sh` repete a instalação num contêiner limpo (`node:24-trixie-slim`, sem CDI, sem `/dev/nvidia*`,
sem as `.so` do driver, com o `/sys/module/nvidia` e os render nodes do hospedeiro cobertos): `./instalar.sh --sistema`, o
rustup que ele pede, `./instalar.sh` até «pronto», o render da linha sintética com `--cpu`, conferindo N nas três
tarjas de cada um dos 60 quadros, a recusa do `--placa` (saída 3) e os testes do protocolo do host sem a feature `placa`.
Precisa do docker e da rede; leva de 5 a 15 min. O contêiner roda com `--cap-add SYS_ADMIN` e o seccomp e o AppArmor
soltos (o bwrap do modo CPU): servem para esta prova local, não como padrão.

```sh
flock -s /tmp/motor-video-placa.lock instalar/sem-nvidia.sh              # do zero (baixa o CEF, 332 MB)
flock -s /tmp/motor-video-placa.lock instalar/sem-nvidia.sh --cache-cef  # com o CEF achatado desta máquina (só leitura)
```

A última linha é `P14: ok` ou `P14: falhou em <etapa>`; o log, as saídas do instalador e do render, o MP4 e o framemd5
ficam em `tmp/sem-nvidia/`.

Fontes do Google: o instalador não enche mais o cache (era só para as composições sintéticas do Remotion). As de cada
composição são dela (R01): o primeiro render dela baixa as que faltarem para o cache (`~/.cache/motor-video/fontes/`),
sozinho (precisa de rede só nessa vez).

## Decisões

- **Entrada em shell mínimo + TypeScript:** o `instalar.sh` só existe para dizer o que fazer quando o Node 24 falta; o
  resto é TypeScript no Node 24, como o comando e o serviço, e testável com o ambiente injetado
  (`instalar/instalar.test.ts`).
- **O nativo é compilado na máquina, não baixado:** enquanto o produto é o serviço no nosso servidor, um binário
  pré-compilado pediria um lugar privado para publicá-lo e a mesma versão de driver e glibc; o Rust instala sem sudo.
  A distribuição de binários ainda não está decidida.
- **Caminhos num lugar só:** `instalar/caminhos.ts`, derivado do `CAMINHOS` do `cli/regras.ts`. Quando o P04 levar o
  código para `captura/`, `composicao/` e `nativo/`, o ajuste é ali.
