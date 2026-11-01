//! O núcleo do M02 é compilado com o napi em `noop` (sem Node). Mesmo assim, o `napi::Error` deixa referências a
//! funções do Node nos caminhos que só existem com um `napi_env` (converter o erro em valor do JS, soltar a
//! referência). Aqui elas existem só para ligar: o host nunca tem um `napi_env`, e qualquer chamada devolve
//! `napi_generic_failure` (9). Os argumentos são ignorados (ABI do C no x86-64: quem chama limpa a pilha).

macro_rules! sem_node {
    ($($nome:ident),* $(,)?) => {
        $(
            #[unsafe(no_mangle)]
            pub extern "C" fn $nome() -> i32 {
                9
            }
        )*
    };
}

sem_node!(
    napi_create_error,
    napi_create_string_utf8,
    napi_delete_reference,
    napi_get_and_clear_last_exception,
    napi_get_named_property,
    napi_get_reference_value,
    napi_is_error,
    napi_is_exception_pending,
    napi_reference_unref,
    napi_set_named_property,
    napi_throw,
);
