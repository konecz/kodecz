//! Protocolo entre o controlador (TypeScript, `captura/cef/host.ts`) e o host do CEF, em linhas JSON.
//!
//! Três canais:
//! - **comandos** (stdin do host): o que pode esperar a resposta por evento (abrir a janela, carregar, CDP, responder
//!   a um pedido de rede, sair);
//! - **eventos** (stdout do host, um fd próprio; o stdout dos processos do Chromium vai para o stderr): pronto,
//!   janela, carregou, CDP, console, paint, pedido de rede, navegação, popup;
//! - **operações síncronas** (FIFO de pedidos e FIFO de respostas): o que o controlador espera sem voltar ao laço do
//!   Node, como o `quadroMarcado` do módulo nativo dentro do evento `paint` do Electron (`motor`, `marcado`,
//!   `repetir`, `fechar`) e as decisões que seguram a thread de UI do CEF (`liberar` o paint, `navegar`).
//!
//! Só funções puras aqui, testadas sem placa nem CEF.

#[cfg(feature = "placa")]
use crate::nucleo::{Montagem, Opcoes, Resumo, VideoMontado, VideoNaPlaca};
use serde_json::{Map, Value, json};

/// Comando do controlador (stdin).
#[derive(Debug, PartialEq)]
pub enum Comando {
    /// Cria o navegador fora da tela em about:blank. `textura`: shared texture (placa); sem ela, `OnPaint` na CPU.
    /// `batida_externa` (P13, experimento; `batidaExterna` no JSON, padrão falso): o compositor só faz um quadro
    /// quando o controlador manda `batida`, em vez das batidas do `qps` por segundo.
    Janela { largura: u32, altura: u32, transparente: bool, qps: u32, textura: bool, batida_externa: bool },
    Carregar { url: String },
    /// Mensagem do CDP já serializada (`{"id":…,"method":…,"params":…}`), enviada sem mexer.
    Cdp { mensagem: String },
    Tamanho { largura: u32, altura: u32 },
    Qps { valor: u32 },
    /// Uma batida de quadro no compositor (`SendExternalBeginFrame`), só na janela com `batida_externa`.
    Batida,
    PararDePintar,
    /// Fecha o navegador de agora sem encerrar o host (a janela de aquecimento da reserva quente).
    FecharJanela,
    /// Resposta a um evento `pedido` (rede): continuar, cancelar ou responder com o corpo de um arquivo.
    Pedido { id: u64, acao: AcaoDoPedido },
    Sair,
    /// O `executeJavaScript` do Electron: o código no quadro principal (`url` nula) ou no iframe dessa URL, pelo
    /// renderer (mensagem de processo, sem o CDP). A resposta é o evento `avaliado`.
    Avaliar { id: u64, codigo: String, url: Option<String> },
}

#[derive(Debug, PartialEq)]
pub enum AcaoDoPedido {
    Continuar,
    Cancelar,
    Responder { status: i32, tipo: String, cabecalhos: Vec<(String, String)>, corpo: String },
}

/// Operação síncrona (FIFO de pedidos). `motor`, `marcado`, `repetir` e `fechar` têm resposta; `liberar` e
/// `navegar` só soltam a thread de UI. S08: `abrirVideo` e `montar` têm resposta.
pub enum Op {
    #[cfg(feature = "placa")]
    Motor(Opcoes),
    Marcado { id: u64, alvo: u32, conferir: bool },
    Liberar { id: u64 },
    Navegar { id: u64, permitir: bool },
    #[cfg(feature = "placa")]
    Repetir,
    #[cfg(feature = "placa")]
    Fechar,
    /// S08: abrir um vídeo no NVDEC do núcleo; responde o número dele.
    #[cfg(feature = "placa")]
    AbrirVideo(VideoNaPlaca),
    /// S08: a montagem dos próximos quadros (fundo e vídeo por baixo da página); nada = sem montagem.
    #[cfg(feature = "placa")]
    Montar(Option<Montagem>),
    /// P14: host montado sem a feature `placa`: uma operação do núcleo (`motor`, `repetir`, `fechar`, `abrirVideo`,
    /// `montar`), respondida com o erro `SEM_PLACA`.
    #[cfg(not(feature = "placa"))]
    SoNaPlaca,
}

