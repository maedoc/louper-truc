/* louper-truc — waveform looper & transcription assistant */
'use strict';

const BLOCK = 64; // samples per peak block

/* ---------- state ---------- */
let audioCtx = null;
let buffer = null;
let peaks = null;            // Float32Array interleaved [min0,max0,min1,max1,...]
let sampleRate = 44100;
let duration = 0;

let zoom = 1;                // CSS pixels per second
let viewStart = 0;           // seconds
let cssW = 0, cssH = 0, dpr = 1;

let isPlaying = false;
let playSpeed = 1;
let playStartTime = 0;       // audioCtx.currentTime when source started
let playOffset = 0;          // buffer offset when source started
let pauseOffset = 0;         // buffer time when paused

let cuePoint = 0;
let loopOn = false;
let loopStart = 0;
let loopEnd = 0;

let state = 'idle';          // idle | idle-down | panning | selecting | pinching
let pointer = {};
let pinch = {};
let longPressTimer = null;
let lastInteractionTime = 0;
let autoFollow = true;
let raf = 0;

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const canvas = $('waveform');
const ctx = canvas.getContext('2d', { alpha: false });
const dropzone = $('dropzone');
const overlay = $('overlay');
const zoomHint = $('zoomHint');
const scrub = $('scrub');

/* ---------- utils ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = t => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
};
const timeToX = t => (t - viewStart) * zoom;
const xToTime = x => viewStart + x / zoom;

/* ---------- resize / DPR ---------- */
function resize() {
  const r = dropzone.getBoundingClientRect();
  cssW = r.width;
  cssH = r.height;
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  draw();
}
window.addEventListener('resize', resize);

/* ---------- audio ---------- */
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

let sourceNode = null;

function getCurrentTime() {
  if (!isPlaying) return pauseOffset;
  return playOffset + (audioCtx.currentTime - playStartTime) * playSpeed;
}

function playInternal(offsetSec) {
  if (!buffer || !audioCtx) return;
  stopInternal();
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = buffer;
  sourceNode.playbackRate.value = playSpeed;
  sourceNode.connect(audioCtx.destination);
  playStartTime = audioCtx.currentTime;
  playOffset = offsetSec;
  sourceNode.start(0, offsetSec);
  sourceNode.onended = () => {
    if (isPlaying && getCurrentTime() >= duration - 0.05) {
      isPlaying = false;
      pauseOffset = 0;
      updatePlayBtn();
    }
  };
}

function stopInternal() {
  if (sourceNode) {
    try { sourceNode.stop(); } catch (e) {}
    try { sourceNode.disconnect(); } catch (e) {}
    sourceNode = null;
  }
}

function seek(t) {
  t = clamp(t, 0, duration);
  if (isPlaying) {
    stopInternal();
    playInternal(t);
  } else {
    pauseOffset = t;
  }
}

function togglePlay() {
  initAudio();
  if (isPlaying) {
    pauseOffset = getCurrentTime();
    stopInternal();
    isPlaying = false;
  } else {
    let t = pauseOffset;
    if (loopOn && (t < loopStart || t >= loopEnd)) t = loopStart;
    playInternal(t);
    isPlaying = true;
    lastInteractionTime = 0;
  }
  updatePlayBtn();
}

function togglePlayFromCue() {
  initAudio();
  if (isPlaying) {
    pauseOffset = getCurrentTime();
    stopInternal();
    isPlaying = false;
  } else {
    let t = cuePoint;
    if (loopOn && (t < loopStart || t >= loopEnd)) t = loopStart;
    playInternal(t);
    isPlaying = true;
    lastInteractionTime = 0;
  }
  updatePlayBtn();
}

function updatePlayBtn() { $('btnPlay').textContent = isPlaying ? 'Pause' : 'Play'; }

function updateSpeed(val) {
  playSpeed = parseFloat(val);
  $('speedVal').textContent = playSpeed.toFixed(2) + '×';
  if (isPlaying) {
    const t = getCurrentTime();
    stopInternal();
    playInternal(t);
  }
}

function toggleLoop() {
  loopOn = !loopOn;
  $('btnLoop').textContent = 'Loop: ' + (loopOn ? 'on' : 'off');
  draw();
}

