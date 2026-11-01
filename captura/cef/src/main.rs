//! Host da captura pelo CEF (P02): o Chromium fora da tela (OSR) com a textura compartilhada, sem remendo no binário.
//!
//! O quadro do `OnAcceleratedPaint` (dmabuf block-linear, BGRA) vai direto ao núcleo do módulo nativo do M02
//! (`quadro_marcado`: cópia na placa, marca, NVENC), sem passar pela CPU (R04). Quem decide é o controlador em
//! TypeScript (`captura/cef/host.ts`), pelo protocolo de `protocolo.rs`: o host só executa. Enquanto o controlador decide
//! o que fazer com um paint, a thread de UI do CEF espera com o buffer seguro, como o Electron entre o evento `paint`
//! e o `texture.release()`.
//!
//! Variáveis: MOTOR_CAPTURA_PEDIDOS e MOTOR_CAPTURA_RESPOSTAS (FIFOs das operações síncronas),
//! MOTOR_CAPTURA_QUADRO (arquivo dos pixels: o paint da CPU e os pixels conferidos da placa), MOTOR_CAPTURA_CACHE
//! (root_cache_path; o perfil fica em memória), MOTOR_DEPURAR=1 (log do Chromium a partir de WARNING).
//! Argumentos `--nome[=valor]` vão ao Chromium (os do `app.commandLine.appendSwitch` e os do comando).
//!
//! P14: o núcleo do M02 entra só com a feature `placa` (padrão). Sem ela (máquina sem driver NVIDIA), o host fica só
//! com o paint da CPU (`OnPaint`, o modo CPU) e recusa as operações do modo placa com `protocolo::SEM_PLACA`.

mod protocolo;
#[cfg(feature = "placa")]
mod sem_node;

// ÚNICO PONTO com o caminho do núcleo do M02 (o `src/` do nativo). Se ele mudar de lugar, trocar só
// estas duas linhas `#[path]` (relativas a esta pasta, captura/cef/src).
#[cfg(feature = "placa")]
#[path = "../../../nativo/src/lib.rs"]
#[allow(dead_code, unused_imports)]
mod nucleo;
// Os testes do vulkan.rs do M02 usam `crate::marca` (lá o núcleo é a raiz da crate).
#[cfg(all(test, feature = "placa"))]
#[path = "../../../nativo/src/marca.rs"]
#[allow(dead_code)]
mod marca;

use cef::*;
use protocolo::{AcaoDoPedido, Comando, Op, PlanoDoPaint};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::fd::FromRawFd;
use std::os::unix::fs::FileExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, mpsc};
use std::time::Duration;

unsafe extern "C" {
    fn _exit(codigo: i32) -> !;
    fn dup(fd: i32) -> i32;
    fn dup2(de: i32, para: i32) -> i32;
}

/// Sai sem os destrutores da saída: pelo `exit()` normal, o processo do CEF levava ~4,5 s a mais (prova do P02).
fn sair_ja(codigo: i32) -> ! {
    let _ = std::io::stderr().flush();
    unsafe { _exit(codigo) }
}

fn morrer(texto: &str) -> ! {
    eprintln!("motor-captura: {texto}");
    sair_ja(3)
}

/// O que a thread de UI espera enquanto segura um paint ou uma navegação.
enum ParaUi {
    Liberar(u64),
    Marcado { id: u64, alvo: u32, conferir: bool },
    Navegar { id: u64, permitir: bool },
}

/// O callback do CEF guardado até o controlador responder (os métodos do `CefCallback` valem em qualquer thread).
struct Adiado(Callback);
unsafe impl Send for Adiado {}

/// Resposta de rede montada pelo controlador (fonte do cache, protocolo `https` do Electron).
#[derive(Clone)]
struct Resposta {
    status: i32,
    tipo: String,
    cabecalhos: Vec<(String, String)>,
    corpo: Arc<Vec<u8>>,
}

struct Estado {
    eventos: Mutex<File>,
    respostas: Mutex<File>,
    quadro: File,
    #[cfg(feature = "placa")]
    motor: Mutex<Option<nucleo::Motor>>,
    para_ui: Mutex<mpsc::Sender<ParaUi>>,
    da_ui: Mutex<mpsc::Receiver<ParaUi>>,
    /// Pedidos de rede esperando o controlador, com a URL.
    adiados: Mutex<HashMap<u64, (Adiado, String)>>,
    /// Respostas prontas por URL, na ordem (o `GetResourceHandler` vem depois do `OnBeforeResourceLoad` continuar).
    prontas: Mutex<HashMap<String, VecDeque<Resposta>>>,
    tamanho: Mutex<(i32, i32)>,
    proximo: AtomicU64,
    /// Paints descartados por virem noutro tamanho que o da janela (redimensionamento em trânsito).
    fora_do_tamanho: AtomicU64,
    /// URL que o próprio controlador mandou carregar (não passa pela decisão de navegação, como o `loadURL`).
    carregando: Mutex<Option<String>>,
    depurar: bool,
}