/// P14: a resposta do host sem a feature `placa` a uma operação do modo placa (e ao `marcado` de um paint da textura).
/// O controlador a recebe no `new Motor(...)`, antes do primeiro quadro.
#[cfg(not(feature = "placa"))]
pub const SEM_PLACA: &str = "este host do CEF foi montado sem a placa (máquina sem driver NVIDIA: captura/cef/montar.sh \
--no-default-features), só com o modo CPU. Use --cpu; para o modo placa, instale o driver NVIDIA (≥ 570) e rode ./instalar.sh \
de novo, que remonta o host com a placa";

fn objeto(linha: &str) -> Result<Map<String, Value>, String> {
    match serde_json::from_str::<Value>(linha) {
        Ok(Value::Object(o)) => Ok(o),
        Ok(_) => Err(format!("linha não é um objeto JSON: {linha}")),
        Err(e) => Err(format!("JSON inválido ({e}): {linha}")),
    }
}

fn texto(o: &Map<String, Value>, campo: &str) -> Result<String, String> {
    o.get(campo).and_then(Value::as_str).map(str::to_owned).ok_or_else(|| format!("falta o texto «{campo}»"))
}

fn inteiro(o: &Map<String, Value>, campo: &str) -> Result<u64, String> {
    o.get(campo).and_then(Value::as_u64).ok_or_else(|| format!("falta o inteiro «{campo}»"))
}

fn u32_de(o: &Map<String, Value>, campo: &str) -> Result<u32, String> {
    let n = inteiro(o, campo)?;
    u32::try_from(n).map_err(|_| format!("«{campo}» grande demais: {n}"))
}

#[cfg(feature = "placa")]
fn u32_opcional(o: &Map<String, Value>, campo: &str) -> Result<Option<u32>, String> {
    match o.get(campo) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => u32_de(o, campo).map(Some),
    }
}

fn logico(o: &Map<String, Value>, campo: &str) -> Result<bool, String> {
    o.get(campo).and_then(Value::as_bool).ok_or_else(|| format!("falta o lógico «{campo}»"))
}

impl Comando {
    pub fn de(linha: &str) -> Result<Comando, String> {
        let o = objeto(linha)?;
        let cmd = texto(&o, "cmd")?;
        Ok(match cmd.as_str() {
            "janela" => Comando::Janela {
                largura: u32_de(&o, "largura")?,
                altura: u32_de(&o, "altura")?,
                transparente: logico(&o, "transparente")?,
                qps: u32_de(&o, "qps")?,
                textura: logico(&o, "textura")?,
                batida_externa: match o.get("batidaExterna") {
                    None | Some(Value::Null) => false,
                    Some(_) => logico(&o, "batidaExterna")?,
                },
            },
            "carregar" => Comando::Carregar { url: texto(&o, "url")? },
            "cdp" => match o.get("mensagem") {
                Some(m @ Value::Object(_)) => Comando::Cdp { mensagem: m.to_string() },
                _ => return Err("cdp sem «mensagem» (objeto)".into()),
            },
            "tamanho" => Comando::Tamanho { largura: u32_de(&o, "largura")?, altura: u32_de(&o, "altura")? },
            "qps" => Comando::Qps { valor: u32_de(&o, "valor")? },
            "batida" => Comando::Batida,
            "parar" => Comando::PararDePintar,
            "fecharJanela" => Comando::FecharJanela,
            "pedido" => {
                let id = inteiro(&o, "id")?;
                let acao = match texto(&o, "acao")?.as_str() {
                    "continuar" => AcaoDoPedido::Continuar,
                    "cancelar" => AcaoDoPedido::Cancelar,
                    "responder" => {
                        let mut cabecalhos = Vec::new();
                        if let Some(Value::Object(c)) = o.get("cabecalhos") {
                            for (k, v) in c {
                                let v = v.as_str().ok_or_else(|| format!("cabeçalho «{k}» não é texto"))?;
                                cabecalhos.push((k.clone(), v.to_owned()));
                            }
                        }
                        let status = inteiro(&o, "status")?;
                        AcaoDoPedido::Responder {
                            status: i32::try_from(status).map_err(|_| format!("status inválido: {status}"))?,
                            tipo: texto(&o, "tipo")?,
                            cabecalhos,
                            corpo: texto(&o, "corpo")?,
                        }
                    }
                    outra => return Err(format!("ação de pedido desconhecida: {outra}")),
                };
                Comando::Pedido { id, acao }
            }
            "sair" => Comando::Sair,
            "avaliar" => Comando::Avaliar {
                id: inteiro(&o, "id")?,
                codigo: texto(&o, "codigo")?,
                url: match o.get("url") {
                    None | Some(Value::Null) => None,
                    Some(Value::String(u)) => Some(u.clone()),
                    Some(_) => return Err("«url» não é texto".into()),
                },
            },
            outro => return Err(format!("comando desconhecido: {outro}")),
        })
    }
}

