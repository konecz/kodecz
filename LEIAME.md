<picture>
  <source media="(prefers-color-scheme: dark)" srcset="marca/logo-nome-animada-escuro.svg">
  <img alt="Kodecz" src="marca/logo-nome-animada-claro.svg" width="360">
</picture>

# Kodecz

**O vídeo escrito como página web, renderizado direto na placa de vídeo.**

O Kodecz é o motor de vídeo por código da [Konecz](https://konecz.com). O vídeo é uma pasta com um `index.html`:
CSS, JS, React, WebGL, GSAP, Lottie, tudo o que o Chromium desenha. O Kodecz põe a página no quadro *N*, o Chromium
desenha numa textura da placa, e a textura vai direto ao codificador da NVIDIA, sem a «foto» de cada quadro passar
pela CPU.

- **10× menos CPU e 3× mais rápido** que o Remotion no mesmo vídeo (1080p, 150 quadros, RTX 5090;
  [`docs/medidas.md`](docs/medidas.md)).
- **Determinístico:** o quadro *N* sai sempre igual, em ordem, fora de ordem ou começando do meio.
- **Feito para a IA escrever:** cada técnica de edição é um bloco Kodecz documentado e testável, e a conferência
  automática olha os quadros e diz onde está o erro.

O README completo, com o passo a passo, está em inglês: [`README.md`](README.md).

Licença [Apache-2.0](LICENSE). Feito pela [Konecz](https://konecz.com), AI Factory.