static ESTADO: OnceLock<Estado> = OnceLock::new();
/// O controlador pediu para sair: fechar o navegador encerra o laço do CEF.
static SAINDO: AtomicBool = AtomicBool::new(false);

fn estado() -> &'static Estado {
    ESTADO.get().expect("estado do host")
}

thread_local! {
    static NAVEGADOR: RefCell<Option<Browser>> = const { RefCell::new(None) };
    static OBSERVADOR: RefCell<Option<Registration>> = const { RefCell::new(None) };
}

fn emitir_texto(linha: &str) {
    let mut f = estado().eventos.lock().unwrap();
    if f.write_all(linha.as_bytes()).and_then(|_| f.write_all(b"\n")).is_err() {
        // O controlador saiu: não há a quem entregar nada.
        sair_ja(0);
    }
}

fn emitir(v: &Value) {
    emitir_texto(&v.to_string());
}

fn responder(v: &Value) {
    let mut f = estado().respostas.lock().unwrap();
    let linha = format!("{v}\n");
    if f.write_all(linha.as_bytes()).is_err() {
        sair_ja(0);
    }
}

fn texto_cef(s: &CefStringUserfree) -> String {
    CefString::from(s).to_string()
}

// ---------------------------------------------------------------------------------------------------------------
// Tarefas na thread de UI

wrap_task! {
    struct Tarefa {
        corpo: Arc<Mutex<Option<Box<dyn FnOnce() + Send>>>>,
    }

    impl Task {
        fn execute(&self) {
            if let Some(f) = self.corpo.lock().unwrap().take() {
                f();
            }
        }
    }
}

fn na_ui(f: impl FnOnce() + Send + 'static) {
    let mut t = Tarefa::new(Arc::new(Mutex::new(Some(Box::new(f)))));
    post_task(ThreadId::UI, Some(&mut t));
}

fn com_navegador(f: impl FnOnce(&Browser)) {
    // Fora do empréstimo: o close_browser chama o on_before_close, que solta o navegador.
    let b = NAVEGADOR.with(|n| n.borrow().clone());
    if let Some(b) = b {
        f(&b);
    }
}

fn com_host(f: impl FnOnce(&BrowserHost)) {
    com_navegador(|b| {
        if let Some(h) = b.host() {
            f(&h);
        }
    });
}

/// O paint tem o tamanho da janela de agora? Os de outro tamanho são descartados e contados.
fn tamanho_atual(e: &Estado, largura: i32, altura: i32) -> bool {
    if *e.tamanho.lock().unwrap() == (largura, altura) {
        return true;
    }
    let n = e.fora_do_tamanho.fetch_add(1, Ordering::Relaxed) + 1;
    if e.depurar {
        eprintln!("motor-captura: paint {largura}x{altura} fora do tamanho da janela, descartado ({n})");
    }
    false
}

