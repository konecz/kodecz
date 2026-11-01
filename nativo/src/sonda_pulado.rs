// C01: sondas do NVENC, não rodam nos testes normais (`cargo test --release -- --ignored sonda_ --nocapture`).
// Degrau 1: o NVENC aceita «quadro pulado» como tipo de entrada? Degrau 2: sem a decisão de tipo (PTD), o POC do
// fluxo segue o `displayPOCSyntax` (para abrir espaço aos quadros «skip» escritos por nós)?
use cudarc::driver::CudaContext;
use nvidia_video_codec_sdk::sys::nvEncodeAPI::*;
use nvidia_video_codec_sdk::{CodecPictureParams, EncodePictureParams, Encoder, EncoderInitParams};
use std::io::Write;
use std::time::Instant;

const L: u32 = 1920;
const A: u32 = 1080;

fn sondar(codec: GUID, nome: &str, quadros: &[(NV_ENC_PIC_TYPE, u32)]) {
    let cuda = CudaContext::new(0).expect("cuda");
    let encoder = Encoder::initialize_with_cuda(cuda).expect("encoder");
    let p = NV_ENC_PRESET_P4_GUID;
    let afinacao = NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_HIGH_QUALITY;
    let mut config = encoder
        .get_preset_config(codec, p, afinacao)
        .expect("preset")
        .presetCfg;
    config.frameIntervalP = 1;
    config.gopLength = NVENC_INFINITE_GOPLENGTH;
    // Escrever num campo de union não pede unsafe.
    if codec == NV_ENC_CODEC_H264_GUID {
        config.encodeCodecConfig.h264Config.idrPeriod = NVENC_INFINITE_GOPLENGTH;
    } else {
        config.encodeCodecConfig.hevcConfig.idrPeriod = NVENC_INFINITE_GOPLENGTH;
    }
    let mut inicio = EncoderInitParams::new(codec, L, A);
    // Sem PTD: o tipo do quadro vem de nós (é o único jeito de pedir NV_ENC_PIC_TYPE_SKIPPED).
    inicio
        .preset_guid(p)
        .tuning_info(afinacao)
        .framerate(30, 1)
        .encode_config(&mut config);
    let sessao = encoder
        .start_session(NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB, inicio)
        .expect("sessão");
    let mut entrada = sessao.create_input_buffer().expect("entrada");
    let mut fluxo = sessao.create_output_bitstream().expect("saída");
    let caminho = std::env::temp_dir().join(format!("sonda-{nome}"));
    let mut arq = std::fs::File::create(&caminho).expect("arquivo");
    for (n, (tipo, poc)) in quadros.iter().enumerate() {
        let conteudo: Vec<u8> = (0..A)
            .flat_map(|y| {
                (0..L).flat_map(move |x| {
                    [(x ^ y) as u8, (x / 7 + n as u32) as u8, (y / 5) as u8, 255]
                })
            })
            .collect();
        unsafe { entrada.lock().expect("lock").write(&conteudo) };
        let t0 = Instant::now();
        let r = sessao.encode_picture(
            &mut entrada,
            &mut fluxo,
            EncodePictureParams {
                input_timestamp: n as u64,
                picture_type: *tipo,
                codec_params: Some(if codec == NV_ENC_CODEC_H264_GUID {
                    CodecPictureParams::H264(NV_ENC_PIC_PARAMS_H264 {
                        displayPOCSyntax: *poc,
                        refPicFlag: 1,
                        ..Default::default()
                    })
                } else {
                    CodecPictureParams::Hevc(NV_ENC_PIC_PARAMS_HEVC {
                        displayPOCSyntax: *poc,
                        refPicFlag: 1,
                        ..Default::default()
                    })
                }),
            },
        );
        match r {
            Ok(()) => {
                let trava = fluxo.lock().expect("lock do fluxo");
                arq.write_all(trava.data()).unwrap();
                eprintln!(
                    "{nome} quadro {n}: pedido {tipo:?} poc {poc} → saiu {:?}, {} bytes, {:.3} ms",
                    trava.picture_type(),
                    trava.data().len(),
                    t0.elapsed().as_secs_f64() * 1e3
                );
            }
            Err(e) => eprintln!("{nome} quadro {n}: pedido {tipo:?} → erro {e:?}"),
        }
    }
    eprintln!("{nome}: fluxo em {}", caminho.display());
}

use NV_ENC_PIC_TYPE::*;

/// Degrau 1. No HEVC, o SKIPPED trava a chamada do NVENC (não volta; visto em 2026-10-30), então só o H.264 roda.
#[test]
#[ignore]
fn sonda_pulado() {
    let q = [
        (NV_ENC_PIC_TYPE_IDR, 0),
        (NV_ENC_PIC_TYPE_P, 2),
        (NV_ENC_PIC_TYPE_P, 4),
        (NV_ENC_PIC_TYPE_SKIPPED, 6),
        (NV_ENC_PIC_TYPE_SKIPPED, 8),
        (NV_ENC_PIC_TYPE_P, 10),
    ];
    sondar(NV_ENC_CODEC_H264_GUID, "pulado.h264", &q);
}

/// Degrau 2: POC com buraco (os quadros 3 e 4 seriam os «skip» escritos por nós) e IDR no meio.
#[test]
#[ignore]
fn sonda_poc() {
    let q = |m: u32| {
        [
            (NV_ENC_PIC_TYPE_IDR, 0),
            (NV_ENC_PIC_TYPE_P, m),
            (NV_ENC_PIC_TYPE_P, 2 * m),
            (NV_ENC_PIC_TYPE_P, 5 * m),
            (NV_ENC_PIC_TYPE_P, 6 * m),
            (NV_ENC_PIC_TYPE_IDR, 7 * m),
            (NV_ENC_PIC_TYPE_P, 8 * m),
            (NV_ENC_PIC_TYPE_P, 300 * m),
        ]
    };
    sondar(NV_ENC_CODEC_H264_GUID, "poc.h264", &q(2));
    sondar(NV_ENC_CODEC_HEVC_GUID, "poc.hevc", &q(1));
}
