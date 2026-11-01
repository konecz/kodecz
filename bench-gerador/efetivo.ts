// Gerador de casos (P12): o que é «efetivo» em cada classe. Dois casos da mesma classe com os mesmos valores efetivos
// são o mesmo caso (repetição disfarçada) e só um entra. A regra padrão é que todo valor do eixo muda o resultado
// (os eixos de cada classe já foram escolhidos assim no #79); as exceções estão aqui, cada uma com o porquê:
//   juntar  — valores que, nesta classe, dão o mesmo caso; fica o primeiro na ordem do eixo, os outros vão em `equivale`;
//   excluir — valores em que o erro da classe não pode acontecer (não é caso, é cena sem a armadilha).
import { valoresNominais, type Catalogo, type Classe } from "./catalogo.ts";

export type Regra = { classes: string[]; eixo: string; juntar?: string[][]; excluir?: string[]; porque: string };

const LARGURA_LATINA = ["K-DES-04", "K-DES-12", "K-COD-05", "K-DES-14", "K-ACE-03", "K-DES-05", "K-IA-04", "K-ANI-04"];
const DESENHO_DA_FONTE = ["K-DES-13", "K-DES-05", "K-DES-10", "K-IA-04", "K-IA-07", "K-IA-09", "K-COD-12"];
const EMENDA = ["K-EDI-01", "K-EDI-02", "K-EDI-07", "K-EDI-08", "K-EDI-09", "K-EDI-13", "K-ANI-09", "K-COR-04"];

export const REGRAS: Regra[] = [
  { classes: LARGURA_LATINA, eixo: "escrita", juntar: [["português", "inglês"]],
    porque: "português e inglês são escrita latina com espaços e palavras de tamanho parecido: largura e quebra mudam igual; alemão (palavras longas), árabe e japonês mudam de outro jeito" },
  { classes: ["K-ACE-02"], eixo: "escrita", juntar: [["português", "inglês", "alemão (palavras longas)"]],
    porque: "a falta da legenda não depende da largura das palavras; só a direção (árabe) e a escrita sem espaços (japonês) mudam onde e como ela entraria" },
  { classes: ["K-DES-13"], eixo: "escrita", juntar: [["português", "inglês", "alemão (palavras longas)"]],
    porque: "as descidas das letras (g, j, p, q, y) são as mesmas nas três escritas latinas" },
  { classes: ["K-COD-12"], eixo: "escrita", excluir: ["português", "inglês", "alemão (palavras longas)", "japonês (sem espaços)"],
    porque: "o erro é da escrita da direita para a esquerda; sem ela não há o que quebrar" },
  { classes: DESENHO_DA_FONTE, eixo: "fonte", juntar: [["Google Fonts pela rede", "arquivo local"]],
    porque: "a mesma fonte pela rede ou do arquivo tem as mesmas métricas e o mesmo desenho; muda só a entrega, que não é o erro desta classe" },
  { classes: ["K-COD-09"], eixo: "trilha", juntar: [["trilha baixa", "trilha alta"]],
    porque: "o erro é a faixa ficar fora da mistura; o nível dela não muda nada se ela não entra" },
  { classes: ["K-COD-09"], eixo: "midia", juntar: [["imagem", "GIF ou Lottie", "canvas ou 3D"]],
    porque: "só o vídeo traz som próprio; nos outros três o som vem de fora do mesmo jeito" },
  { classes: ["K-COR-05"], eixo: "midia", excluir: ["GIF ou Lottie"], porque: "GIF e Lottie não têm HDR" },
  { classes: ["K-COR-03"], eixo: "fundo", excluir: ["liso"], porque: "fundo liso não tem degradê para dar banding" },
  { classes: ["K-DES-09"], eixo: "fundo", excluir: ["liso", "gradiente"], porque: "o erro é o fundo movimentado; liso e degradê parados não são" },
  { classes: EMENDA, eixo: "cenas", excluir: ["1"], porque: "com uma cena só não há emenda nem corte" },
  { classes: ["K-DES-08", "K-EDI-06", "K-EDI-02"], eixo: "rosto", excluir: ["sem rosto"], porque: "sem rosto não há o que tapar nem o salto do rosto no corte" },
];

