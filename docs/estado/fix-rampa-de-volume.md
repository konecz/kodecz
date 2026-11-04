# fix/rampa-de-volume (checkpoint; apagado antes do PR)

Defeito: volume por pontos ia no `volume=…:eval=frame`, avaliado uma vez por bloco de ~1024 amostras: rampa em
degraus, estalo no degrau.

Plano e estado:
- [x] Teste do estalo (`composicao/audio.test.ts`, «rampa por amostra»): falhava (salto 1072 contra 168 do seno).
- [x] Correção: envelope mono `aevalsrc` (reta entre os quadros, árvore de `if(lt(t,…))`) passado a estéreo e
  multiplicado (`amultiply`) à trilha. `aeval` nos dois canais custava o dobro; `aeval` com `c=same` cai no ffmpeg 8.0.
- [x] Testes da régua do Remotion: fixo igual; por quadro, conferido amostra a amostra contra a reta.
- [x] Doc `docs/formatos/linha-do-tempo.md` («Variable volume»).
- [ ] `./verificar.sh` e `./verificar.sh completo`.
