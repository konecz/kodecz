// grafico-linha (H12): monta, uma vez na carga, o SVG de cada .kz-linha a partir de data-valores e data-maximo (só
// geometria, do tamanho da figura no layout; nada de relógio, R03), e a contagem do número por element.animate(), com
// o tempo em quadros convertido como o motor converte (q × 1000 / qps). O traço e os pontos andam pelo bloco.css.
// Incluir depois das figuras, uma vez por página.
// Por que o número não é @keyframes com var(): a animação do CSS nasce quando o estilo é calculado, e uma var() posta
// depois pelo script nem sempre entra nela (o número ficava em 0 de vez em quando).
for (const fig of document.querySelectorAll('.kz-linha:not([data-montado])')) {
  const v = fig.dataset.valores.trim().split(/\s+/).map(Number), max = Number(fig.dataset.maximo);
  const estilo = getComputedStyle(fig), num = (nome, padrao) => Number(estilo.getPropertyValue(nome).trim() || padrao);
  const qps = num('--qps'), inicio = num('--inicio'), duracao = num('--duracao', 45);
  const L = fig.offsetWidth, A = fig.offsetHeight, svg = fig.querySelector('svg');
  const pts = v.map((y, k) => [k / (v.length - 1) * L, A - y / max * A]);
  svg.setAttribute('viewBox', `0 0 ${L} ${A}`);
  fig.querySelector('.kz-linha-traco').setAttribute('points', pts.map((p) => p.join(',')).join(' '));
  fig.style.setProperty('--pontos', v.length - 1);
  pts.forEach(([x, y], k) => svg.insertAdjacentHTML('beforeend',
    `<circle class="kz-linha-ponto" cx="${x}" cy="${y}" r="12" style="--ordem: ${k}"></circle>`));
  const numero = fig.querySelector('.kz-linha-num');
  numero.dataset.valor = v[v.length - 1];
  numero.animate([{ '--kz-valor': v[0] }, { '--kz-valor': v[v.length - 1] }],
    { delay: inicio * 1000 / qps, duration: duracao * 1000 / qps, fill: 'both' });
  fig.dataset.montado = '';
}