/// Espera, na thread de UI, o fim de um paint segurado: o controlador manda `marcado` (cópia e NVENC com o buffer
/// ainda vivo, e o paint fica liberado) ou só `liberar`.
fn segurar_paint(id: u64, mut marcado: impl FnMut(u32, bool) -> Value) {
    let rx = estado().da_ui.lock().unwrap();
    loop {
        match rx.recv() {
            Ok(ParaUi::Liberar(i)) if i == id => return,
            // Depois do `marcado` (a cópia já foi feita), o paint está liberado: uma ida e volta por paint, não duas.
            Ok(ParaUi::Marcado { id: i, alvo, conferir }) if i == id => {
                responder(&marcado(alvo, conferir));
                return;
            }
            Ok(ParaUi::Liberar(i)) | Ok(ParaUi::Marcado { id: i, .. }) | Ok(ParaUi::Navegar { id: i, .. }) => {
                morrer(&format!("decisão para {i} chegou com o paint {id} seguro"))
            }
            Err(_) => sair_ja(0),
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Handlers do CEF

wrap_render_handler! {
    struct Desenho;

    impl RenderHandler {
        fn view_rect(&self, _browser: Option<&mut Browser>, rect: Option<&mut Rect>) {
            if let Some(r) = rect {
                let (l, a) = *estado().tamanho.lock().unwrap();
                *r = Rect { x: 0, y: 0, width: l, height: a };
            }
        }

        fn screen_info(&self, _browser: Option<&mut Browser>, info: Option<&mut ScreenInfo>) -> ::std::os::raw::c_int {
            // DPR 1: o quadro tem o tamanho da janela, como no Electron (codedSize = composição + faixa).
            if let Some(i) = info {
                let (l, a) = *estado().tamanho.lock().unwrap();
                i.device_scale_factor = 1.0;
                i.depth = 32;
                i.depth_per_component = 8;
                i.rect = Rect { x: 0, y: 0, width: l, height: a };
                i.available_rect = i.rect.clone();
                return 1;
            }
            0
        }

        fn on_accelerated_paint(&self, _browser: Option<&mut Browser>, type_: PaintElementType, _dirty: Option<&[Rect]>,
            info: Option<&AcceleratedPaintInfo>) {
            let Some(info) = info else { return };
            if type_ != PaintElementType::VIEW {
                return;
            }
            let e = estado();
            let (largura, altura) = (info.extra.coded_size.width, info.extra.coded_size.height);
            // Quadro ainda no tamanho antigo, em trânsito depois do redimensionamento (setContentSize): o Electron não
            // o entrega; aqui ele chegava com a marca já pedida e o motor recusava o tamanho.
            if !tamanho_atual(e, largura, altura) {
                return;
            }
            let id = e.proximo.fetch_add(1, Ordering::Relaxed);
            let n = info.plane_count.clamp(0, 4) as usize;
            let planos: Vec<PlanoDoPaint> = info.planes[..n]
                .iter()
                .map(|p| PlanoDoPaint { fd: p.fd, stride: p.stride, offset: p.offset, tamanho: p.size })
                .collect();
            emitir(&protocolo::evento_paint_placa(id, largura, altura, info.modifier, info.format.get_raw() as i32, &planos));
            #[cfg(not(feature = "placa"))]
            segurar_paint(id, |_, _| json!({ "erro": protocolo::SEM_PLACA }));
            #[cfg(feature = "placa")]
            segurar_paint(id, |alvo, conferir| {
                let Some(p) = planos.first() else { return json!({ "erro": "paint sem plano" }) };
                let mut motor = e.motor.lock().unwrap();
                let Some(m) = motor.as_mut() else { return json!({ "erro": "motor não aberto" }) };
                let plano = nucleo::Plano {
                    fd: p.fd,
                    stride: p.stride,
                    offset: p.offset as u32,
                    largura: largura.max(0) as u32,
                    altura: altura.max(0) as u32,
                };
                match m.quadro_marcado(plano, info.modifier.to_string(), alvo, conferir) {
                    Ok(r) => {
                        let mut bytes = Value::Null;
                        if let Some(px) = r.pixels.as_ref() {
                            let px: &[u8] = px.as_ref();
                            if let Err(erro) = e.quadro.write_all_at(px, 0) {
                                return json!({ "erro": format!("gravar os pixels conferidos: {erro}") });
                            }
                            bytes = json!(px.len());
                        }
                        json!({ "marca": r.marca, "codificado": r.codificado, "pixels": bytes })
                    }
                    Err(erro) => json!({ "erro": erro.reason }),
                }
            });
        }

        fn on_paint(&self, _browser: Option<&mut Browser>, type_: PaintElementType, _dirty: Option<&[Rect]>,
            buffer: *const u8, width: ::std::os::raw::c_int, height: ::std::os::raw::c_int) {
            if type_ != PaintElementType::VIEW || buffer.is_null() || width <= 0 || height <= 0 {
                return;
            }
            let e = estado();
            if !tamanho_atual(e, width, height) {
                return;
            }
            let id = e.proximo.fetch_add(1, Ordering::Relaxed);
            // Modo CPU (M06/M08): BGRA na CPU, para o arquivo do quadro; o controlador lê enquanto este paint espera.
            let pixels = unsafe { std::slice::from_raw_parts(buffer, width as usize * height as usize * 4) };
            if let Err(erro) = e.quadro.write_all_at(pixels, 0) {
                morrer(&format!("gravar o paint da CPU: {erro}"));
            }
            emitir(&protocolo::evento_paint_cpu(id, width, height));
            segurar_paint(id, |_, _| json!({ "erro": "marcado no modo CPU" }));
        }
    }
}

wrap_life_span_handler! {
    struct Vida;

    impl LifeSpanHandler {
        fn on_after_created(&self, browser: Option<&mut Browser>) {
            let Some(b) = browser else { return };
            let observador = b.host().and_then(|h| h.add_dev_tools_message_observer(Some(&mut Ferramentas::new())));
            OBSERVADOR.with(|o| *o.borrow_mut() = observador);
            NAVEGADOR.with(|n| *n.borrow_mut() = Some(b.clone()));
            emitir(&json!({ "evento": "janela" }));
        }

        fn on_before_popup(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>, _popup_id: ::std::os::raw::c_int,
            target_url: Option<&CefString>, _target_frame_name: Option<&CefString>, _target_disposition: WindowOpenDisposition,
            _user_gesture: ::std::os::raw::c_int, _popup_features: Option<&PopupFeatures>, _window_info: Option<&mut WindowInfo>,
            _client: Option<&mut Option<Client>>, _settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>, _no_javascript_access: Option<&mut ::std::os::raw::c_int>)
            -> ::std::os::raw::c_int {
            // Nenhuma janela nova (o setWindowOpenHandler do main.ts nega todas); o controlador conta.
            emitir(&json!({ "evento": "popup", "url": target_url.map(|u| u.to_string()).unwrap_or_default() }));
            1
        }

        fn on_before_close(&self, browser: Option<&mut Browser>) {
            // Só solta o navegador de agora se for ele que fechou (a janela de aquecimento da reserva fecha antes da
            // do job abrir, mas a ordem dos avisos não é garantida).
            let atual = NAVEGADOR.with(|n| n.borrow().clone());
            if let (Some(a), Some(b)) = (atual, browser) {
                if a.is_same(Some(b)) != 0 {
                    OBSERVADOR.with(|o| o.borrow_mut().take());
                    NAVEGADOR.with(|n| n.borrow_mut().take());
                }
            }
            if SAINDO.load(Ordering::Relaxed) {
                quit_message_loop();
            }
        }
    }
}

wrap_load_handler! {
    struct Carga;

    impl LoadHandler {
        fn on_load_end(&self, _browser: Option<&mut Browser>, frame: Option<&mut Frame>, http_status_code: ::std::os::raw::c_int) {
            let Some(f) = frame else { return };
            if f.is_main() == 0 {
                return;
            }
            emitir(&json!({ "evento": "carregou", "url": texto_cef(&f.url()), "status": http_status_code }));
        }

        fn on_load_error(&self, _browser: Option<&mut Browser>, frame: Option<&mut Frame>, error_code: Errorcode,
            error_text: Option<&CefString>, failed_url: Option<&CefString>) {
            let Some(f) = frame else { return };
            if f.is_main() == 0 {
                return;
            }
            emitir(&json!({ "evento": "erroDeCarga", "url": failed_url.map(|u| u.to_string()).unwrap_or_default(),
                "codigo": error_code.get_raw() as i64, "texto": error_text.map(|t| t.to_string()).unwrap_or_default() }));
        }
    }
}

wrap_display_handler! {
    struct Console;

    impl DisplayHandler {
        fn on_console_message(&self, _browser: Option<&mut Browser>, level: LogSeverity, message: Option<&CefString>,
            source: Option<&CefString>, line: ::std::os::raw::c_int) -> ::std::os::raw::c_int {
            let nivel = if level == LogSeverity::ERROR || level == LogSeverity::FATAL {
                "error"
            } else if level == LogSeverity::WARNING {
                "warning"
            } else {
                "info"
            };
            emitir(&json!({ "evento": "console", "nivel": nivel, "texto": message.map(|m| m.to_string()).unwrap_or_default(),
                "fonte": source.map(|m| m.to_string()).unwrap_or_default(), "linha": line }));
            0
        }
    }
}

wrap_dev_tools_message_observer! {
    struct Ferramentas;

    impl DevToolsMessageObserver {
        fn on_dev_tools_message(&self, _browser: Option<&mut Browser>, message: Option<&[u8]>) -> ::std::os::raw::c_int {
            if let Some(linha) = message.and_then(protocolo::evento_cdp) {
                emitir_texto(&linha);
            }
            1
        }
    }
}

wrap_resource_handler! {
    struct Fornecedor {
        resposta: Resposta,
        lido: Arc<Mutex<usize>>,
    }

    impl ResourceHandler {
        fn open(&self, _request: Option<&mut Request>, handle_request: Option<&mut ::std::os::raw::c_int>,
            _callback: Option<&mut Callback>) -> ::std::os::raw::c_int {
            if let Some(h) = handle_request {
                *h = 1;
            }
            1
        }

        fn response_headers(&self, response: Option<&mut Response>, response_length: Option<&mut i64>,
            _redirect_url: Option<&mut CefString>) {
            if let Some(r) = response {
                r.set_status(self.resposta.status);
                r.set_mime_type(Some(&CefString::from(self.resposta.tipo.as_str())));
                for (k, v) in &self.resposta.cabecalhos {
                    r.set_header_by_name(Some(&CefString::from(k.as_str())), Some(&CefString::from(v.as_str())), 1);
                }
            }
            if let Some(n) = response_length {
                *n = self.resposta.corpo.len() as i64;
            }
        }

        fn skip(&self, bytes_to_skip: i64, bytes_skipped: Option<&mut i64>, _callback: Option<&mut ResourceSkipCallback>)
            -> ::std::os::raw::c_int {
            let mut lido = self.lido.lock().unwrap();
            let pulo = (bytes_to_skip.max(0) as usize).min(self.resposta.corpo.len() - *lido);
            *lido += pulo;
            if let Some(s) = bytes_skipped {
                *s = pulo as i64;
            }
            1
        }

        fn read(&self, data_out: *mut u8, bytes_to_read: ::std::os::raw::c_int, bytes_read: Option<&mut ::std::os::raw::c_int>,
            _callback: Option<&mut ResourceReadCallback>) -> ::std::os::raw::c_int {
            let mut lido = self.lido.lock().unwrap();
            let resto = &self.resposta.corpo[*lido..];
            let n = resto.len().min(bytes_to_read.max(0) as usize);
            if n > 0 {
                unsafe { std::ptr::copy_nonoverlapping(resto.as_ptr(), data_out, n) };
            }
            *lido += n;
            if let Some(b) = bytes_read {
                *b = n as i32;
            }
            (n > 0) as i32
        }

        fn cancel(&self) {}
    }
}

wrap_resource_request_handler! {
    struct Rede;

    impl ResourceRequestHandler {
        fn on_before_resource_load(&self, _browser: Option<&mut Browser>, frame: Option<&mut Frame>, request: Option<&mut Request>,
            callback: Option<&mut Callback>) -> ReturnValue {
            let (Some(pedido), Some(cb)) = (request, callback) else { return ReturnValue::CANCEL };
            // O favicon é do CEF (o Electron fora da tela não pede): cancelado sem contar como rede bloqueada.
            if pedido.resource_type() == ResourceType::FAVICON {
                return ReturnValue::CANCEL;
            }
            // Todo pedido passa pelo controlador (o webRequest.onBeforeRequest e o protocol.handle do main.ts). O
            // `identifier()` do CefRequest não serve de chave (vem u64::MAX em parte dos pedidos): o id é nosso.
            let e = estado();
            let id = e.proximo.fetch_add(1, Ordering::Relaxed);
            let url = texto_cef(&pedido.url());
            e.adiados.lock().unwrap().insert(id, (Adiado(cb.clone()), url.clone()));
            emitir(&json!({ "evento": "pedido", "id": id, "url": url, "metodo": texto_cef(&pedido.method()),
                "principal": frame.map(|f| f.is_main() != 0).unwrap_or(false) }));
            ReturnValue::CONTINUE_ASYNC
        }

        fn resource_handler(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>, request: Option<&mut Request>)
            -> Option<ResourceHandler> {
            let url = texto_cef(&request?.url());
            let mut prontas = estado().prontas.lock().unwrap();
            let fila = prontas.get_mut(&url)?;
            let resposta = fila.pop_front()?;
            if fila.is_empty() {
                prontas.remove(&url);
            }
            Some(Fornecedor::new(resposta, Arc::new(Mutex::new(0))))
        }
    }
}

wrap_request_handler! {
    struct Pedidos;

    impl RequestHandler {
        fn on_before_browse(&self, _browser: Option<&mut Browser>, frame: Option<&mut Frame>, request: Option<&mut Request>,
            _user_gesture: ::std::os::raw::c_int, _is_redirect: ::std::os::raw::c_int) -> ::std::os::raw::c_int {
            let Some(pedido) = request else { return 1 };
            let url = texto_cef(&pedido.url());
            let principal = frame.map(|f| f.is_main() != 0).unwrap_or(false);
            let e = estado();
            // O loadURL do controlador não pergunta (como no Electron, o will-frame-navigate não vem do loadURL).
            if principal && e.carregando.lock().unwrap().take().as_deref() == Some(url.as_str()) {
                return 0;
            }
            let id = e.proximo.fetch_add(1, Ordering::Relaxed);
            emitir(&json!({ "evento": "navegar", "id": id, "url": url, "principal": principal }));
            let rx = e.da_ui.lock().unwrap();
            match rx.recv() {
                Ok(ParaUi::Navegar { id: i, permitir }) if i == id => (!permitir) as i32,
                Ok(_) => morrer(&format!("decisão errada com a navegação {id} segura")),
                Err(_) => sair_ja(0),
            }
        }

        fn resource_request_handler(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _request: Option<&mut Request>, _is_navigation: ::std::os::raw::c_int, _is_download: ::std::os::raw::c_int,
            _request_initiator: Option<&CefString>, _disable_default_handling: Option<&mut ::std::os::raw::c_int>)
            -> Option<ResourceRequestHandler> {
            Some(Rede::new())
        }
    }
}

wrap_client! {
    struct Cliente;

    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> {
            Some(Desenho::new())
        }
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(Vida::new())
        }
        fn load_handler(&self) -> Option<LoadHandler> {
            Some(Carga::new())
        }
        fn request_handler(&self) -> Option<RequestHandler> {
            Some(Pedidos::new())
        }
        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(Console::new())
        }

        fn on_process_message_received(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _source_process: ProcessId, message: Option<&mut ProcessMessage>) -> ::std::os::raw::c_int {
            let Some(m) = message else { return 0 };
            if texto_cef(&m.name()) != "motor_avaliado" {
                return 0;
            }
            let Some(a) = m.argument_list() else { return 0 };
            let id = texto_cef(&a.string(0)).parse::<u64>().unwrap_or(0);
            emitir(&protocolo::evento_avaliado(id, a.bool(1) != 0, &texto_cef(&a.string(2))));
            1
        }
    }
}