impl Op {
    pub fn de(linha: &str) -> Result<Op, String> {
        let o = objeto(linha)?;
        let op = texto(&o, "op")?;
        Ok(match op.as_str() {
            #[cfg(not(feature = "placa"))]
            "motor" | "repetir" | "fechar" | "abrirVideo" | "montar" => Op::SoNaPlaca,
            #[cfg(feature = "placa")]
            "motor" => match o.get("opcoes") {
                Some(Value::Object(m)) => Op::Motor(opcoes_do_motor(m)?),
                _ => return Err("motor sem «opcoes» (objeto)".into()),
            },
            "marcado" => {
                Op::Marcado { id: inteiro(&o, "id")?, alvo: u32_de(&o, "alvo")?, conferir: logico(&o, "conferir")? }
            }
            "liberar" => Op::Liberar { id: inteiro(&o, "id")? },
            "navegar" => Op::Navegar { id: inteiro(&o, "id")?, permitir: logico(&o, "permitir")? },
            #[cfg(feature = "placa")]
            "repetir" => Op::Repetir,
            #[cfg(feature = "placa")]
            "fechar" => Op::Fechar,
            #[cfg(feature = "placa")]
            "abrirVideo" => match o.get("video") {
                Some(Value::Object(v)) => Op::AbrirVideo(video_na_placa(v)?),
                _ => return Err("abrirVideo sem «video» (objeto)".into()),
            },
            #[cfg(feature = "placa")]
            "montar" => match o.get("montagem") {
                None | Some(Value::Null) => Op::Montar(None),
                Some(Value::Object(m)) => Op::Montar(Some(montagem(m)?)),
                _ => return Err("«montagem» não é objeto".into()),
            },
            outra => return Err(format!("operação desconhecida: {outra}")),
        })
    }
}

#[cfg(feature = "placa")]
fn texto_opcional(o: &Map<String, Value>, campo: &str) -> Result<Option<String>, String> {
    match o.get(campo) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(t)) => Ok(Some(t.clone())),
        Some(_) => Err(format!("«{campo}» não é texto")),
    }
}

#[cfg(feature = "placa")]
fn i32_de(o: &Map<String, Value>, campo: &str) -> Result<i32, String> {
    let n = o.get(campo).and_then(Value::as_i64).ok_or_else(|| format!("falta o inteiro «{campo}»"))?;
    i32::try_from(n).map_err(|_| format!("«{campo}» fora do i32: {n}"))
}

/// S08: o `motor.abrirVideo({...})` do `main.ts`.
#[cfg(feature = "placa")]
pub fn video_na_placa(o: &Map<String, Value>) -> Result<VideoNaPlaca, String> {
    Ok(VideoNaPlaca {
        arquivo: texto(o, "arquivo")?,
        codec: texto(o, "codec")?,
        largura: u32_de(o, "largura")?,
        altura: u32_de(o, "altura")?,
        matriz: texto_opcional(o, "matriz")?,
        cheia: logico(o, "cheia")?,
        ffmpeg: texto_opcional(o, "ffmpeg")?,
    })
}