/**
 * As classes de verificador «sim» que ficam com um grau só, com o motivo: o erro é binário (acontece ou não) ou o
 * limiar ainda não tem fonte firme. Os três graus (#79, seção 5) só fazem sentido onde há uma medida contínua com limiar.
 */
const SEM_GRAUS_PROVADOS =
  "a especificação não tem os três graus provados: erro binário (acontece ou não) ou sem limiar contínuo com fonte";

export const SEM_GRAU: Record<string, string> = {
  "K-COD-14": "binário: a espera termina ou não",
  "K-COD-09": "binário: a faixa entra na mistura ou não",
  "K-COD-13": "binário: o caminho vale no render ou não",
  "K-FER-02": "binário: a etiqueta de cor está certa ou errada; o tamanho do desvio vem da paleta, que já é eixo",
  "K-PLA-03": "binário por parâmetro: dentro ou fora do perfil da plataforma (o perfil de cada uma ainda sem fonte)",
  "K-DES-07": "o limiar do tamanho mínimo por formato ainda não tem fonte firme",
  "K-COD-01": "binário: a animação é função do quadro ou do relógio",
  "K-COD-02": "binário: o quadro é determinístico ou não",
  "K-COD-03": "binário: a mídia está no quadro ou não",
  "K-COD-04": "binário: a fonte chega ao render ou não",
  "K-COD-16": "binário: a composição está no lugar certo ou não",
  "K-COD-20": "binário: a resolução e o formato são os do destino ou não",
  "K-FER-08": "binário: a conferência acusa ou não",
  "K-FER-09": "binário: a fonte do pacote é entregue ou não",
  "K-FER-11": "binário: o alfa sai ou não",
  "K-FER-12": "binário: as versões casam ou não",
  "K-EDI-14": "binário: o que foi aprovado continua ou não",
  "K-ACE-02": "binário: há legenda ou não",
  "K-COD-12": "binário: o texto sai na direção certa e com as letras ligadas ou não",
  "K-COR-05": "binário: o HDR é convertido para SDR ou não",
  // P15 (2026-11-01): graduadas pelo catálogo no #96 sem os três graus na especificação; o caso de grau não montava.
  "K-COD-05": SEM_GRAUS_PROVADOS,
  "K-COD-06": SEM_GRAUS_PROVADOS,
  "K-COD-10": SEM_GRAUS_PROVADOS,
  "K-COD-19": SEM_GRAUS_PROVADOS,
  "K-FER-03": SEM_GRAUS_PROVADOS,
  "K-FER-04": SEM_GRAUS_PROVADOS,
  "K-FER-06": SEM_GRAUS_PROVADOS,
  "K-EDI-02": SEM_GRAUS_PROVADOS,
  "K-EDI-03": SEM_GRAUS_PROVADOS,
  "K-EDI-06": SEM_GRAUS_PROVADOS,
  "K-EDI-08": SEM_GRAUS_PROVADOS,
  "K-ANI-01": SEM_GRAUS_PROVADOS,
  "K-ANI-02": SEM_GRAUS_PROVADOS,
  "K-ANI-04": SEM_GRAUS_PROVADOS,
  "K-ANI-05": SEM_GRAUS_PROVADOS,
  "K-ANI-08": SEM_GRAUS_PROVADOS,
  "K-ANI-09": SEM_GRAUS_PROVADOS,
  "K-ANI-11": SEM_GRAUS_PROVADOS,
  "K-DES-02": SEM_GRAUS_PROVADOS,
  "K-DES-04": SEM_GRAUS_PROVADOS,
  "K-DES-08": SEM_GRAUS_PROVADOS,
  "K-DES-09": SEM_GRAUS_PROVADOS,
  "K-DES-12": SEM_GRAUS_PROVADOS,
  "K-DES-13": SEM_GRAUS_PROVADOS,
  "K-COR-02": SEM_GRAUS_PROVADOS,
  "K-AUD-06": SEM_GRAUS_PROVADOS,
  "K-AUD-07": SEM_GRAUS_PROVADOS,
  "K-ACE-05": SEM_GRAUS_PROVADOS,
  "K-PLA-02": SEM_GRAUS_PROVADOS,
};