/* ---------- load ---------- */
async function loadArrayBuffer(ab, name) {
  initAudio();
  const decoded = await audioCtx.decodeAudioData(ab.slice(0));
  buffer = decoded;
  sampleRate = buffer.sampleRate;
  duration = buffer.duration;
  computePeaks();
  cuePoint = 0;
  loopStart = 0;
  loopEnd = duration;
  pauseOffset = 0;
  loopOn = false;
  viewStart = 0;
  zoom = cssW / duration;
  if (zoom < 1) zoom = 1;
  $('zoomCtrl').value = zoom;
  $('zoomCtrl').max = Math.max(100, Math.ceil(zoom * 10));
  $('scrub').max = duration;
  $('timeEnd').textContent = fmt(duration);
  setStatus(name);
  overlay.classList.add('hidden');
  zoomHint.classList.remove('hidden');
  draw();
}

function computePeaks() {
  const ch = buffer.getChannelData(0);
  const n = ch.length;
  const blocks = Math.ceil(n / BLOCK);
  peaks = new Float32Array(blocks * 2);
  for (let i = 0; i < blocks; i++) {
    let min = 1, max = -1;
    const a = i * BLOCK;
    const b = Math.min(a + BLOCK, n);
    for (let j = a; j < b; j++) {
      const v = ch[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }
}

/* ---------- draw ---------- */
function draw() {
  if (!cssW || !cssH) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0e1013';
  ctx.fillRect(0, 0, cssW, cssH);
  if (!peaks || !duration) return;

  const yMid = cssH / 2;
  const yScale = cssH * 0.45;
  const secPerBlock = BLOCK / sampleRate;

  const b0 = Math.floor(viewStart / secPerBlock);
  const b1 = Math.ceil((viewStart + cssW / zoom) / secPerBlock);
  const lo = clamp(b0, 0, peaks.length / 2 - 1);
  const hi = clamp(b1, 0, peaks.length / 2 - 1);

  ctx.fillStyle = '#6b7a8f';
  for (let i = lo; i <= hi; i++) {
    const t = i * secPerBlock;
    const x = timeToX(t);
    const x2 = timeToX(t + secPerBlock);
    const w = Math.max(1, x2 - x - 0.5);
    const y1 = yMid - peaks[i * 2 + 1] * yScale;
    const y2 = yMid - peaks[i * 2] * yScale;
    ctx.fillRect(x, y1, w, Math.max(1, y2 - y1));
  }

  /* selection / loop highlight */
  if ((loopOn || state === 'selecting') && loopEnd > loopStart) {
    const sx = timeToX(loopStart);
    const ex = timeToX(loopEnd);
    ctx.fillStyle = loopOn ? 'rgba(99,102,241,0.18)' : 'rgba(250,204,21,0.15)';
    ctx.fillRect(sx, 0, ex - sx, cssH);
    ctx.strokeStyle = loopOn ? '#818cf8' : '#facc15';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, 0); ctx.lineTo(sx, cssH);
    ctx.moveTo(ex, 0); ctx.lineTo(ex, cssH);
    ctx.stroke();
  }

  /* cue */
  const cx = timeToX(cuePoint);
  ctx.strokeStyle = '#f87171';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, cssH);
  ctx.stroke();
  ctx.setLineDash([]);

  /* playhead */
  const t = isPlaying ? getCurrentTime() : pauseOffset;
  const px = timeToX(t);
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, 0); ctx.lineTo(px, cssH);
  ctx.stroke();
}

/* ---------- rAF ---------- */
function tick() {
  const now = performance.now();
  const interacting = (now - lastInteractionTime) < 250;
  if (isPlaying) {
    const t = getCurrentTime();
    if (loopOn && t >= loopEnd - 0.005) {
      seek(loopStart);
    }
    if (!interacting && autoFollow && zoom > cssW / duration) {
      const margin = cssW * 0.15;
      const px = timeToX(t);
      if (px > cssW - margin) {
        viewStart = clamp(t - margin / zoom, 0, Math.max(0, duration - cssW / zoom));
        draw();
      } else if (px < margin) {
        viewStart = clamp(t - (cssW - margin) / zoom, 0, Math.max(0, duration - cssW / zoom));
        draw();
      }
    }
    scrub.value = t;
    draw();
  }
  raf = requestAnimationFrame(tick);
}