wrap_browser_process_handler! {
    struct Processo;

    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            std::thread::spawn(ler_comandos);
            std::thread::spawn(ler_operacoes);
            emitir(&json!({ "evento": "pronto", "versao": "156.0.14", "pid": std::process::id() }));
        }

        fn default_request_context_handler(&self) -> Option<RequestContextHandler> {
            Some(Contexto::new())
        }
    }
}

// Pedidos sem janela (service worker, worker compartilhado): o CEF os leva ao handler do contexto, não ao do cliente.
// Passam pelo mesmo filtro (achado da revisão do P02): o controlador decide, como o webRequest do Electron, que vale
// para a sessão inteira.
wrap_request_context_handler! {
    struct Contexto;

    impl RequestContextHandler {
        fn resource_request_handler(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _request: Option<&mut Request>, _is_navigation: ::std::os::raw::c_int, _is_download: ::std::os::raw::c_int,
            _request_initiator: Option<&CefString>, _disable_default_handling: Option<&mut ::std::os::raw::c_int>)
            -> Option<ResourceRequestHandler> {
            Some(Rede::new())
        }
    }
}

wrap_app! {
    struct Aplicacao;

    impl App {
        fn on_before_command_line_processing(&self, process_type: Option<&CefString>, command_line: Option<&mut CommandLine>) {
            let principal = process_type.map(|t| t.to_string().is_empty()).unwrap_or(true);
            if let (true, Some(c)) = (principal, command_line) {
                // Sem isso, o serviço de rede espera o chaveiro no D-Bus por 25 s (prova do P02, degrau 2).
                c.append_switch_with_value(Some(&CefString::from("password-store")), Some(&CefString::from("basic")));
                // O WebSocket não passa pelo OnBeforeResourceLoad do CEF (achado da revisão do P02): todo o tráfego
                // que não é do loopback vai a um proxy morto e falha. O loopback (os servidores do motor) segue direto,
                // como o Chromium faz por padrão; no serviço, o bwrap já deixa só o loopback do sandbox.
                c.append_switch_with_value(Some(&CefString::from("proxy-server")), Some(&CefString::from("http://127.0.0.1:9")));
            }
        }

        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(Processo::new())
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Canais com o controlador

fn criar_janela(largura: u32, altura: u32, transparente: bool, qps: u32, textura: bool, batida_externa: bool) {
    *estado().tamanho.lock().unwrap() = (largura as i32, altura as i32);
    // P13: com a batida externa, o `windowless_frame_rate` não vale; o compositor faz um quadro por `batida`.
    let janela = WindowInfo {
        shared_texture_enabled: textura as i32,
        external_begin_frame_enabled: batida_externa as i32,
        ..WindowInfo::default().set_as_windowless(0)
    };
    let ajustes = BrowserSettings {
        windowless_frame_rate: qps as i32,
        // Placa: transparente (o alfa vai ao HEVC). CPU: preto opaco, como o M08.
        background_color: if transparente { 0x0000_0000 } else { 0xff00_0000 },
        ..Default::default()
    };
    let mut cliente = Cliente::new();
    // Contexto próprio, em memória, com o handler que filtra também os pedidos sem janela (service worker): o do
    // contexto global (default_request_context_handler) não é consultado para eles.
    let mut contexto = request_context_create_context(Some(&RequestContextSettings::default()), Some(&mut Contexto::new()));
    browser_host_create_browser(Some(&janela), Some(&mut cliente), Some(&CefString::from("about:blank")), Some(&ajustes), None,
        contexto.as_mut());
}

fn executar(c: Comando) {
    match c {
        Comando::Janela { largura, altura, transparente, qps, textura, batida_externa } => {
            na_ui(move || criar_janela(largura, altura, transparente, qps, textura, batida_externa))
        }
        Comando::Carregar { url } => na_ui(move || {
            *estado().carregando.lock().unwrap() = Some(url.clone());
            com_navegador(|b| {
                if let Some(f) = b.main_frame() {
                    f.load_url(Some(&CefString::from(url.as_str())));
                }
            });
        }),
        Comando::Cdp { mensagem } => na_ui(move || {
            com_host(|h| {
                if h.send_dev_tools_message(Some(mensagem.as_bytes())) == 0 {
                    eprintln!("motor-captura: o CDP recusou a mensagem: {}", &mensagem[..mensagem.len().min(200)]);
                }
            })
        }),
        Comando::Tamanho { largura, altura } => {
            *estado().tamanho.lock().unwrap() = (largura as i32, altura as i32);
            na_ui(|| com_host(|h| h.was_resized()));
        }
        Comando::Qps { valor } => na_ui(move || com_host(|h| h.set_windowless_frame_rate(valor as i32))),
        Comando::Batida => na_ui(|| com_host(|h| h.send_external_begin_frame())),
        Comando::PararDePintar => na_ui(|| com_host(|h| h.was_hidden(1))),
        Comando::Pedido { id, acao } => {
            let Some((Adiado(cb), url)) = estado().adiados.lock().unwrap().remove(&id) else {
                eprintln!("motor-captura: pedido {id} desconhecido");
                return;
            };
            match acao {
                AcaoDoPedido::Continuar => cb.cont(),
                AcaoDoPedido::Cancelar => cb.cancel(),
                AcaoDoPedido::Responder { status, tipo, cabecalhos, corpo } => match std::fs::read(&corpo) {
                    Ok(bytes) => {
                        let _ = std::fs::remove_file(&corpo);
                        let r = Resposta { status, tipo, cabecalhos, corpo: Arc::new(bytes) };
                        estado().prontas.lock().unwrap().entry(url).or_default().push_back(r);
                        cb.cont();
                    }
                    Err(erro) => {
                        eprintln!("motor-captura: corpo do pedido {id} ({corpo}): {erro}");
                        cb.cancel();
                    }
                },
            }
        }
        Comando::Sair => fechar(),
        // A janela de aquecimento da reserva quente (destroy() do Electron): fecha o navegador, o host continua.
        Comando::FecharJanela => na_ui(|| com_host(|h| h.close_browser(1))),
        Comando::Avaliar { id, codigo, url } => na_ui(move || avaliar(id, &codigo, url.as_deref())),
    }
}

/// Manda o código ao renderer do quadro (o principal, ou o iframe com essa URL); a resposta vem pelo
/// `on_process_message_received` do cliente (`motor_avaliado`, ver filho.rs).
fn avaliar(id: u64, codigo: &str, url: Option<&str>) {
    let falha = |texto: &str| emitir(&protocolo::evento_avaliado(id, false, texto));
    let Some(b) = NAVEGADOR.with(|n| n.borrow().clone()) else { return falha("navegador não aberto") };
    let quadro = match url {
        None => b.main_frame(),
        Some(u) => {
            let mut ids = CefStringList::new();
            b.frame_identifiers(Some(&mut ids));
            ids.into_iter()
                .filter_map(|i| b.frame_by_identifier(Some(&CefString::from(i.as_str()))))
                .find(|f| f.is_main() == 0 && texto_cef(&f.url()) == u)
        }
    };
    let Some(quadro) = quadro else { return falha(&format!("quadro não encontrado: {}", url.unwrap_or("principal"))) };
    let Some(mut m) = process_message_create(Some(&CefString::from("motor_avaliar"))) else { return falha("mensagem") };
    if let Some(a) = m.argument_list() {
        a.set_size(2);
        a.set_string(0, Some(&CefString::from(id.to_string().as_str())));
        a.set_string(1, Some(&CefString::from(codigo)));
    }
    quadro.send_process_message(ProcessId::RENDERER, Some(&mut m));
}

fn fechar() {
    SAINDO.store(true, Ordering::Relaxed);
    na_ui(|| {
        let mut aberto = false;
        com_host(|h| {
            aberto = true;
            h.close_browser(1);
        });
        if !aberto {
            quit_message_loop();
        }
    });
    // Se a UI não sair (paint seguro sem controlador), sai assim mesmo.
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(5));
        morrer("o CEF não fechou em 5 s");
    });
}

