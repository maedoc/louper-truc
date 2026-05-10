import { s, clamp, clampViewStart, INTERACTION_TIMEOUT_MS } from './state.js';
import { draw, drawOverlay } from './waveform.js';

function killSource() {
  if (s.sourceNode) {
    try { s.sourceNode.stop(); } catch { /* already stopped */ }
    try { s.sourceNode.disconnect(); } catch { /* not connected */ }
    s.sourceNode = null;
  }
}

function startSource(offset) {
  if (!s.buffer || !s.audioCtx) return;
  killSource();
  const node = s.audioCtx.createBufferSource();
  node.buffer = s.buffer;
  node.playbackRate.value = s.playSpeed;
  node.connect(s.audioCtx.destination);
  node.onended = () => {
    if (s.sourceNode !== node) return;
    if (s.isPlaying) {
      s.isPlaying = false;
      s.pauseOffset = 0;
      s.cuePoint = 0;
      updatePlayBtn();
      cancelRaf();
      drawOverlay();
    }
  };
  s.sourceNode = node;
  s.playStartOffset = offset;
  s.playStartTime = s.audioCtx.currentTime;
  node.start(0, offset);
}

export async function initAudio() {
  if (!s.audioCtx) s.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (s.audioCtx.state === 'suspended') await s.audioCtx.resume();
}

export function getCurrentTime() {
  if (!s.isPlaying || !s.audioCtx) return s.pauseOffset;
  const elapsed = (s.audioCtx.currentTime - s.playStartTime) * s.playSpeed;
  return s.playStartOffset + elapsed;
}

export function stopInternal() {
  killSource();
  s.isPlaying = false;
}

export function seek(t) {
  t = clamp(t, 0, s.duration);
  if (s.isPlaying) {
    startSource(t);
  }
  s.pauseOffset = t;
  s.cuePoint = t;
}

export async function togglePlay(startTime) {
  await initAudio();
  if (s.isPlaying) {
    s.pauseOffset = getCurrentTime();
    killSource();
    s.isPlaying = false;
    cancelRaf();
  } else {
    if (!s.buffer) return;
    let offset = startTime !== undefined ? startTime : s.cuePoint;
    if (s.loopOn && (offset < s.loopStart || offset >= s.loopEnd)) {
      offset = s.loopStart;
    }
    startSource(offset);
    s.isPlaying = true;
    s.lastInteractionTime = 0;
    startRaf();
  }
  updatePlayBtn();
}

export function updatePlayBtn() {
  document.getElementById('btnPlay').textContent = s.isPlaying ? 'Pause' : 'Play';
}

export function updateSpeed(val) {
  s.playSpeed = parseFloat(val) || 1;
  if (s.sourceNode) s.sourceNode.playbackRate.value = s.playSpeed;
  const btns = document.querySelectorAll('#speedBtns button');
  btns.forEach((b) => b.classList.toggle('active', parseFloat(b.dataset.speed) === s.playSpeed));
}

export function toggleLoop() {
  s.loopOn = !s.loopOn;
  document.getElementById('btnLoop').textContent = 'Loop: ' + (s.loopOn ? 'on' : 'off');
  draw();
}

export function startRaf() {
  if (!s.raf) s.raf = requestAnimationFrame(tick);
  requestWakeLock();
}
export function cancelRaf() {
  if (s.raf) {
    cancelAnimationFrame(s.raf);
    s.raf = 0;
  }
  releaseWakeLock();
}

function tick() {
  if (!s.isPlaying) return;
  const now = performance.now();
  const interacting = now - s.lastInteractionTime < INTERACTION_TIMEOUT_MS;
  const t = getCurrentTime();
  if (s.loopOn && t >= s.loopEnd - 1 / s.sampleRate) {
    startSource(s.loopStart);
  }
  if (t >= s.duration) {
    killSource();
    s.isPlaying = false;
    s.pauseOffset = 0;
    s.cuePoint = 0;
    updatePlayBtn();
    cancelRaf();
    drawOverlay();
    return;
  }
  if (!interacting && s.autoFollow && s.zoom > s.cssW / s.duration) {
    const viewDur = s.cssW / s.zoom;
    const loopVisible =
      s.loopOn &&
      s.loopEnd - s.loopStart <= viewDur &&
      s.viewStart <= s.loopStart &&
      s.viewStart + viewDur >= s.loopEnd;
    if (!loopVisible) {
      const targetX = s.cssW * 0.75;
      const px = (t - s.viewStart) * s.zoom;
      if (px > targetX || px < s.cssW * 0.1) {
        s.viewStart = clampViewStart(t - targetX / s.zoom);
        draw();
      }
    }
  }
  document.getElementById('scrub').value = t;
  drawOverlay();
  s.raf = requestAnimationFrame(tick);
}

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && s.isPlaying) requestWakeLock();
});
