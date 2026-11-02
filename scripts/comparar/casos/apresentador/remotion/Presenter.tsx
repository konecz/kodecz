// Comparison case «presenter», Remotion version. Written by Konecz against Remotion's public API; Remotion itself is
// not part of Kodecz (its license is not Apache-2.0): ../../../comparar.sh installs it at run time into the work
// folder, outside this repository. The same composition as ../kodecz/index.html: same CSS, same times; the CSS
// animations of that page are computed here from the frame number with the same cubic-bezier curves.
import { Video } from '@remotion/media';
import { AbsoluteFill, Composition, Easing, interpolate, registerRoot, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

type Line = { start: number; end: number; words: [string, number][] };
const CAPTIONS: Line[] = [
  { start: 0.3, end: 1.9, words: [['Este', 0.3], ['apresentador', 0.6], ['é', 1.2], ['sintético', 1.4]] },
  { start: 1.9, end: 3.4, words: [['a', 1.9], ['legenda', 2.1], ['entra', 2.5], ['palavra', 2.8], ['por', 3.0], ['palavra', 3.1]] },
  { start: 3.4, end: 4.9, words: [['e', 3.4], ['o', 3.5], ['som', 3.7], ['é', 4.0], ['um', 4.1], ['tom', 4.3], ['de', 4.5], ['teste', 4.6]] },
];

const CSS = `
  .p07a { background: #000; color: #fff; font-family: Inter, sans-serif; }
  .p07a .tarja { position: absolute; left: 80px; top: 690px; width: 600px; height: 120px; box-sizing: border-box;
           padding: 18px 32px; background: rgba(15, 21, 48, 0.9); border-left: 10px solid #ffb648; border-radius: 8px; }
  .p07a .tarja .nome { font-size: 44px; font-weight: 700; }
  .p07a .tarja .cargo { font-size: 26px; color: #c9d4f2; margin-top: 4px; }
  .p07a .trecho { position: absolute; left: 0; right: 0; top: 860px; text-align: center; opacity: 0; }
  .p07a .caixa { display: inline-block; padding: 16px 32px; border-radius: 16px; background: rgba(0, 0, 0, 0.6);
           font-size: 56px; font-weight: 700; }
  .p07a .palavra { opacity: 0.45; }
  .p07a .palavra + .palavra { margin-left: 0.3em; }
`;

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.42, 0, 1, 1);
/** Progress 0..1 between `start` and `start + dur`, clamped at both ends (the `fill: both` of a CSS animation). */
const progress = (t: number, start: number, dur: number, easing: (x: number) => number) =>
  interpolate(t, [start, start + dur], [0, 1], { easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
/** From `start` (inclusive) to `end` (exclusive): an animation without fill. */
const active = (t: number, start: number, end: number) => t >= start - 1e-9 && t < end - 1e-9;

const Presenter: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const enter = progress(t, 0.5, 0.6, EASE_OUT), leave = progress(t, 4.3, 0.4, EASE_IN);
  const lowerThird = t >= 4.3 - 1e-9
    ? { opacity: 1 - leave, transform: `translateX(${-600 * leave}px)` }
    : { opacity: enter, transform: `translateX(${-600 * (1 - enter)}px)` };
  return (
    <AbsoluteFill className="p07a">
      <style>{CSS}</style>
      <Video src={staticFile('apresentador.mp4')} style={{ width: 1920, height: 1080 }} />
      <div className="tarja" style={lowerThird}>
        <div className="nome">Apresentador sintético</div>
        <div className="cargo">P07 · gerado pelo ffmpeg, sem pessoa</div>
      </div>
      {CAPTIONS.map((line, i) => (
        <div key={i} className="trecho" style={active(t, line.start, line.end) ? { opacity: 1 } : undefined}>
          <span className="caixa">
            {line.words.map(([word, start], k) => {
              const next = line.words[k + 1]?.[1] ?? line.end;
              const style = {
                ...(active(t, start, line.end) ? { opacity: 1 } : {}),
                ...(active(t, start, next) ? { color: '#ffd84a' } : {}),
              };
              return <span key={k} className="palavra" style={style}>{word}</span>;
            })}
          </span>
        </div>
      ))}
    </AbsoluteFill>
  );
};

registerRoot(() => (
  <Composition id="Presenter" component={Presenter} durationInFrames={150} width={1920} height={1080} fps={30} />
));