fn ler_comandos() {
    for linha in BufReader::new(std::io::stdin()).lines() {
        let Ok(linha) = linha else { break };
        if linha.trim().is_empty() {
            continue;
        }
        match Comando::de(&linha) {
            Ok(c) => executar(c),
            Err(erro) => morrer(&format!("comando: {erro}: {}", &linha[..linha.len().min(300)])),
        }
    }
    // stdin fechado: o controlador acabou (ou morreu).
    fechar();
}

fn ler_operacoes() {
    let caminho = std::env::var("MOTOR_CAPTURA_PEDIDOS").unwrap_or_default();
    let fifo = OpenOptions::new().read(true).write(true).open(&caminho).unwrap_or_else(|e| morrer(&format!("FIFO de pedidos {caminho}: {e}")));
    let e = estado();
    for linha in BufReader::new(fifo).lines() {
        let Ok(linha) = linha else { break };
        let op = Op::de(&linha).unwrap_or_else(|erro| morrer(&format!("operação: {erro}")));
        let ui = |m: ParaUi| {
            let _ = e.para_ui.lock().unwrap().send(m);
        };
        match op {
            #[cfg(not(feature = "placa"))]
            Op::SoNaPlaca => responder(&json!({ "erro": protocolo::SEM_PLACA })),
            #[cfg(feature = "placa")]
            Op::Motor(opcoes) => {
                let r = nucleo::Motor::new(opcoes);
                match r {
                    Ok(m) => {
                        *e.motor.lock().unwrap() = Some(m);
                        responder(&json!({ "ok": true }));
                    }
                    Err(erro) => responder(&json!({ "erro": erro.reason })),
                }
            }
            Op::Marcado { id, alvo, conferir } => ui(ParaUi::Marcado { id, alvo, conferir }),
            Op::Liberar { id } => ui(ParaUi::Liberar(id)),
            Op::Navegar { id, permitir } => ui(ParaUi::Navegar { id, permitir }),
            #[cfg(feature = "placa")]
            Op::Repetir => {
                let motor = e.motor.lock().unwrap();
                responder(&match motor.as_ref().map(|m| m.repetir()) {
                    Some(Ok(())) => json!({ "ok": true }),
                    Some(Err(erro)) => json!({ "erro": erro.reason }),
                    None => json!({ "erro": "motor não aberto" }),
                });
            }
            #[cfg(feature = "placa")]
            Op::AbrirVideo(video) => {
                let motor = e.motor.lock().unwrap();
                responder(&match motor.as_ref().map(|m| m.abrir_video(video)) {
                    Some(Ok(k)) => json!({ "ok": true, "video": k }),
                    Some(Err(erro)) => json!({ "erro": erro.reason }),
                    None => json!({ "erro": "motor não aberto" }),
                });
            }
            #[cfg(feature = "placa")]
            Op::Montar(montagem) => {
                let motor = e.motor.lock().unwrap();
                responder(&match motor.as_ref().map(|m| m.montar(montagem)) {
                    Some(Ok(())) => json!({ "ok": true }),
                    Some(Err(erro)) => json!({ "erro": erro.reason }),
                    None => json!({ "erro": "motor não aberto" }),
                });
            }
            #[cfg(feature = "placa")]
            Op::Fechar => {
                let motor = e.motor.lock().unwrap().take();
                responder(&match motor.map(|mut m| m.fechar()) {
                    Some(Ok(r)) => json!({ "resumo": protocolo::resumo_json(&r) }),
                    Some(Err(erro)) => json!({ "erro": erro.reason }),
                    None => json!({ "erro": "motor já fechado" }),
                });
            }
        }
    }
}

