// Kodecz shim for porting a Remotion project while keeping its React components.
//
// Original code written for Kodecz (Apache-2.0) from the behaviour described in Remotion's public API docs.
// No Remotion code is copied or imported. Kodecz is not affiliated with Remotion.
//
// Usage: copy this file into the project, change `from "remotion"` imports to `from "./remotion-shim.js"`, bundle
// the entry with any bundler (no CDN at render time) and call mount() once. Each frame Kodecz calls
// window.kodecz_frame(n), which re-renders the tree synchronously at frame n.
import { createElement as h, createContext, useContext } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

const Frame = createContext({ frame: 0, config: null });

/** Mounts `Component` in #root and hands frame control to Kodecz. `config` is the page's JSON block. */
export function mount(Component, props = {}, element = document.getElementById("root")) {
  const block = JSON.parse(document.getElementById("kodecz").textContent);
  const config = { id: block.id, width: block.width, height: block.height, fps: block.fps, durationInFrames: block.frames };
  const root = createRoot(element);
  const draw = (frame) => flushSync(() => root.render(h(Frame.Provider, { value: { frame, config } }, h(Component, props))));
  draw(0); // the first frame is in the DOM before the page finishes loading
  window.kodecz_frame = (n) => draw(n);
}

export const useCurrentFrame = () => useContext(Frame).frame;
export const useVideoConfig = () => useContext(Frame).config;

/** Shows children from `from` for `durationInFrames`; inside, useCurrentFrame() counts from 0. */
export function Sequence({ from = 0, durationInFrames = Infinity, layout = "absolute-fill", style, children }) {
  const parent = useContext(Frame);
  const frame = parent.frame - from;
  if (frame < 0 || frame >= durationInFrames) return null;
  const inner = h(Frame.Provider, { value: { ...parent, frame } }, children);
  return layout === "none" ? inner : h(AbsoluteFill, { style }, inner);
}

/** Children of <Series> are <Sequence durationInFrames offset?> placed one after the other. */
export function Series({ children }) {
  let start = 0;
  const list = [].concat(children).filter(Boolean).map((child, i) => {
    const { durationInFrames, offset = 0, ...rest } = child.props;
    start += offset;
    const el = h(Sequence, { key: i, ...rest, from: start, durationInFrames });
    start += durationInFrames;
    return el;
  });
  return h(AbsoluteFill, null, list);
}
Series.Sequence = Sequence;

/** Repeats children every `durationInFrames`, `times` times (default: forever). */
export function Loop({ durationInFrames, times = Infinity, children }) {
  const parent = useContext(Frame);
  if (parent.frame >= durationInFrames * times) return null;
  return h(Frame.Provider, { value: { ...parent, frame: parent.frame % durationInFrames } }, children);
}

/** Holds children at `frame`. */
export function Freeze({ frame, children }) {
  const parent = useContext(Frame);
  return h(Frame.Provider, { value: { ...parent, frame } }, children);
}

export function AbsoluteFill({ style, children, ...rest }) {
  return h("div", {
    ...rest,
    style: { position: "absolute", inset: 0, width: "100%", height: "100%", display: "flex", flexDirection: "column", ...style },
  }, children);
}

export const Img = (props) => h("img", props);

/** Files from Remotion's public/ go next to index.html; the path becomes relative. */
export const staticFile = (path) => path.replace(/^\/+/, "");

/**
 * Maps `input` from `inputRange` to `outputRange` (piecewise linear, ranges ascending and the same length).
 * extrapolateLeft / extrapolateRight: "extend" (default), "clamp" or "identity"; `easing` receives the 0..1 progress.
 */
export function interpolate(input, inputRange, outputRange, options = {}) {
  const { easing = (t) => t, extrapolateLeft = "extend", extrapolateRight = "extend" } = options;
  let i = 1;
  while (i < inputRange.length - 1 && input > inputRange[i]) i++;
  const [a, b] = [inputRange[i - 1], inputRange[i]];
  let t = b === a ? 1 : (input - a) / (b - a);
  if (t < 0) {
    if (extrapolateLeft === "identity") return input;
    if (extrapolateLeft === "clamp") t = 0;
  } else if (t > 1) {
    if (extrapolateRight === "identity") return input;
    if (extrapolateRight === "clamp") t = 1;
  }
  return outputRange[i - 1] + easing(t) * (outputRange[i] - outputRange[i - 1]);
}

/**
 * Damped spring from `from` to `to` (a closed-form mass-spring-damper, starting at rest), at `frame` / `fps`
 * seconds after `delay` frames. Close to Remotion's spring(); compare a few frames with a still before trusting it.
 */
export function spring({ frame, fps, config = {}, from = 0, to = 1, delay = 0 }) {
  const { damping = 10, mass = 1, stiffness = 100, overshootClamping = false } = config;
  const t = Math.max(0, frame - delay) / fps;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  let x;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  } else if (zeta === 1) {
    x = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s), r2 = -w0 * (zeta + s);
    x = 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  }
  if (overshootClamping) x = Math.min(x, 1);
  return from + (to - from) * x;
}

/** Seeded random in [0, 1): the same seed gives the same number on every frame. */
export function random(seed) {
  let s = 0;
  for (const c of String(seed)) s = (Math.imul(s, 31) + c.charCodeAt(0)) | 0;
  s = (s + 0x6d2b79f5) | 0;
  let r = Math.imul(s ^ (s >>> 15), 1 | s);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

/** CSS easing string `linear(...)` that follows spring() over `frames` frames, for @keyframes or animate(). */
export function springEasing({ fps, frames, config }) {
  const points = [];
  for (let f = 0; f <= frames; f++) points.push(+spring({ frame: f, fps, config }).toFixed(4));
  return `linear(${points.join(", ")})`;
}