/* ---------- interactions ---------- */
const touches = new Map();

/* mouse */
canvas.addEventListener('mousedown', e => {
  console.log('[evt] mousedown button=', e.button, 'shift=', e.shiftKey, 'clientX=', e.clientX, 'stateBefore=', state);
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  pointer = { x0: x, time0: performance.now(), origView: viewStart };
  if (e.shiftKey) {
    state = 'selecting';
    const ti = xToTime(x);
    loopStart = ti; loopEnd = ti;
  } else if (e.button === 1 || e.button === 2) {
    state = 'panning';
    e.preventDefault();
  } else {
    state = 'idle-down';
  }
  lastInteractionTime = performance.now();
  console.log('[evt] mousedown -> state=', state);
});

window.addEventListener('mousemove', e => {
  if (state === 'idle') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const dx = x - pointer.x0;
  if (state === 'panning') {
    viewStart = clamp(pointer.origView - dx / zoom, 0, Math.max(0, duration - cssW / zoom));
    draw();
    lastInteractionTime = performance.now();
  } else if (state === 'selecting') {
    const ti = clamp(xToTime(x), 0, duration);
    if (ti >= loopStart) loopEnd = ti; else { loopEnd = loopStart; loopStart = ti; }
    draw();
    lastInteractionTime = performance.now();
  } else if (state === 'idle-down') {
    if (Math.abs(dx) > 4) { state = 'panning'; pointer.origView = viewStart; console.log('[evt] idle-down -> panning'); }
    lastInteractionTime = performance.now();
  }
});

