// O libcef.so e os recursos do CEF ficam ao lado dos executáveis (o cef-dll-sys os copia para target/release):
// o rpath $ORIGIN acha a biblioteca sem LD_LIBRARY_PATH, e o CEF acha o icudtl.dat na pasta de onde ela carregou.
fn main() {
    println!("cargo::rustc-link-arg-bins=-Wl,-rpath,$ORIGIN");
    println!("cargo::rerun-if-changed=build.rs");
}
