/* louper-truc — waveform renderer */
import { s, clamp, timeToX, BLOCK } from './state.js';
import { getCurrentTime } from './audio.js';

let canvas, ctx;
let overlayCanvas, overlayCtx;

const cache = {};

function cssVar(name) {
  if (cache._theme === document.documentElement.dataset.theme) return cache[name];
  cache._theme = document.documentElement.dataset.theme;
  const st = getComputedStyle(document.documentElement);
  cache['--waveform-bg'] = st.getPropertyValue('--waveform-bg').trim();
  cache['--waveform-fg'] = st.getPropertyValue('--waveform-fg').trim();
  cache['--loop-fill-on'] = st.getPropertyValue('--loop-fill-on').trim();
  cache['--loop-fill-off'] = st.getPropertyValue('--loop-fill-off').trim();
  cache['--loop-stroke-on'] = st.getPropertyValue('--loop-stroke-on').trim();
  cache['--loop-stroke-off'] = st.getPropertyValue('--loop-stroke-off').trim();
  cache['--cue-stroke'] = st.getPropertyValue('--cue-stroke').trim();
  cache['--playhead-stroke'] = st.getPropertyValue('--playhead-stroke').trim();
  return cache[name];
}

export function init(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d', { alpha: false });
  overlayCanvas = document.getElementById('overlayCanvas');
  overlayCtx = overlayCanvas.getContext('2d');
}

export function resizeCanvases() {
  canvas.width = Math.round(s.cssW * s.dpr);
  canvas.height = Math.round(s.cssH * s.dpr);
  canvas.style.width = s.cssW + 'px';
  canvas.style.height = s.cssH + 'px';
  overlayCanvas.width = Math.round(s.cssW * s.dpr);
  overlayCanvas.height = Math.round(s.cssH * s.dpr);
  overlayCanvas.style.width = s.cssW + 'px';
  overlayCanvas.style.height = s.cssH + 'px';
}

export function draw() {
  if (!s.cssW || !s.cssH) return;
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.fillStyle = cssVar('--waveform-bg');
  ctx.fillRect(0, 0, s.cssW, s.cssH);
  if (!s.peaks || !s.duration) {
    drawOverlay();
    return;
  }

  const yMid = s.cssH / 2;
  const yScale = s.cssH * 0.45;
  const secPerBlock = BLOCK / s.sampleRate;

  const b0 = Math.floor(s.viewStart / secPerBlock);
  const b1 = Math.ceil((s.viewStart + s.cssW / s.zoom) / secPerBlock);
  const lo = clamp(b0, 0, s.peaks.length / 2 - 1);
  const hi = clamp(b1, 0, s.peaks.length / 2 - 1);

  ctx.fillStyle = cssVar('--waveform-fg');
  for (let i = lo; i <= hi; i++) {
    const t = i * secPerBlock;
    const x = timeToX(t);
    const x2 = timeToX(t + secPerBlock);
    const w = Math.max(1, x2 - x - 0.5);
    const y1 = yMid - s.peaks[i * 2 + 1] * yScale;
    const y2 = yMid - s.peaks[i * 2] * yScale;
    ctx.fillRect(x, y1, w, Math.max(1, y2 - y1));
  }

  if ((s.loopOn || s.interaction === 'selecting') && s.loopEnd > s.loopStart) {
    const sx = timeToX(s.loopStart);
    const ex = timeToX(s.loopEnd);
    ctx.fillStyle = s.loopOn ? cssVar('--loop-fill-on') : cssVar('--loop-fill-off');
    ctx.fillRect(sx, 0, ex - sx, s.cssH);
    ctx.strokeStyle = s.loopOn ? cssVar('--loop-stroke-on') : cssVar('--loop-stroke-off');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, s.cssH);
    ctx.moveTo(ex, 0);
    ctx.lineTo(ex, s.cssH);
    ctx.stroke();
  }

  drawOverlay();
}

export function drawOverlay() {
  if (!overlayCtx || !s.cssW || !s.cssH) return;
  overlayCtx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  overlayCtx.clearRect(0, 0, s.cssW, s.cssH);
  if (!s.peaks || !s.duration) return;

  const cx = timeToX(s.cuePoint);
  overlayCtx.strokeStyle = cssVar('--cue-stroke');
  overlayCtx.lineWidth = 1.5;
  overlayCtx.setLineDash([4, 4]);
  overlayCtx.beginPath();
  overlayCtx.moveTo(cx, 0);
  overlayCtx.lineTo(cx, s.cssH);
  overlayCtx.stroke();
  overlayCtx.setLineDash([]);

  const t = s.isPlaying ? getCurrentTime() : s.pauseOffset;
  const px = timeToX(t);
  overlayCtx.strokeStyle = cssVar('--playhead-stroke');
  overlayCtx.lineWidth = 2;
  overlayCtx.beginPath();
  overlayCtx.moveTo(px, 0);
  overlayCtx.lineTo(px, s.cssH);
  overlayCtx.stroke();
}

export function computePeaks() {
  const n = s.buffer.getChannelData(0).length;
  const blocks = Math.ceil(n / BLOCK);
  const channels = s.buffer.numberOfChannels;
  s.peaks = new Float32Array(blocks * 2);
  for (let i = 0; i < blocks; i++) {
    let min = 1,
      max = -1;
    const a = i * BLOCK;
    const b = Math.min(a + BLOCK, n);
    for (let c = 0; c < channels; c++) {
      const ch = s.buffer.getChannelData(c);
      for (let j = a; j < b; j++) {
        const v = ch[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    s.peaks[i * 2] = min;
    s.peaks[i * 2 + 1] = max;
  }
}

export function updateZoomUI() {
  const el = document.getElementById('zoomCtrl');
  el.value = s.zoom;
  el.max = Math.max(100, Math.ceil(s.zoom * 10));
}
