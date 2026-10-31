# Patents and video codecs

*Research by Konecz, 2026-10-31. This is our reading of public sources, not legal advice.*

## What Kodecz does and does not contain

- Kodecz contains **no implementation of a video codec**. Encoding happens in the NVENC block of the user's NVIDIA
  GPU (through the driver) or in the `ffmpeg` installed on the user's system, which Kodecz runs as a separate
  process and does not ship.
- Kodecz ships source code under Apache-2.0. Apache-2.0 grants the contributors' own patents. It cannot grant
  third-party patents, such as the patents essential to H.264 and HEVC.

## The pools

- **H.264/AVC:** licensed by the Via LA AVC pool (formerly MPEG LA). Via LA charges no royalty for "Internet
  Broadcast AVC Video", meaning video distributed to end users over the internet for free. Encoder and decoder
  products sold to end users fall under its "Codec Manufacture and Sales" terms. The remaining H.264 patents run out
  country by country: reportedly the last major US patent around November 2027 and the last Brazilian one around
  November 2030.
- **HEVC:** licensed mainly by Access Advance (HEVC Advance, plus the former Via LA HEVC/VVC program, now VCL
  Advance). It has no free tier comparable to AVC's free internet video.
- **NVIDIA:** the Video Codec SDK license grants rights to the SDK only, and explicitly no patent rights for audio
  or video encoders and decoders.

## Our position

1. **Distributing Kodecz's source is low risk.** It is the same position as other open-source projects that drive a
   hardware or system encoder without shipping one (OBS Studio, HandBrake and others). No pool targets source code
   that contains no codec.
2. **Whoever ships a product or sells a service that outputs H.264 or HEVC answers for that use.** This applies to
   us too, when Konecz uses Kodecz commercially. The README says so plainly.
3. **H.264 is the default** (`--hevc` is opt-in). AVC's free-internet-video exemption covers the common case, and
   its patents expire soonest.
4. **Future:** AV1 output (NVENC supports it on RTX 40 and newer) has royalty-free licensing from AOMedia. It is the
   natural codec to add when someone asks.

## Sources

- Via LA, AVC/H.264 license fees: https://www.via-la.com/licensing-2/avc-h-264/avc-h-264-license-fees
- MPEG LA, royalty-free internet broadcast AVC video (2010): https://us.design-reuse.com/news/24238/internet-broadcast-avc-video.html
- H.264 patent expiry, Brazil (community-maintained): https://meta.wikimedia.org/wiki/Have_the_patents_for_H.264_MPEG-4_AVC_expired_yet%3F
- H.264 patent expiry, US: https://pclosmag.com/html/Issues/202608/page08.html
- Access Advance and the HEVC pools: https://design-reuse.com/news/news51166.html
- NVIDIA Video Codec SDK license: https://developer.nvidia.com/nvidia-video-codec-sdk-license-agreement
