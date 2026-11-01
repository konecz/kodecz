# Rust crates

Every crate resolved for `x86_64-unknown-linux-gnu` in `nativo/Cargo.lock` and `captura/cef/Cargo.lock` (direct and
indirect), with the license declared in its manifest. None is vendored in this repository: Cargo downloads them when
you build. Generated from `cargo metadata --offline --locked --format-version 1 --filter-platform
x86_64-unknown-linux-gnu` in each folder; regenerate when a lockfile changes. If a compiled binary is ever
distributed, ship the full license text of each crate with it (for example with `cargo about`).

155 crates.

| Crate | Version | License | Used by |
|---|---|---|---|
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | captura/cef |
| aho-corasick | 1.1.5 | Unlicense OR MIT | captura/cef |
| anstream | 1.0.0 | MIT OR Apache-2.0 | captura/cef |
| anstyle | 1.0.14 | MIT OR Apache-2.0 | captura/cef |
| anstyle-parse | 1.0.0 | MIT OR Apache-2.0 | captura/cef |
| anstyle-query | 1.1.5 | MIT OR Apache-2.0 | captura/cef |
| anyhow | 1.0.104 | MIT OR Apache-2.0 | captura/cef |
| ash | 0.38.0+1.3.281 | MIT OR Apache-2.0 | captura/cef, nativo |
| autocfg | 1.5.1 | Apache-2.0 OR MIT | captura/cef |
| base64 | 0.23.1 | MIT OR Apache-2.0 | captura/cef |
| bitflags | 2.13.2 | MIT OR Apache-2.0 | captura/cef, nativo |
| bytes | 1.12.1 | MIT | captura/cef |
| bzip2 | 0.6.1 | MIT OR Apache-2.0 | captura/cef |
| cc | 1.10.0 | MIT OR Apache-2.0 | captura/cef |
| cef | 156.2.0+156.0.14 | Apache-2.0 OR MIT | captura/cef |
| cef-dll-sys | 156.2.0+156.0.14 | Apache-2.0 OR MIT | captura/cef |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 | captura/cef, nativo |
| clap | 4.6.7 | MIT OR Apache-2.0 | captura/cef |
| clap_builder | 4.6.7 | MIT OR Apache-2.0 | captura/cef |
| clap_derive | 4.6.7 | MIT OR Apache-2.0 | captura/cef |
| clap_lex | 1.1.1 | MIT OR Apache-2.0 | captura/cef |
| cmake | 0.1.58 | MIT OR Apache-2.0 | captura/cef |
| colorchoice | 1.0.5 | MIT OR Apache-2.0 | captura/cef |
| console | 0.16.6 | MIT | captura/cef |
| convert_case | 0.12.0 | MIT | captura/cef, nativo |
| cookie | 0.18.2 | MIT OR Apache-2.0 | captura/cef |
| cookie_store | 0.22.1 | MIT OR Apache-2.0 | captura/cef |
| crc32fast | 1.5.3 | MIT OR Apache-2.0 | captura/cef |
| ctor | 1.0.13 | Apache-2.0 OR MIT | captura/cef, nativo |
| cudarc | 0.16.6 | MIT OR Apache-2.0 | captura/cef, nativo |
| deranged | 0.5.9 | MIT OR Apache-2.0 | captura/cef |
| displaydoc | 0.2.7 | MIT OR Apache-2.0 | captura/cef |
| document-features | 0.2.12 | MIT OR Apache-2.0 | captura/cef |
| download-cef | 3.0.0 | Apache-2.0 OR MIT | captura/cef |
| equivalent | 1.0.3 | Apache-2.0 OR MIT | captura/cef |
| errno | 0.3.14 | MIT OR Apache-2.0 | captura/cef |
| filetime | 0.2.29 | MIT/Apache-2.0 | captura/cef |
| find-msvc-tools | 0.1.15 | MIT OR Apache-2.0 | captura/cef |
| flate2 | 1.1.10 | MIT OR Apache-2.0 | captura/cef |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 | captura/cef |
| fs-err | 3.3.2 | MIT OR Apache-2.0 | captura/cef |
| futures | 0.3.34 | MIT OR Apache-2.0 | captura/cef, nativo |
| futures-channel | 0.3.34 | MIT OR Apache-2.0 | captura/cef, nativo |
| futures-core | 0.3.34 | MIT OR Apache-2.0 | captura/cef, nativo |
| futures-executor | 0.3.34 | MIT OR Apache-2.0 | captura/cef, nativo |
| futures-io | 0.3.34 | MIT OR Apache-2.0 | captura/cef, nativo |
| futures-macro | 0.3.34 | MIT OR Apache-2.0 | captura/cef, nativo |
| futures-sink | 0.3.34 | MIT OR Apache-2.0 | captura/cef, nativo |
| futures-task | 0.3.34 | MIT OR Apache-2.0 | captura/cef, nativo |
| futures-util | 0.3.34 | MIT OR Apache-2.0 | captura/cef, nativo |
| getrandom | 0.2.17 | MIT OR Apache-2.0 | captura/cef |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 | captura/cef |
| heck | 0.5.0 | MIT OR Apache-2.0 | captura/cef |
| http | 1.5.0 | MIT OR Apache-2.0 | captura/cef |
| httparse | 1.10.1 | MIT OR Apache-2.0 | captura/cef |
| icu_collections | 2.4.0 | Unicode-3.0 | captura/cef |
| icu_locale_core | 2.4.0 | Unicode-3.0 | captura/cef |
| icu_normalizer | 2.4.0 | Unicode-3.0 | captura/cef |
| icu_normalizer_data | 2.4.0 | Unicode-3.0 | captura/cef |
| icu_properties | 2.4.0 | Unicode-3.0 | captura/cef |
| icu_properties_data | 2.4.0 | Unicode-3.0 | captura/cef |
| icu_provider | 2.4.0 | Unicode-3.0 | captura/cef |
| idna | 1.1.0 | MIT OR Apache-2.0 | captura/cef |
| idna_adapter | 1.2.2 | Apache-2.0 OR MIT | captura/cef |
| indexmap | 2.14.2 | Apache-2.0 OR MIT | captura/cef |
| indicatif | 0.18.6 | MIT | captura/cef |
| is_terminal_polyfill | 1.70.2 | MIT OR Apache-2.0 | captura/cef |
| itoa | 1.0.18 | MIT OR Apache-2.0 | captura/cef |
| lazy_static | 1.5.1 | MIT OR Apache-2.0 | captura/cef, nativo |
| libbz2-rs-sys | 0.2.6 | bzip2-1.0.6 | captura/cef |
| libc | 0.2.191 | MIT OR Apache-2.0 | captura/cef, nativo |
| libloading | 0.8.9 | ISC | captura/cef, nativo |
| libloading | 0.9.0 | ISC | captura/cef, nativo |
| linux-raw-sys | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | captura/cef |
| litemap | 0.8.3 | Unicode-3.0 | captura/cef |
| litrs | 1.0.1 | MIT OR Apache-2.0 | captura/cef |
| log | 0.4.34 | MIT OR Apache-2.0 | captura/cef |
| memchr | 2.8.3 | Unlicense OR MIT | captura/cef, nativo |
| miniz_oxide | 0.9.1 | MIT OR Zlib OR Apache-2.0 | captura/cef |
| napi | 3.15.0 | MIT | nativo |
| napi | 3.16.0 | MIT | captura/cef |
| napi-build | 2.6.0 | MIT | captura/cef, nativo |
| napi-derive | 3.6.13 | MIT | nativo |
| napi-derive | 3.7.0 | MIT | captura/cef |
| napi-derive-backend | 6.1.6 | MIT | nativo |
| napi-derive-backend | 7.0.0 | MIT | captura/cef |
| napi-sys | 3.4.1 | MIT | captura/cef, nativo |
| nohash-hasher | 0.2.0 | Apache-2.0 OR MIT | captura/cef, nativo |
| num-conv | 0.2.2 | MIT OR Apache-2.0 | captura/cef |
| nvidia-video-codec-sdk | 0.4.0 | MIT | captura/cef, nativo |
| once_cell | 1.21.4 | MIT OR Apache-2.0 | captura/cef |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 | captura/cef |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT | captura/cef, nativo |
| portable-atomic | 1.15.0 | Apache-2.0 OR MIT | captura/cef |
| potential_utf | 0.1.6 | Unicode-3.0 | captura/cef |
| powerfmt | 0.2.1 | MIT OR Apache-2.0 | captura/cef |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 | captura/cef, nativo |
| quote | 1.0.47 | MIT OR Apache-2.0 | captura/cef, nativo |
| regex | 1.13.1 | MIT OR Apache-2.0 | captura/cef |
| regex-automata | 0.4.18 | MIT OR Apache-2.0 | captura/cef |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 | captura/cef |
| ring | 0.17.14 | Apache-2.0 AND ISC | captura/cef |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT | captura/cef, nativo |
| rustix | 1.1.6 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | captura/cef |
| rustls | 0.23.46 | Apache-2.0 OR ISC OR MIT | captura/cef |
| rustls-pki-types | 1.15.1 | MIT OR Apache-2.0 | captura/cef |
| rustls-webpki | 0.103.16 | ISC | captura/cef |
| semver | 1.0.28 | MIT OR Apache-2.0 | captura/cef, nativo |
| serde | 1.0.229 | MIT OR Apache-2.0 | captura/cef |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | captura/cef |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 | captura/cef |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | captura/cef |
| sha1_smol | 1.0.1 | BSD-3-Clause | captura/cef |
| shlex | 2.0.1 | MIT OR Apache-2.0 | captura/cef |
| simd-adler32 | 0.3.10 | MIT | captura/cef |
| slab | 0.4.12 | MIT | captura/cef, nativo |
| smallvec | 1.16.4 | MIT OR Apache-2.0 | captura/cef |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 | captura/cef |
| strsim | 0.11.1 | MIT | captura/cef |
| subtle | 2.6.1 | BSD-3-Clause | captura/cef |
| syn | 3.0.9 | MIT OR Apache-2.0 | captura/cef, nativo |
| synstructure | 0.14.0 | MIT | captura/cef |
| tar | 0.4.46 | MIT OR Apache-2.0 | captura/cef |
| thiserror | 2.0.21 | MIT OR Apache-2.0 | captura/cef |
| thiserror-impl | 2.0.21 | MIT OR Apache-2.0 | captura/cef |
| time | 0.3.55 | MIT OR Apache-2.0 | captura/cef |
| time-core | 0.1.9 | MIT OR Apache-2.0 | captura/cef |
| time-macros | 0.2.32 | MIT OR Apache-2.0 | captura/cef |
| tinystr | 0.8.5 | Unicode-3.0 | captura/cef |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | captura/cef, nativo |
| unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 | captura/cef, nativo |
| unicode-width | 0.2.3 | MIT OR Apache-2.0 | captura/cef |
| unit-prefix | 0.5.2 | MIT | captura/cef |
| untrusted | 0.9.0 | ISC | captura/cef |
| ureq | 3.5.0 | MIT OR Apache-2.0 | captura/cef |
| ureq-proto | 0.6.5 | MIT OR Apache-2.0 | captura/cef |
| url | 2.5.8 | MIT OR Apache-2.0 | captura/cef |
| utf8-zero | 0.8.1 | MIT OR Apache-2.0 | captura/cef |
| utf8_iter | 1.1.0 | Apache-2.0 OR MIT | captura/cef |
| utf8parse | 0.2.2 | Apache-2.0 OR MIT | captura/cef |
| utf_types | 1.0.0 | Apache-2.0 OR MIT | captura/cef |
| version_check | 0.9.5 | MIT/Apache-2.0 | captura/cef |
| webpki-roots | 1.0.11 | CDLA-Permissive-2.0 | captura/cef |
| writeable | 0.6.4 | Unicode-3.0 | captura/cef |
| xattr | 1.7.0 | MIT OR Apache-2.0 | captura/cef |
| yoke | 0.8.4 | Unicode-3.0 | captura/cef |
| yoke-derive | 0.8.4 | Unicode-3.0 | captura/cef |
| zerofrom | 0.1.8 | Unicode-3.0 | captura/cef |
| zerofrom-derive | 0.1.8 | Unicode-3.0 | captura/cef |
| zeroize | 1.9.1 | Apache-2.0 OR MIT | captura/cef |
| zerotrie | 0.2.5 | Unicode-3.0 | captura/cef |
| zerovec | 0.11.9 | Unicode-3.0 | captura/cef |
| zerovec-derive | 0.11.7 | Unicode-3.0 | captura/cef |
| zlib-rs | 0.6.8 | Zlib | captura/cef |
| zmij | 1.0.23 | MIT | captura/cef |
