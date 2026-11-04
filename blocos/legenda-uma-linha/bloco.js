// legenda-uma-linha (H01): publica a fala da página em window.motor_falas (formato do S04,
// docs/formatos/conferencia.md) a partir das palavras da legenda: texto da <span> (ou o data-t, com a vírgula que a tela
// tira), início e fim em segundos
// (--inicio e --fim ÷ --fps, ou o antigo --qps), bloco = número da frase. Só lê o DOM na carga; nada de relógio (R03). Incluir depois
// das legendas, uma vez por página; se a página já publicou a fala, não mexe.
if (!window.motor_falas) {
  const raiz = getComputedStyle(document.documentElement);
  const qps = Number(raiz.getPropertyValue('--fps').trim() || raiz.getPropertyValue('--qps'));
  const falas = [];
  document.querySelectorAll('.kz-legenda').forEach((frase, k) => {
    for (const p of frase.querySelectorAll('.kz-palavra')) {
      const e = getComputedStyle(p);
      falas.push({ t: (p.dataset.t ?? p.textContent).trim(), ini: Number(e.getPropertyValue('--inicio')) / qps,
        fim: Number(e.getPropertyValue('--fim')) / qps, bloco: k + 1 });
    }
  });
  window.motor_falas = falas.sort((a, b) => a.ini - b.ini);
}
