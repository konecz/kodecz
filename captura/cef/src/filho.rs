//! Processos filhos do CEF (renderer, GPU, rede, utilitários): executável à parte do host (`browser_subprocess_path`),
//! para que os filhos não carreguem o núcleo do M02 nem o NVENC (ressalva da prova do P02, degrau 11).
//!
//! No renderer, o `executeJavaScript` do Electron sem o CDP: o host manda a mensagem `motor_avaliar` [id, código] ao
//! quadro; aqui o código roda no contexto principal do quadro (`CefV8Context::Eval`, o valor final do script como no
//! `eval`), a promessa é esperada e o valor volta em JSON na mensagem `motor_avaliado` [id, ok, texto]. Antes, pelo
//! `Runtime.evaluate`, cada quadro passava pelo inspetor do renderer (P02, perfil da CPU).

use cef::*;
use serde_json::{Map, Value};

const PROFUNDIDADE: usize = 64;

/// O valor do V8 em JSON, como o `returnByValue`: `undefined` e função somem dos objetos (e viram null na lista).
fn json(v: &V8Value, profundidade: usize) -> Option<Value> {
    if profundidade > PROFUNDIDADE || v.is_undefined() != 0 || v.is_function() != 0 {
        return None;
    }
    Some(if v.is_null() != 0 {
        Value::Null
    } else if v.is_bool() != 0 {
        Value::Bool(v.bool_value() != 0)
    } else if v.is_int() != 0 {
        Value::from(v.int_value())
    } else if v.is_double() != 0 || v.is_uint() != 0 {
        let d = v.double_value();
        serde_json::Number::from_f64(d).map(Value::Number).unwrap_or(Value::Null)
    } else if v.is_string() != 0 {
        Value::String(CefString::from(&v.string_value()).to_string())
    } else if v.is_array() != 0 {
        Value::Array(
            (0..v.array_length())
                .map(|i| v.value_byindex(i).and_then(|x| json(&x, profundidade + 1)).unwrap_or(Value::Null))
                .collect(),
        )
    } else if v.is_object() != 0 {
        let mut chaves = CefStringList::new();
        v.keys(Some(&mut chaves));
        let mut m = Map::new();
        for k in chaves {
            if let Some(x) = v.value_bykey(Some(&CefString::from(k.as_str()))).and_then(|x| json(&x, profundidade + 1)) {
                m.insert(k, x);
            }
        }
        Value::Object(m)
    } else {
        return None;
    })
}

/// Texto de um erro como o Electron o mostra («Error: mensagem»).
fn texto_do_erro(v: &V8Value) -> String {
    if v.is_object() != 0 {
        let campo = |k: &str| v.value_bykey(Some(&CefString::from(k))).filter(|x| x.is_string() != 0)
            .map(|x| CefString::from(&x.string_value()).to_string());
        if let Some(m) = campo("message") {
            return match campo("name") { Some(n) if !n.is_empty() => format!("{n}: {m}"), _ => m };
        }
    }
    if v.is_string() != 0 {
        return CefString::from(&v.string_value()).to_string();
    }
    json(v, 0).map(|x| x.to_string()).unwrap_or_else(|| "erro sem valor".into())
}

fn responder(quadro: &Frame, id: &str, ok: bool, texto: &str) {
    let Some(mut m) = process_message_create(Some(&CefString::from("motor_avaliado"))) else { return };
    if let Some(a) = m.argument_list() {
        a.set_size(3);
        a.set_string(0, Some(&CefString::from(id)));
        a.set_bool(1, ok as i32);
        a.set_string(2, Some(&CefString::from(texto)));
    }
    quadro.send_process_message(ProcessId::BROWSER, Some(&mut m));
}

fn valor_ou_vazio(v: Option<&V8Value>) -> String {
    // Sem valor (undefined): texto vazio, que o controlador lê como undefined.
    v.and_then(|x| json(x, 0)).map(|x| x.to_string()).unwrap_or_default()
}