/// S08: o `motor.montar({...})` do `main.ts`.
#[cfg(feature = "placa")]
pub fn montagem(o: &Map<String, Value>) -> Result<Montagem, String> {
    let video = match o.get("video") {
        None | Some(Value::Null) => None,
        Some(Value::Object(v)) => {
            let recorte = match v.get("recorte") {
                Some(Value::Array(r)) if r.len() == 4 => r
                    .iter()
                    .map(|x| x.as_i64().and_then(|x| i32::try_from(x).ok()).ok_or_else(|| "recorte com inteiros".to_string()))
                    .collect::<Result<Vec<i32>, String>>()?,
                _ => return Err("recorte com 4 números: [x0, y0, x1, y1]".into()),
            };
            // Escala ≠ 1: [sx, sy, tx, ty] (o texel u vai a t + s·u no quadro).
            let escala = match v.get("escala") {
                None | Some(Value::Null) => None,
                Some(Value::Array(e)) if e.len() == 4 => Some(
                    e.iter().map(|x| x.as_f64().ok_or_else(|| "escala com números".to_string())).collect::<Result<Vec<f64>, String>>()?,
                ),
                _ => return Err("escala com 4 números: [sx, sy, tx, ty]".into()),
            };
            // Recorte arredondado de um ancestral: [x0, y0, x1, y1, raio] ou com os cantos por cima (bits) e o cobertor.
            let arredondado = match v.get("arredondado") {
                None | Some(Value::Null) => None,
                Some(Value::Array(e)) if e.len() == 5 || e.len() == 7 => Some(
                    e.iter().map(|x| x.as_f64().ok_or_else(|| "arredondado com números".to_string())).collect::<Result<Vec<f64>, String>>()?,
                ),
                _ => return Err("arredondado com 5 ou 7 números: [x0, y0, x1, y1, raio, cantos por cima, cobertor]".into()),
            };
            Some(VideoMontado { video: u32_de(v, "video")?, indice: u32_de(v, "indice")?, x: i32_de(v, "x")?, y: i32_de(v, "y")?, recorte, escala, arredondado })
        }
        Some(_) => return Err("«video» não é objeto".into()),
    };
    Ok(Montagem { fundo: u32_opcional(o, "fundo")?, video })
}

/// As opções do `new nativo.Motor({...})` do `main.ts`, nos nomes do JS (camelCase do napi).
#[cfg(feature = "placa")]
pub fn opcoes_do_motor(o: &Map<String, Value>) -> Result<Opcoes, String> {
    Ok(Opcoes {
        largura: u32_de(o, "largura")?,
        altura: u32_de(o, "altura")?,
        saida: texto(o, "saida")?,
        alfa: logico(o, "alfa")?,
        codec: match o.get("codec") {
            None | Some(Value::Null) => None,
            Some(Value::String(c)) => Some(c.clone()),
            Some(_) => return Err("«codec» não é texto".into()),
        },
        qps: u32_opcional(o, "qps")?,
        preset: u32_opcional(o, "preset")?,
        gop: u32_opcional(o, "gop")?,
        qualidade: u32_opcional(o, "qualidade")?,
        razao_alfa: u32_opcional(o, "razaoAlfa")?,
        marca: u32_opcional(o, "marca")?,
        fila: u32_opcional(o, "fila")?,
    })
}

/// O `Resumo` do `fechar()` nos nomes que o `main.ts` lê (camelCase do napi).
#[cfg(feature = "placa")]
pub fn resumo_json(r: &Resumo) -> Value {
    json!({
        "quadros": r.quadros,
        "repetidos": r.repetidos,
        "importacoes": r.importacoes,
        "cercasPendentes": r.cercas_pendentes,
        "semSyncFile": r.sem_sync_file,
        "bytes": r.bytes,
        "copiaUs": r.copia_us,
        "esperaUs": r.espera_us,
        "codificacaoUs": r.codificacao_us,
        "repeticaoUs": r.repeticao_us,
        // C01: quadros repetidos escritos como P pulado, e por que o pulado ficou desligado (se ficou).
        "pulados": r.pulados,
        "puladoDesligado": r.pulado_desligado,
        // S08: montagem do take na placa.
        "montagemUs": r.montagem_us,
        "nvdecQuadros": r.nvdec_quadros,
        "nvdecReaberturas": r.nvdec_reaberturas,
        "nvdecBytes": r.nvdec_bytes,
        // Brilho por quadro, medido na placa (nativo/src/brilho.rs; docs/formatos/brilho.md).
        "brilho": r.brilho,
        "mudanca": r.mudanca,
        "brilhoUs": r.brilho_us,
        "brilhoErro": r.brilho_erro,
    })
}