window.addEventListener('mouseup', e => {
  console.log('[evt] mouseup stateBefore=', state, 'target=', e.target.id || e.target.tagName);
  if (state === 'idle') return;
  if (state === 'idle-down') {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    cuePoint = clamp(xToTime(x), 0, duration);
    seek(cuePoint);
    draw();
  } else if (state === 'selecting') {
    if (loopEnd - loopStart < 0.05) { loopStart = 0; loopEnd = 0; }
    else if (!loopOn) toggleLoop();
  }
  state = 'idle';
  lastInteractionTime = performance.now();
  console.log('[evt] mouseup -> state=idle');
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

/* wheel zoom */
canvas.addEventListener('wheel', e => {
  console.log('[evt] wheel deltaY=', e.deltaY);
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const t = xToTime(x);
  const factor = Math.exp(-e.deltaY * 0.002);
  zoom = clamp(zoom * factor, 1, 2000);
  viewStart = clamp(t - x / zoom, 0, Math.max(0, duration - cssW / zoom));
  $('zoomCtrl').value = zoom;
  $('zoomCtrl').max = Math.max(100, Math.ceil(zoom * 10));
  draw();
  lastInteractionTime = performance.now();
}, { passive: false });

/* double-tap zoom (mouse dblclick) */
canvas.addEventListener('dblclick', e => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const t = xToTime(x);
  zoom = clamp(zoom * 2, 1, 2000);
  viewStart = clamp(t - x / zoom, 0, Math.max(0, duration - cssW / zoom));
  $('zoomCtrl').value = zoom;
  $('zoomCtrl').max = Math.max(100, Math.ceil(zoom * 10));
  draw();
});

/* touch */
canvas.addEventListener('touchstart', e => {
  console.log('[evt] touchstart touches=', e.touches.length, 'stateBefore=', state);
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  if (e.touches.length === 2) {
    state = 'pinching';
    const t0 = e.touches[0], t1 = e.touches[1];
    const dx = t1.clientX - t0.clientX, dy = t1.clientY - t0.clientY;
    pinch.startDist = Math.hypot(dx, dy) || 1;
    pinch.startZoom = zoom;
    const cx = (t0.clientX + t1.clientX) / 2 - rect.left;
    pinch.centerTime = xToTime(cx);
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    return;
  }
  if (e.touches.length === 1) {
    const t = e.touches[0];
    const x = t.clientX - rect.left;
    const y = t.clientY - rect.top;
    touches.set(t.identifier, { x0: x, y0: y, origView: viewStart });
    state = 'idle-down';
    longPressTimer = setTimeout(() => {
      if (state === 'idle-down') {
        state = 'selecting';
        const ti = xToTime(x);
        loopStart = ti; loopEnd = ti;
        if (navigator.vibrate) navigator.vibrate(20);
        draw();
      }
    }, 450);
    lastInteractionTime = performance.now();
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  if (state === 'pinching' && e.touches.length === 2) {
    const t0 = e.touches[0], t1 = e.touches[1];
    const dx = t1.clientX - t0.clientX, dy = t1.clientY - t0.clientY;
    const dist = Math.hypot(dx, dy) || 1;
    const ratio = dist / pinch.startDist;
    zoom = clamp(pinch.startZoom * ratio, 1, 2000);
    const cx = (t0.clientX + t1.clientX) / 2 - rect.left;
    viewStart = clamp(pinch.centerTime - cx / zoom, 0, Math.max(0, duration - cssW / zoom));
    $('zoomCtrl').value = zoom;
    $('zoomCtrl').max = Math.max(100, Math.ceil(zoom * 10));
    draw();
    lastInteractionTime = performance.now();
    return;
  }
  if (e.touches.length === 1) {
    const t = e.touches[0];
    const x = t.clientX - rect.left;
    const touch = touches.get(t.identifier);
    if (!touch) return;
    const dx = x - touch.x0;
    if (state === 'idle-down') {
      if (Math.abs(dx) > 8) {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        state = 'panning';
        console.log('[evt] touch idle-down -> panning');
      }
    } else if (state === 'panning') {
      viewStart = clamp(touch.origView - dx / zoom, 0, Math.max(0, duration - cssW / zoom));
      draw();
    } else if (state === 'selecting') {
      const ti = clamp(xToTime(x), 0, duration);
      if (ti >= loopStart) loopEnd = ti; else { loopEnd = loopStart; loopStart = ti; }
      draw();
    }
    lastInteractionTime = performance.now();
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  console.log('[evt] touchend changedTouches=', e.changedTouches.length, 'stateBefore=', state);
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  if (e.touches.length === 0) {
    if (state === 'idle-down') {
      const ct = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const x = ct.clientX - rect.left;
      cuePoint = clamp(xToTime(x), 0, duration);
      seek(cuePoint);
      draw();
    } else if (state === 'selecting') {
      if (loopEnd - loopStart < 0.05) { loopStart = 0; loopEnd = 0; }
      else if (!loopOn) toggleLoop();
    }
    state = 'idle';
  } else if (e.touches.length === 1 && state === 'pinching') {
    const t = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = t.clientX - rect.left;
    touches.set(t.identifier, { x0: x, origView: viewStart });
    state = 'panning';
  }
  lastInteractionTime = performance.now();
});

canvas.addEventListener('touchcancel', e => {
  console.log('[evt] touchcancel stateBefore=', state);
  if (longPressTimer) clearTimeout(longPressTimer);
  state = 'idle';
});

/* ---------- drag & drop (old non-persisting handlers removed — persistence wired below) ---------- */
dropzone.addEventListener('dragover', e => { e.preventDefault(); canvas.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => canvas.classList.remove('dragover'));

$('btnLoad').addEventListener('click', () => $('fileInput').click());

$('btnPlay').addEventListener('click', togglePlay);
$('btnLoop').addEventListener('click', toggleLoop);
$('btnResetZoom').addEventListener('click', () => {
  zoom = cssW / duration || 1;
  if (zoom < 1) zoom = 1;
  viewStart = 0;
  $('zoomCtrl').value = zoom;
  $('zoomCtrl').max = Math.max(100, Math.ceil(zoom * 10));
  draw();
});
$('speedCtrl').addEventListener('input', e => updateSpeed(e.target.value));
$('zoomCtrl').addEventListener('input', e => {
  const newZoom = parseFloat(e.target.value);
  const center = viewStart + (cssW / 2) / zoom;
  zoom = newZoom;
  viewStart = clamp(center - (cssW / 2) / zoom, 0, Math.max(0, duration - cssW / zoom));
  draw();
});
scrub.addEventListener('input', e => { seek(parseFloat(e.target.value)); draw(); });

/* ---------- demo ---------- */
$('btnDemo').addEventListener('click', async () => {
  setStatus('Loading demo…');
  try {
    const r = await fetch('demo.ogg');
    if (!r.ok) throw new Error('local');
    await loadArrayBuffer(await r.arrayBuffer(), 'King Oliver — Krooked Blues (1923)');
  } catch {
    setStatus('Demo failed. Drop your own file.');
  }
});

function setStatus(msg) { $('status').innerHTML = `<span class="pill">${msg}</span>`; }

/* ---------- safety resets ---------- */
window.addEventListener('blur', () => {
  console.log('[evt] window blur -> forcing state=idle');
  state = 'idle';
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});
document.addEventListener('mouseleave', () => {
  console.log('[evt] document mouseleave -> forcing state=idle');
  state = 'idle';
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});

/* ---------- keyboard ---------- */
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') {
    e.preventDefault();
    togglePlayFromCue();
  }
});

/* ---------- track catalog ---------- */
const BUNDLED_TRACKS = [
  { id:'b1',  file:'assets/tracks/01_Bloomdido.ogg',           name:'Bloomdido' },
  { id:'b2',  file:'assets/tracks/02_My_Melancholy_Baby.ogg',    name:'My Melancholy Baby' },
  { id:'b3',  file:'assets/tracks/03_Relaxin_with_Lee.ogg',      name:'Relaxin\' with Lee' },
  { id:'b4',  file:'assets/tracks/04_Leap_Frog.ogg',             name:'Leap Frog' },
  { id:'b5',  file:'assets/tracks/05_An_Oscar_for_Treadwell.ogg', name:'An Oscar for Treadwell' },
  { id:'b6',  file:'assets/tracks/06_Mohawk.ogg',                name:'Mohawk' },
  { id:'b7',  file:'assets/tracks/07_My_Melancholy_Baby_Complete.ogg', name:'My Melancholy Baby (complete)' },
  { id:'b8',  file:'assets/tracks/08_Relaxin_with_Lee_Complete.ogg',   name:'Relaxin\' with Lee (complete)' },
  { id:'b9',  file:'assets/tracks/09_Leap_Frog_Complete.ogg',    name:'Leap Frog (complete)' },
  { id:'b10', file:'assets/tracks/10_Leap_Frog_Complete_2.ogg',  name:'Leap Frog (complete take 2)' },
  { id:'b11', file:'assets/tracks/11_Leap_Frog_Complete_3.ogg',  name:'Leap Frog (complete take 3)' },
  { id:'b12', file:'assets/tracks/12_Oscar_for_Treadwell_Complete.ogg', name:'Oscar for Treadwell (complete)' },
  { id:'b13', file:'assets/tracks/13_Mohawk_Complete.ogg',       name:'Mohawk (complete)' },
  { id:'b14', file:'assets/tracks/14_A_Night_In_Tunisia.ogg',    name:'A Night in Tunisia' },
  { id:'b15', file:'assets/tracks/15_Blues_For_Alice_Alt.ogg',   name:'Blues for Alice (alt take)' },
  { id:'b16', file:'assets/tracks/16_Blues_For_Alice.ogg',       name:'Blues for Alice' },
  { id:'b17', file:'assets/tracks/17_All_Blues.ogg',             name:'All Blues' },
  { id:'b18', file:'assets/tracks/18_Half_Nelson.ogg',           name:'Half Nelson' },
  { id:'b19', file:'assets/tracks/19_Airegin.ogg',               name:'Airegin' },
  { id:'b20', file:'assets/tracks/20_Moments_Notice.ogg',        name:'Moment\'s Notice' }
];

/* ---------- IndexedDB persistence ---------- */
const DB_NAME = 'louper_truc_db';
const DB_VER  = 1;
const STORE   = 'tracks';
const LAST_KEY= '__last_track__';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveTrack(id, name, arrayBuffer) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const s  = tx.objectStore(STORE);
  s.put({ id, name, data: arrayBuffer, savedAt: Date.now() });
  s.put({ id: LAST_KEY, lastId: id, name, savedAt: Date.now() });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function loadTrack(id) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const s  = tx.objectStore(STORE);
  return new Promise((resolve, reject) => {
    const r = s.get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror     = e => reject(e.target.error);
  });
}

