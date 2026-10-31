<picture>
  <source media="(prefers-color-scheme: dark)" srcset="marca/logo-nome-animada-escuro.svg">
  <img alt="Kodecz" src="marca/logo-nome-animada-claro.svg" width="360">
</picture>

# Kodecz

**O vídeo escrito como página web, renderizado na placa da NVIDIA ou em qualquer CPU.**

O Kodecz é o motor de vídeo por código da [Konecz](https://konecz.com). O vídeo é uma pasta com um `index.html`:
CSS, JS, React, WebGL, GSAP, Lottie, tudo o que o Chromium desenha. O Kodecz põe a página no quadro *N*, o Chromium
desenha o quadro e ele vai direto ao codificador, sem a «foto» de cada quadro no meio:

- **com placa da NVIDIA**, o quadro fica numa textura da placa e vai direto ao NVENC, e a CPU fica livre;
- **sem placa** (notebook, CI, servidor sem GPU), o quadro cru que o Chromium pintou vai direto ao x264, sem PNG.

A mesma pasta renderiza nos dois.

- **10× menos CPU e 3× mais rápido** que o Remotion no mesmo vídeo (1080p, 150 quadros, RTX 5090;
  [`docs/medidas.md`](docs/medidas.md)).
- **Determinístico:** o quadro *N* sai sempre igual, em ordem, fora de ordem ou começando do meio.
- **Feito para qualquer agente de IA**, sem amarra a um fornecedor: o formato é web comum, cada técnica de edição é
  um bloco Kodecz em Markdown, documentado e testável, e a conferência automática olha os quadros e devolve em JSON
  onde está o erro.

O README completo, com o passo a passo, está em inglês: [`README.md`](README.md).

Criado por **Pedro Henrique Lahr** e **Vanessa Cristine**, pela [Konecz](https://konecz.com), AI Factory. Licença [Apache-2.0](LICENSE).