export type Efetivo = { valor: string; equivale: string[] };

/** As regras que valem para (classe, eixo), já conferidas. */
function regrasDe(classe: string, eixo: string) {
  return REGRAS.filter((r) => r.eixo === eixo && r.classes.includes(classe));
}

/** Os valores efetivos de um eixo na classe, na ordem do eixo: o representante de cada grupo e quem ele representa. */
export function valoresEfetivos(cat: Catalogo, c: Pick<Classe, "id" | "tipos">, eixo: string): Efetivo[] {
  const nominais = valoresNominais(cat, c, eixo);
  const regras = regrasDe(c.id, eixo);
  const excluidos = new Set(regras.flatMap((r) => r.excluir ?? []));
  const grupos = regras.flatMap((r) => r.juntar ?? []);
  const grupoDe = (v: string) => grupos.find((g) => g.includes(v));
  const r: Efetivo[] = [];
  const vistos = new Set<string>();
  for (const v of nominais) {
    if (excluidos.has(v) || vistos.has(v)) continue;
    const g = grupoDe(v);
    const membros = g ? nominais.filter((x) => g.includes(x) && !excluidos.has(x)) : [v];
    membros.forEach((m) => vistos.add(m));
    r.push({ valor: membros[0], equivale: membros.slice(1) });
  }
  return r;
}

/** O valor efetivo de um valor nominal (o representante), ou null se ele está excluído na classe. */
export function efetivo(cat: Catalogo, c: Pick<Classe, "id" | "tipos">, eixo: string, valor: string): string | null {
  for (const e of valoresEfetivos(cat, c, eixo)) if (e.valor === valor || e.equivale.includes(valor)) return e.valor;
  return null;
}

/** Problemas nas regras: classe, eixo ou valor que não existe, grupo repetido, eixo que a classe não tem. */
export function conferirRegras(cat: Catalogo): string[] {
  const problemas: string[] = [];
  const porId = new Map(cat.classes.map((c) => [c.id, c]));
  for (const r of REGRAS) {
    if (!r.porque) problemas.push(`regra sem porquê: ${r.eixo} ${r.classes.join(",")}`);
    for (const id of r.classes) {
      const c = porId.get(id);
      if (!c) { problemas.push(`classe desconhecida: ${id}`); continue; }
      if (!c.eixos.includes(r.eixo)) { problemas.push(`${id} não tem o eixo ${r.eixo}`); continue; }
      const nominais = valoresNominais(cat, c, r.eixo);
      for (const v of [...(r.juntar ?? []).flat(), ...(r.excluir ?? [])])
        if (!nominais.includes(v)) problemas.push(`${id}: ${r.eixo} não tem o valor «${v}»`);
    }
  }
  for (const c of cat.classes) for (const e of c.eixos) {
    const vs = regrasDe(c.id, e).flatMap((r) => r.juntar ?? []).flat();
    if (new Set(vs).size !== vs.length) problemas.push(`${c.id}: valor em dois grupos no eixo ${e}`);
    if (valoresEfetivos(cat, c, e).length === 0) problemas.push(`${c.id}: o eixo ${e} ficou sem valor`);
  }
  for (const id of Object.keys(SEM_GRAU)) {
    const c = porId.get(id);
    if (!c) problemas.push(`SEM_GRAU: classe desconhecida ${id}`);
    else if (c.verificador !== "sim") problemas.push(`SEM_GRAU: ${id} não tem verificador «sim»`);
  }
  return problemas;
}