async function getSavedIds() {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const s  = tx.objectStore(STORE);
  return new Promise((resolve, reject) => {
    const r = s.getAllKeys();
    r.onsuccess = () => resolve(r.result.filter(k => k !== LAST_KEY));
    r.onerror   = e => reject(e.target.error);
  });
}

async function getLastTrackMeta() {
  return await loadTrack(LAST_KEY);
}

/* ---------- track list UI ---------- */
function populateSelects() {
  const opts = [`<option disabled selected>Choose a track…</option>`];
  opts.push(`<optgroup label="Built-in jazz">`);
  BUNDLED_TRACKS.forEach(t => opts.push(`<option value="${t.id}">${t.name}</option>`));
  opts.push(`</optgroup>`);

  const builtIn = opts.join('');
  $('trackSelect').innerHTML = builtIn;
  $('trackSelectOverlay').innerHTML = builtIn;

  getSavedIds().then(async ids => {
    if (!ids.length) return;
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const s  = tx.objectStore(STORE);
    const names = {};
    await Promise.all(ids.map(id => new Promise(resolve => {
      const r = s.get(id);
      r.onsuccess = () => { names[id] = (r.result && r.result.name) || id; resolve(); };
      r.onerror   = () => { names[id] = id; resolve(); };
    })));

    const userOpts = ids.map(id => `<option value="${id}">${names[id]}</option>`).join('');
    const full = builtIn + `<optgroup label="Your uploads">` + userOpts + `</optgroup>`;
    [$('trackSelect'), $('trackSelectOverlay')].forEach(sel => {
      const prev = sel.value;
      sel.innerHTML = full;
      if (prev) sel.value = prev;
    });
  });
}