fn abrir_rw(var: &str) -> File {
    let caminho = std::env::var(var).unwrap_or_else(|_| morrer(&format!("falta {var}")));
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(var == "MOTOR_CAPTURA_QUADRO")
        .truncate(false)
        .open(&caminho)
        .unwrap_or_else(|e| morrer(&format!("{var} ({caminho}): {e}")))
}

fn main() {
    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);
    let args = args::Args::new();
    // Por garantia: se o CEF chamar este executável como filho (não deveria, há o browser_subprocess_path).
    let mut app = Aplicacao::new();
    let codigo = execute_process(Some(args.as_main_args()), Some(&mut app), std::ptr::null_mut());
    if codigo >= 0 {
        sair_ja(codigo);
    }

    // Eventos num fd próprio: o stdout dos processos do Chromium (que o herdam) vai para o stderr.
    let eventos = unsafe {
        let fd = dup(1);
        if fd < 0 || dup2(2, 1) < 0 {
            morrer("dup do stdout");
        }
        File::from_raw_fd(fd)
    };
    let (para_ui, da_ui) = mpsc::channel();
    let depurar = std::env::var("MOTOR_DEPURAR").as_deref() == Ok("1");
    let _ = ESTADO.set(Estado {
        eventos: Mutex::new(eventos),
        respostas: Mutex::new(abrir_rw("MOTOR_CAPTURA_RESPOSTAS")),
        quadro: abrir_rw("MOTOR_CAPTURA_QUADRO"),
        #[cfg(feature = "placa")]
        motor: Mutex::new(None),
        para_ui: Mutex::new(para_ui),
        da_ui: Mutex::new(da_ui),
        adiados: Mutex::new(HashMap::new()),
        prontas: Mutex::new(HashMap::new()),
        tamanho: Mutex::new((1920, 1096)),
        proximo: AtomicU64::new(1),
        fora_do_tamanho: AtomicU64::new(0),
        carregando: Mutex::new(None),
        depurar,
    });

    let exe = std::env::current_exe().unwrap_or_else(|e| morrer(&format!("current_exe: {e}")));
    let pasta = exe.parent().unwrap_or_else(|| morrer("pasta do executável")).to_path_buf();
    let filho = pasta.join("motor-captura-filho");
    let cache = std::env::var("MOTOR_CAPTURA_CACHE").unwrap_or_else(|_| morrer("falta MOTOR_CAPTURA_CACHE"));
    let ajustes = Settings {
        windowless_rendering_enabled: 1,
        // Sem o sandbox do Chromium, como o Electron (--no-sandbox): o sandbox pede o chrome-sandbox do root ou um
        // perfil do AppArmor (adr.md, seção 3). MOTOR_CAPTURA_SANDBOX=1 tenta ligá-lo (experimento do P02).
        no_sandbox: (std::env::var("MOTOR_CAPTURA_SANDBOX").as_deref() != Ok("1")) as i32,
        browser_subprocess_path: CefString::from(filho.to_string_lossy().as_ref()),
        resources_dir_path: CefString::from(pasta.to_string_lossy().as_ref()),
        locales_dir_path: CefString::from(pasta.join("locales").to_string_lossy().as_ref()),
        // Perfil em memória (cache_path vazio), como a partição sem «persist:» do Electron.
        root_cache_path: CefString::from(cache.as_str()),
        log_severity: if depurar { LogSeverity::WARNING } else { LogSeverity::ERROR },
        ..Default::default()
    };
    let mut app = Aplicacao::new();
    if initialize(Some(args.as_main_args()), Some(&ajustes), Some(&mut app), std::ptr::null_mut()) != 1 {
        morrer("CefInitialize falhou");
    }
    run_message_loop();
    shutdown();
    emitir(&json!({ "evento": "fim" }));
    sair_ja(0);
}