/// Um plano do dmabuf do `OnAcceleratedPaint`, como o `textureInfo.handle.nativePixmap.planes[i]` do Electron.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanoDoPaint {
    pub fd: i32,
    pub stride: u32,
    pub offset: u64,
    pub tamanho: u64,
}

/// Evento `paint` na placa. O fd é do host: o controlador não o usa, só o devolve pela operação `marcado`.
pub fn evento_paint_placa(id: u64, largura: i32, altura: i32, modifier: u64, formato: i32, planos: &[PlanoDoPaint]) -> Value {
    json!({
        "evento": "paint", "id": id, "textura": true, "largura": largura, "altura": altura,
        // O modifier vai como texto: passa de 2^53 e o JS o perderia como número (o napi do M02 também pede texto).
        "modifier": modifier.to_string(), "formato": formato,
        "planos": planos.iter().map(|p| json!({ "fd": p.fd, "stride": p.stride, "offset": p.offset, "size": p.tamanho })).collect::<Vec<_>>(),
    })
}

/// Evento `paint` na CPU: os pixels BGRA ficam no arquivo do quadro (`MOTOR_CAPTURA_QUADRO`).
pub fn evento_paint_cpu(id: u64, largura: i32, altura: i32) -> Value {
    json!({ "evento": "paint", "id": id, "textura": false, "largura": largura, "altura": altura })
}

/// Resposta do renderer a um `avaliar`: o valor (JSON vindo do renderer; vazio = undefined) ou o texto do erro.
pub fn evento_avaliado(id: u64, ok: bool, texto: &str) -> Value {
    if !ok {
        return json!({ "evento": "avaliado", "id": id, "ok": false, "erro": texto });
    }
    if texto.is_empty() {
        return json!({ "evento": "avaliado", "id": id, "ok": true });
    }
    match serde_json::from_str::<Value>(texto) {
        Ok(v) => json!({ "evento": "avaliado", "id": id, "ok": true, "valor": v }),
        Err(e) => json!({ "evento": "avaliado", "id": id, "ok": false, "erro": format!("valor do renderer em JSON inválido: {e}") }),
    }
}

