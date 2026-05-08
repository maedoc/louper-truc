/* louper-truc — audio engine & playback loop */
import {
  s, clamp, clampViewStart,
  PLAYBACK_END_THRESHOLD, INTERACTION_TIMEOUT_MS, AUTO_FOLLOW_MARGIN,
} from './state.js';
import { draw, drawOverlay } from './waveform.js';

export function initAudio() {
  if (!s.audioCtx) s.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (s.audioCtx.state === 'suspended') s.audioCtx.resume();
}

export function getCurrentTime() {
  if (!s.isPlaying) return s.pauseOffset;
  return s.playOffset + (s.audioCtx.currentTime - s.playStartTime) * s.playSpeed;
}

function playInternal(offsetSec) {
  if (!s.buffer || !s.audioCtx) return;
  stopInternal();
  s.sourceNode = s.audioCtx.createBufferSource();
  s.sourceNode.buffer = s.buffer;
  s.sourceNode.playbackRate.value = s.playSpeed;
  s.sourceNode.connect(s.audioCtx.destination);
  s.playStartTime = s.audioCtx.currentTime;
  s.playOffset = offsetSec;
  s.sourceNode.start(0, offsetSec);
  s.sourceNode.onended = () => {
    if (s.stoppingManually) { s.stoppingManually = false; return; }
    if (s.isPlaying && getCurrentTime() >= s.duration - PLAYBACK_END_THRESHOLD) {
      s.isPlaying = false;
      s.pauseOffset = 0;
      updatePlayBtn();
      cancelRaf();
    }
  };
}

export function stopInternal() {
  if (s.sourceNode) {
    s.stoppingManually = true;
    try { s.sourceNode.stop(); } catch (_e) { /* already stopped */ }
    try { s.sourceNode.disconnect(); } catch (_e) { /* already disconnected */ }
    s.sourceNode = null;
  }
}

export function seek(t) {
  t = clamp(t, 0, s.duration);
  if (s.isPlaying) {
    stopInternal();
    playInternal(t);
  } else {
    s.pauseOffset = t;
  }
}

export function togglePlay(startTime) {
  initAudio();
  if (s.isPlaying) {
    s.pauseOffset = getCurrentTime();
    stopInternal();
    s.isPlaying = false;
    cancelRaf();
  } else {
    let t = startTime;
    if (s.loopOn && (t < s.loopStart || t >= s.loopEnd)) t = s.loopStart;
    playInternal(t);
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
  document.getElementById('speedVal').textContent = s.playSpeed.toFixed(2) + '\u00d7';
  if (s.isPlaying) {
    const t = getCurrentTime();
    stopInternal();
    playInternal(t);
  }
}

export function toggleLoop() {
  s.loopOn = !s.loopOn;
  document.getElementById('btnLoop').textContent = 'Loop: ' + (s.loopOn ? 'on' : 'off');
  draw();
}

export function startRaf() { if (!s.raf) s.raf = requestAnimationFrame(tick); }
export function cancelRaf() { if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; } }

function tick() {
  if (!s.isPlaying) return;
  const now = performance.now();
  const interacting = (now - s.lastInteractionTime) < INTERACTION_TIMEOUT_MS;
  const t = getCurrentTime();
  if (s.loopOn && t >= s.loopEnd - (1 / s.sampleRate)) {
    seek(s.loopStart);
  }
  if (!interacting && s.autoFollow && s.zoom > s.cssW / s.duration) {
    const margin = s.cssW * AUTO_FOLLOW_MARGIN;
    const px = timeToX(t);
    if (px > s.cssW - margin) {
      s.viewStart = clampViewStart(t - margin / s.zoom);
      draw();
    } else if (px < margin) {
      s.viewStart = clampViewStart(t - (s.cssW - margin) / s.zoom);
      draw();
    }
  }
  document.getElementById('scrub').value = t;
  drawOverlay();
  s.raf = requestAnimationFrame(tick);
}

function timeToX(t) { return (t - s.viewStart) * s.zoom; }