wrap_v8_handler! {
    struct Desfecho {
        quadro: Frame,
        id: String,
        ok: bool,
    }

    impl V8Handler {
        fn execute(&self, _name: Option<&CefString>, _object: Option<&mut V8Value>, arguments: Option<&[Option<V8Value>]>,
            _retval: Option<&mut Option<V8Value>>, _exception: Option<&mut CefString>) -> ::std::os::raw::c_int {
            let v = arguments.and_then(|a| a.first()).and_then(|x| x.as_ref());
            if self.ok {
                responder(&self.quadro, &self.id, true, &valor_ou_vazio(v));
            } else {
                responder(&self.quadro, &self.id, false, &v.map(texto_do_erro).unwrap_or_else(|| "promessa recusada".into()));
            }
            1
        }
    }
}

fn avaliar(quadro: &Frame, id: &str, codigo: &str) {
    let Some(ctx) = quadro.v8_context() else {
        responder(quadro, id, false, "o quadro não tem contexto de JavaScript");
        return;
    };
    if ctx.enter() == 0 {
        responder(quadro, id, false, "não entrou no contexto do quadro");
        return;
    }
    let mut ret: Option<V8Value> = None;
    let mut exc: Option<V8Exception> = None;
    ctx.eval(Some(&CefString::from(codigo)), Some(&CefString::from("")), 0, Some(&mut ret), Some(&mut exc));
    if let Some(e) = exc {
        let m = CefString::from(&e.message()).to_string();
        responder(quadro, id, false, m.strip_prefix("Uncaught ").unwrap_or(&m));
    } else if let Some(r) = ret.as_ref().filter(|r| r.is_promise() != 0) {
        // A promessa: then(ok, falha) com funções nossas, que respondem quando ela assentar.
        let mut ok = v8_value_create_function(Some(&CefString::from("motor_ok")),
            Some(&mut Desfecho::new(quadro.clone(), id.to_owned(), true)));
        let mut falha = v8_value_create_function(Some(&CefString::from("motor_falha")),
            Some(&mut Desfecho::new(quadro.clone(), id.to_owned(), false)));
        let entao = r.value_bykey(Some(&CefString::from("then")));
        match entao {
            Some(t) if t.is_function() != 0 => {
                let mut alvo = r.clone();
                let args = [ok.take(), falha.take()];
                if t.execute_function(Some(&mut alvo), Some(&args)).is_none() {
                    responder(quadro, id, false, "then da promessa falhou");
                }
            }
            _ => responder(quadro, id, false, "promessa sem then"),
        }
    } else {
        responder(quadro, id, true, &valor_ou_vazio(ret.as_ref()));
    }
    ctx.exit();
}

wrap_render_process_handler! {
    struct Renderizador;

    impl RenderProcessHandler {
        fn on_process_message_received(&self, _browser: Option<&mut Browser>, frame: Option<&mut Frame>, _source_process: ProcessId,
            message: Option<&mut ProcessMessage>) -> ::std::os::raw::c_int {
            let (Some(quadro), Some(m)) = (frame, message) else { return 0 };
            if CefString::from(&m.name()).to_string() != "motor_avaliar" {
                return 0;
            }
            let Some(a) = m.argument_list() else { return 0 };
            let id = CefString::from(&a.string(0)).to_string();
            let codigo = CefString::from(&a.string(1)).to_string();
            avaliar(quadro, &id, &codigo);
            1
        }
    }
}

wrap_app! {
    struct Filho;

    impl App {
        fn render_process_handler(&self) -> Option<RenderProcessHandler> {
            Some(Renderizador::new())
        }
    }
}

fn main() {
    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);
    let args = args::Args::new();
    let mut app = Filho::new();
    let codigo = execute_process(Some(args.as_main_args()), Some(&mut app), std::ptr::null_mut());
    std::process::exit(codigo.max(0));
}