/// Mensagem do CDP vinda do Chromium, já em JSON: entra como objeto, sem ser lida de novo.
pub fn evento_cdp(mensagem: &[u8]) -> Option<String> {
    let texto = std::str::from_utf8(mensagem).ok()?;
    // Confere que é um objeto JSON (o Chromium manda sempre um); se não, o controlador não o leria.
    if !texto.trim_start().starts_with('{') {
        return None;
    }
    Some(format!("{{\"evento\":\"cdp\",\"mensagem\":{texto}}}"))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn janela_e_carregar() {
        assert_eq!(
            Comando::de(r#"{"cmd":"janela","largura":1920,"altura":1096,"transparente":true,"qps":240,"textura":true}"#),
            Ok(Comando::Janela { largura: 1920, altura: 1096, transparente: true, qps: 240, textura: true, batida_externa: false })
        );
        // P13: a batida externa só quando pedida.
        assert_eq!(
            Comando::de(r#"{"cmd":"janela","largura":8,"altura":8,"transparente":false,"qps":240,"textura":true,"batidaExterna":true}"#),
            Ok(Comando::Janela { largura: 8, altura: 8, transparente: false, qps: 240, textura: true, batida_externa: true })
        );
        assert!(Comando::de(r#"{"cmd":"janela","largura":8,"altura":8,"transparente":false,"qps":240,"textura":true,"batidaExterna":1}"#).is_err());
        assert_eq!(Comando::de(r#"{"cmd":"batida"}"#), Ok(Comando::Batida));
        assert_eq!(
            Comando::de(r#"{"cmd":"carregar","url":"http://127.0.0.1:1/x"}"#),
            Ok(Comando::Carregar { url: "http://127.0.0.1:1/x".into() })
        );
        assert_eq!(Comando::de(r#"{"cmd":"parar"}"#), Ok(Comando::PararDePintar));
        assert_eq!(Comando::de(r#"{"cmd":"sair"}"#), Ok(Comando::Sair));
        assert_eq!(Comando::de(r#"{"cmd":"fecharJanela"}"#), Ok(Comando::FecharJanela));
    }

    #[test]
    fn cdp_passa_a_mensagem_inteira() {
        let c = Comando::de(r#"{"cmd":"cdp","mensagem":{"id":7,"method":"Runtime.evaluate","params":{"expression":"1+1"}}}"#);
        match c {
            Ok(Comando::Cdp { mensagem }) => {
                let v: Value = serde_json::from_str(&mensagem).unwrap();
                assert_eq!(v["id"], 7);
                assert_eq!(v["params"]["expression"], "1+1");
            }
            outro => panic!("{outro:?}"),
        }
        assert!(Comando::de(r#"{"cmd":"cdp","mensagem":"texto"}"#).is_err());
    }

    #[test]
    fn pedido_de_rede() {
        assert_eq!(
            Comando::de(r#"{"cmd":"pedido","id":12,"acao":"cancelar"}"#),
            Ok(Comando::Pedido { id: 12, acao: AcaoDoPedido::Cancelar })
        );
        assert_eq!(
            Comando::de(r#"{"cmd":"pedido","id":3,"acao":"responder","status":200,"tipo":"font/woff2","cabecalhos":{"access-control-allow-origin":"*"},"corpo":"/tmp/x"}"#),
            Ok(Comando::Pedido {
                id: 3,
                acao: AcaoDoPedido::Responder {
                    status: 200,
                    tipo: "font/woff2".into(),
                    cabecalhos: vec![("access-control-allow-origin".into(), "*".into())],
                    corpo: "/tmp/x".into(),
                }
            })
        );
        assert!(Comando::de(r#"{"cmd":"pedido","id":3,"acao":"talvez"}"#).is_err());
    }

    #[test]
    fn comando_errado_diz_o_que() {
        assert!(Comando::de("não é json").unwrap_err().contains("JSON inválido"));
        assert!(Comando::de("[1]").unwrap_err().contains("objeto"));
        assert!(Comando::de(r#"{"cmd":"voar"}"#).unwrap_err().contains("voar"));
        assert!(Comando::de(r#"{"cmd":"janela","largura":1}"#).unwrap_err().contains("altura"));
    }

    #[test]
    fn operacoes_da_ui_existem_com_e_sem_placa() {
        match Op::de(r#"{"op":"marcado","id":5,"alvo":42,"conferir":false}"#) {
            Ok(Op::Marcado { id: 5, alvo: 42, conferir: false }) => {}
            _ => panic!("marcado lido errado"),
        }
        assert!(matches!(Op::de(r#"{"op":"liberar","id":5}"#), Ok(Op::Liberar { id: 5 })));
        assert!(matches!(Op::de(r#"{"op":"navegar","id":2,"permitir":true}"#), Ok(Op::Navegar { id: 2, permitir: true })));
        assert!(Op::de(r#"{"op":"marcado","id":5,"alvo":-1,"conferir":false}"#).is_err());
        assert!(matches!(Op::de(r#"{"op":"voar"}"#), Err(e) if e.contains("voar")));
    }

    /// P14: sem a feature `placa`, as operações do núcleo viram a recusa (com a instrução), não um erro de protocolo
    /// que derrubaria o host.
    #[cfg(not(feature = "placa"))]
    #[test]
    fn sem_placa_as_operacoes_do_nucleo_sao_recusadas() {
        for linha in [
            r#"{"op":"motor","opcoes":{"largura":1920,"altura":1080,"saida":"/tmp/r.h264","alfa":false}}"#,
            r#"{"op":"repetir"}"#,
            r#"{"op":"fechar"}"#,
            r#"{"op":"abrirVideo","video":{}}"#,
            r#"{"op":"montar","montagem":null}"#,
        ] {
            assert!(matches!(Op::de(linha), Ok(Op::SoNaPlaca)), "{linha}");
        }
        assert!(SEM_PLACA.contains("--cpu") && SEM_PLACA.contains("./instalar.sh"));
    }

    #[cfg(feature = "placa")]
    #[test]
    fn operacoes_sincronas() {
        assert!(matches!(Op::de(r#"{"op":"repetir"}"#), Ok(Op::Repetir)));
        assert!(matches!(Op::de(r#"{"op":"fechar"}"#), Ok(Op::Fechar)));
        // S08
        match Op::de(r#"{"op":"abrirVideo","video":{"arquivo":"/a/v.mp4","codec":"h264","largura":1920,"altura":1080,"matriz":"bt709","cheia":false}}"#) {
            Ok(Op::AbrirVideo(v)) => {
                assert_eq!((v.arquivo.as_str(), v.codec.as_str(), v.largura, v.altura), ("/a/v.mp4", "h264", 1920, 1080));
                assert_eq!((v.matriz.as_deref(), v.cheia, v.ffmpeg), (Some("bt709"), false, None));
            }
            _ => panic!("abrirVideo"),
        }
        match Op::de(r#"{"op":"montar","montagem":{"fundo":725536,"video":{"video":0,"indice":98,"x":-300,"y":0,"recorte":[0,0,1620,1080]}}}"#) {
            Ok(Op::Montar(Some(m))) => {
                assert_eq!(m.fundo, Some(725536));
                let v = m.video.unwrap();
                assert_eq!((v.video, v.indice, v.x, v.y, v.recorte, v.escala), (0, 98, -300, 0, vec![0, 0, 1620, 1080], None));
            }
            _ => panic!("montar"),
        }
        match Op::de(r#"{"op":"montar","montagem":{"video":{"video":1,"indice":3,"x":-97,"y":-52,"recorte":[0,0,1920,1080],"escala":[1.1,1.1,-96.5,-51.25]}}}"#) {
            Ok(Op::Montar(Some(m))) => assert_eq!(m.video.unwrap().escala, Some(vec![1.1, 1.1, -96.5, -51.25])),
            _ => panic!("montar com escala"),
        }
        assert!(Op::de(r#"{"op":"montar","montagem":{"video":{"video":0,"indice":1,"x":0,"y":0,"recorte":[0,0,1,1],"escala":[1,1,0]}}}"#).is_err());
        // S08, recorte arredondado: [x0, y0, x1, y1, raio].
        match Op::de(r#"{"op":"montar","montagem":{"video":{"video":0,"indice":2,"x":0,"y":0,"recorte":[70,80,790,1000],"escala":[0.85,0.85,-457.8,0],"arredondado":[70,80,790,1000,32]}}}"#) {
            Ok(Op::Montar(Some(m))) => assert_eq!(m.video.unwrap().arredondado, Some(vec![70.0, 80.0, 790.0, 1000.0, 32.0])),
            _ => panic!("montar com arredondado"),
        }
        assert!(Op::de(r#"{"op":"montar","montagem":{"video":{"video":0,"indice":1,"x":0,"y":0,"recorte":[0,0,1,1],"arredondado":[0,0,1,1]}}}"#).is_err());
        assert!(matches!(Op::de(r#"{"op":"montar","montagem":null}"#), Ok(Op::Montar(None))));
        assert!(Op::de(r#"{"op":"montar","montagem":{"video":{"video":0,"indice":1,"x":0,"y":0,"recorte":[0,0,1]}}}"#).is_err());
    }

    #[cfg(feature = "placa")]
    #[test]
    fn opcoes_do_motor_nos_nomes_do_js() {
        let op = Op::de(r#"{"op":"motor","opcoes":{"largura":1920,"altura":1080,"marca":16,"saida":"/tmp/r.h264","alfa":false,"codec":"h264","qps":30,"fila":4}}"#);
        match op {
            Ok(Op::Motor(o)) => {
                assert_eq!((o.largura, o.altura, o.marca, o.qps, o.fila), (1920, 1080, Some(16), Some(30), Some(4)));
                assert_eq!(o.codec.as_deref(), Some("h264"));
                assert_eq!(o.saida, "/tmp/r.h264");
                assert!(!o.alfa);
                assert_eq!((o.preset, o.gop, o.qualidade, o.razao_alfa), (None, None, None, None));
            }
            _ => panic!("motor lido errado"),
        }
        assert!(Op::de(r#"{"op":"motor","opcoes":{"largura":1920,"altura":1080,"alfa":false}}"#).err().unwrap().contains("saida"));
    }

    #[cfg(feature = "placa")]
    #[test]
    fn resumo_nos_nomes_que_o_main_mjs_le() {
        let r = Resumo { quadros: 3, repetidos: 1, importacoes: 2, copia_us: vec![1.0], ..Default::default() };
        let v = resumo_json(&r);
        for campo in ["quadros", "repetidos", "importacoes", "cercasPendentes", "semSyncFile", "bytes", "copiaUs", "esperaUs",
            "codificacaoUs", "repeticaoUs", "pulados", "puladoDesligado", "brilho", "mudanca", "brilhoUs"]
        {
            assert!(v.get(campo).is_some(), "falta {campo}");
        }
        assert_eq!(v["quadros"], 3);
        assert_eq!(v["copiaUs"][0], 1.0);
    }

    #[test]
    fn paint_leva_o_modifier_como_texto() {
        let v = evento_paint_placa(9, 1920, 1096, 0x0300000000606014, 1, &[PlanoDoPaint { fd: 40, stride: 7680, offset: 0, tamanho: 8417280 }]);
        assert_eq!(v["modifier"], "216172782120099860");
        assert_eq!(v["planos"][0]["stride"], 7680);
        assert_eq!(v["textura"], true);
        assert_eq!(evento_paint_cpu(1, 2, 3)["textura"], false);
    }

    #[test]
    fn cdp_entra_como_objeto() {
        let e = evento_cdp(br#"{"id":1,"result":{}}"#).unwrap();
        let v: Value = serde_json::from_str(&e).unwrap();
        assert_eq!(v["mensagem"]["id"], 1);
        assert_eq!(evento_cdp(b"\xff"), None);
        assert_eq!(evento_cdp(b"[1]"), None);
    }

    #[test]
    fn avaliar_no_quadro_principal_ou_no_iframe() {
        assert_eq!(
            Comando::de(r#"{"cmd":"avaliar","id":3,"codigo":"motor_marcar(3); true"}"#),
            Ok(Comando::Avaliar { id: 3, codigo: "motor_marcar(3); true".into(), url: None })
        );
        assert_eq!(
            Comando::de(r#"{"cmd":"avaliar","id":4,"codigo":"1","url":"http://127.0.0.1:9/index.html"}"#),
            Ok(Comando::Avaliar { id: 4, codigo: "1".into(), url: Some("http://127.0.0.1:9/index.html".into()) })
        );
    }

    #[test]
    fn avaliado_leva_o_valor_em_json_ou_o_erro() {
        let v = evento_avaliado(7, true, r#"{"a":[1,"x"]}"#);
        assert_eq!((v["evento"].as_str(), v["id"].as_u64(), v["ok"].as_bool()), (Some("avaliado"), Some(7), Some(true)));
        assert_eq!(v["valor"]["a"][1], "x");
        // Sem valor (undefined): o campo não vem.
        assert!(evento_avaliado(8, true, "").get("valor").is_none());
        let e = evento_avaliado(9, false, "Error: não existe");
        assert_eq!((e["ok"].as_bool(), e["erro"].as_str()), (Some(false), Some("Error: não existe")));
        // JSON quebrado vindo do renderer vira erro, não valor errado.
        assert_eq!(evento_avaliado(10, true, "{")["ok"], false);
    }
}