async function selectTrack(id) {
  if (!id) return;
  // Keep both selects in sync
  [$('trackSelect'), $('trackSelectOverlay')].forEach(s => s.value = id);

  const bundle = BUNDLED_TRACKS.find(t => t.id === id);
  if (bundle) {
    setStatus('Loading ' + bundle.name + '…');
    try {
      const r = await fetch(bundle.file);
      if (!r.ok) throw new Error('fetch ' + bundle.file);
      const ab = await r.arrayBuffer();
      await loadArrayBuffer(ab, bundle.name);
      await saveTrack(id, bundle.name, ab);
    } catch (err) {
      setStatus('Failed to load ' + bundle.name + ': ' + err.message);
    }
    return;
  }

  // User upload from IndexedDB
  const rec = await loadTrack(id);
  if (rec && rec.data) {
    setStatus('Loading ' + rec.name + '…');
    await loadArrayBuffer(rec.data, rec.name);
  } else {
    setStatus('Track not found in storage');
  }
}

/* ---------- wiring ---------- */
$('trackSelect').addEventListener('change', e => selectTrack(e.target.value));
$('trackSelectOverlay').addEventListener('change', e => selectTrack(e.target.value));

// Intercept file input to also persist
$('fileInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    const ab = ev.target.result;
    const id = 'user_' + encodeURIComponent(f.name) + '_' + Date.now();
    saveTrack(id, f.name, ab).then(() => populateSelects());
    loadArrayBuffer(ab, f.name);
  };
  r.readAsArrayBuffer(f);
});

// Intercept drop to also persist
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  canvas.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    const ab = ev.target.result;
    const id = 'user_' + encodeURIComponent(f.name) + '_' + Date.now();
    saveTrack(id, f.name, ab).then(() => populateSelects());
    loadArrayBuffer(ab, f.name);
  };
  r.readAsArrayBuffer(f);
});

/* ---------- auto-restore last track ---------- */
async function restoreLast() {
  const meta = await getLastTrackMeta();
  if (!meta || !meta.lastId) return;
  const id = meta.lastId;
  // If it's a built-in, it will fetch; if user-uploaded, it will read from DB
  const rec = await loadTrack(id);
  if (rec && rec.data) {
    await loadArrayBuffer(rec.data, rec.name || meta.name || 'Restored track');
    [$('trackSelect'), $('trackSelectOverlay')].forEach(s => s.value = id);
  } else if (BUNDLED_TRACKS.find(t => t.id === id)) {
    await selectTrack(id);
  }
}

/* ---------- boot ---------- */
resize();
raf = requestAnimationFrame(tick);
populateSelects();
restoreLast();
