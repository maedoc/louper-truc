/* louper-truc — audio engine & playback loop */
import { s, clamp, clampViewStart, INTERACTION_TIMEOUT_MS } from './state.js';
import { draw, drawOverlay } from './waveform.js';

export function initAudio() {
  if (!s.audioCtx) s.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (s.audioCtx.state === 'suspended') s.audioCtx.resume();
  if (!s.audioEl) {
    s.audioEl = document.getElementById('audioPlayer');
    if ('preservesPitch' in s.audioEl) s.audioEl.preservesPitch = true;
    else if ('webkitPreservesPitch' in s.audioEl) s.audioEl.webkitPreservesPitch = true;
    else if ('mozPreservesPitch' in s.audioEl) s.audioEl.mozPreservesPitch = true;
    s.audioEl.addEventListener('ended', () => {
      s.isPlaying = false;
      s.pauseOffset = 0;
      s.audioEl.currentTime = 0;
      updatePlayBtn();
      cancelRaf();
      drawOverlay();
    });
  }
}

export function getCurrentTime() {
  if (!s.audioEl) return s.pauseOffset;
  return s.audioEl.currentTime;
}

export function stopInternal() {
  if (s.audioEl) s.audioEl.pause();
}

export function seek(t) {
  t = clamp(t, 0, s.duration);
  if (s.audioEl) s.audioEl.currentTime = t;
  if (!s.isPlaying) s.pauseOffset = t;
  s.cuePoint = t;
}

export function togglePlay(startTime) {
  initAudio();
  if (s.isPlaying) {
    s.audioEl.pause();
    s.isPlaying = false;
    s.pauseOffset = s.audioEl.currentTime;
    cancelRaf();
  } else {
    if (s.loopOn && (startTime < s.loopStart || startTime >= s.loopEnd)) {
      s.audioEl.currentTime = s.loopStart;
    } else {
      s.audioEl.currentTime = startTime !== undefined ? startTime : s.cuePoint;
    }
    s.audioEl.playbackRate = s.playSpeed;
    s.audioEl.play().catch(() => {});
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
  if (s.audioEl) s.audioEl.playbackRate = s.playSpeed;
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
    s.audioEl.currentTime = s.loopStart;
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
