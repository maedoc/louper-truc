/* louper-truc — waveform looper & transcription assistant */
'use strict';

/* ---------- constants ---------- */
const BLOCK = 64;
const ZOOM_MIN = 1;
const ZOOM_MAX = 2000;
const LOOP_MIN_SEC = 0.05;
const DRAG_THRESHOLD_MOUSE = 4;
const DRAG_THRESHOLD_TOUCH = 8;
const LONG_PRESS_MS = 450;
const WHEEL_ZOOM_SENSITIVITY = 0.002;
const WHEEL_PAN_SENSITIVITY = 0.02;
const DBLCLICK_ZOOM_FACTOR = 2;
const INTERACTION_TIMEOUT_MS = 250;
const AUTO_FOLLOW_MARGIN = 0.15;
const SPEED_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1];

/* ---------- state ---------- */
let audioCtx = null;
let audioEl = null;
let blobUrl = null;
let buffer = null;
let peaks = null;
let sampleRate = 0;
let duration = 0;

let zoom = 1;
let viewStart = 0;
let cssW = 0, cssH = 0, dpr = 1;
let canvasRect = null;

let isPlaying = false;
let playSpeed = 1;
let pauseOffset = 0;

let cuePoint = 0;
let loopOn = false;
let loopStart = 0;
let loopEnd = 0;

let state = 'idle';
let pointer = {};
let pinch = {};
let longPressTimer = null;
let lastInteractionTime = 0;
const autoFollow = true;
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
const clampViewStart = t => clamp(t, 0, Math.max(0, duration - cssW / zoom));
const fmt = t => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
};
const timeToX = t => (t - viewStart) * zoom;
const xToTime = x => viewStart + x / zoom;

function updateZoomUI() {
  $('zoomCtrl').value = zoom;
  $('zoomCtrl').max = Math.max(100, Math.ceil(zoom * 10));
}

/* ---------- resize / DPR ---------- */
function resize() {
  canvasRect = dropzone.getBoundingClientRect();
  cssW = canvasRect.width;
  cssH = canvasRect.height;
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
  if (!audioEl) {
    audioEl = $('audioPlayer');
    if ('preservesPitch' in audioEl) audioEl.preservesPitch = true;
    else if ('webkitPreservesPitch' in audioEl) audioEl.webkitPreservesPitch = true;
    else if ('mozPreservesPitch' in audioEl) audioEl.mozPreservesPitch = true;
    audioEl.addEventListener('ended', () => {
      isPlaying = false;
      pauseOffset = 0;
      audioEl.currentTime = 0;
      updatePlayBtn();
      cancelRaf();
      draw();
    });
  }
}

function getCurrentTime() {
  return audioEl ? audioEl.currentTime : pauseOffset;
}

function seek(t) {
  t = clamp(t, 0, duration);
  if (audioEl) audioEl.currentTime = t;
  if (!isPlaying) pauseOffset = t;
}

function togglePlay(startTime) {
  initAudio();
  if (isPlaying) {
    audioEl.pause();
    isPlaying = false;
    pauseOffset = audioEl.currentTime;
    cancelRaf();
  } else {
    if (loopOn && (startTime < loopStart || startTime >= loopEnd)) {
      audioEl.currentTime = loopStart;
    } else {
      audioEl.currentTime = startTime;
    }
    audioEl.playbackRate = playSpeed;
    audioEl.play().catch(() => {});
    isPlaying = true;
    lastInteractionTime = 0;
    startRaf();
  }
  updatePlayBtn();
}

function updatePlayBtn() { $('btnPlay').textContent = isPlaying ? 'Pause' : 'Play'; }

function updateSpeed(val) {
  playSpeed = parseFloat(val) || 1;
  if (audioEl) audioEl.playbackRate = playSpeed;
  const btns = document.querySelectorAll('#speedBtns button');
  btns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed) === playSpeed));
}

function toggleLoop() {
  loopOn = !loopOn;
  $('btnLoop').textContent = 'Loop: ' + (loopOn ? 'on' : 'off');
  draw();
}

/* ---------- rAF ---------- */
function tick() {
  if (!isPlaying) return;
  const now = performance.now();
  const interacting = (now - lastInteractionTime) < INTERACTION_TIMEOUT_MS;
  const t = getCurrentTime();
  if (loopOn && t >= loopEnd - (1 / sampleRate)) {
    audioEl.currentTime = loopStart;
  }
  if (!interacting && autoFollow && zoom > cssW / duration) {
    const margin = cssW * AUTO_FOLLOW_MARGIN;
    const px = timeToX(t);
    if (px > cssW - margin) {
      viewStart = clampViewStart(t - margin / zoom);
      draw();
    } else if (px < margin) {
      viewStart = clampViewStart(t - (cssW - margin) / zoom);
      draw();
    }
  }
  scrub.value = t;
  draw();
  raf = requestAnimationFrame(tick);
}

function startRaf() { if (!raf) raf = requestAnimationFrame(tick); }
function cancelRaf() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

/* ---------- load ---------- */
async function loadArrayBuffer(ab, name) {
  initAudio();
  if (ab.byteLength < 200) {
    const text = new TextDecoder().decode(ab);
    if (text.startsWith('version https://git-lfs.github.com')) {
      setStatus('Audio file is a Git LFS pointer, not actual audio. Pull LFS content first.');
      return;
    }
  }
  try {
    const decoded = await audioCtx.decodeAudioData(ab.slice(0));
    buffer = decoded;
    sampleRate = buffer.sampleRate;
    duration = buffer.duration;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([ab]));
    audioEl.src = blobUrl;
    audioEl.playbackRate = playSpeed;
    computePeaks();
    cuePoint = 0;
    loopStart = 0;
    loopEnd = duration;
    pauseOffset = 0;
    loopOn = false;
    viewStart = 0;
    zoom = cssW / duration;
    if (zoom < ZOOM_MIN) zoom = ZOOM_MIN;
    updateZoomUI();
    $('scrub').max = duration;
    $('timeEnd').textContent = fmt(duration);
    setStatus(name);
    overlay.classList.add('hidden');
    zoomHint.classList.remove('hidden');
    draw();
  } catch (err) {
    setStatus('Failed to decode audio: ' + (err.message || err));
  }
}

function computePeaks() {
  const n = buffer.getChannelData(0).length;
  const blocks = Math.ceil(n / BLOCK);
  const channels = buffer.numberOfChannels;
  peaks = new Float32Array(blocks * 2);
  for (let i = 0; i < blocks; i++) {
    let min = 1, max = -1;
    const a = i * BLOCK;
    const b = Math.min(a + BLOCK, n);
    for (let c = 0; c < channels; c++) {
      const ch = buffer.getChannelData(c);
      for (let j = a; j < b; j++) {
        const v = ch[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
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

/* ---------- interactions ---------- */
const touches = new Map();

function updateSelection(x) {
  const ti = clamp(xToTime(x), 0, duration);
  if (ti >= loopStart) loopEnd = ti;
  else { loopEnd = loopStart; loopStart = ti; }
}

function finalizeSelection() {
  if (loopEnd - loopStart < LOOP_MIN_SEC) { loopStart = 0; loopEnd = 0; }
  else if (!loopOn) toggleLoop();
}

/* mouse: left-click = loop selection, middle/right = pan */
canvas.addEventListener('mousedown', e => {
  const x = e.clientX - canvasRect.left;
  pointer = { x0: x, time0: performance.now(), origView: viewStart };
  if (e.button === 1 || e.button === 2) {
    state = 'panning';
    e.preventDefault();
  } else {
    state = 'selecting';
    const ti = xToTime(x);
    loopStart = ti; loopEnd = ti;
    draw();
  }
  lastInteractionTime = performance.now();
});

window.addEventListener('mousemove', e => {
  if (state === 'idle') return;
  const x = e.clientX - canvasRect.left;
  const dx = x - pointer.x0;
  if (state === 'panning') {
    viewStart = clampViewStart(pointer.origView - dx / zoom);
    draw();
    lastInteractionTime = performance.now();
  } else if (state === 'selecting') {
    updateSelection(x);
    draw();
    lastInteractionTime = performance.now();
  }
});

window.addEventListener('mouseup', e => {
  if (state === 'idle') return;
  if (state === 'selecting') {
    if (Math.abs(e.clientX - canvasRect.left - pointer.x0) <= DRAG_THRESHOLD_MOUSE) {
      cuePoint = clamp(xToTime(e.clientX - canvasRect.left), 0, duration);
      seek(cuePoint);
      loopStart = 0; loopEnd = 0;
      if (loopOn) toggleLoop();
    } else {
      finalizeSelection();
    }
  }
  state = 'idle';
  draw();
  lastInteractionTime = performance.now();
});

/* scroll: pan by default, shift+scroll = zoom */
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.shiftKey) {
    const x = e.clientX - canvasRect.left;
    const t = xToTime(x);
    const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
    zoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
    viewStart = clampViewStart(t - x / zoom);
    updateZoomUI();
  } else {
    const dt = e.deltaY * WHEEL_PAN_SENSITIVITY;
    viewStart = clampViewStart(viewStart + dt);
  }
  draw();
  lastInteractionTime = performance.now();
}, { passive: false });

/* double-click zoom */
canvas.addEventListener('dblclick', e => {
  const x = e.clientX - canvasRect.left;
  const t = xToTime(x);
  zoom = clamp(zoom * DBLCLICK_ZOOM_FACTOR, ZOOM_MIN, ZOOM_MAX);
  viewStart = clampViewStart(t - x / zoom);
  updateZoomUI();
  draw();
});

/* touch */
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (e.touches.length === 2) {
    state = 'pinching';
    const t0 = e.touches[0], t1 = e.touches[1];
    const dx = t1.clientX - t0.clientX, dy = t1.clientY - t0.clientY;
    pinch.startDist = Math.hypot(dx, dy) || 1;
    pinch.startZoom = zoom;
    const cx = (t0.clientX + t1.clientX) / 2 - canvasRect.left;
    pinch.centerTime = xToTime(cx);
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    return;
  }
  if (e.touches.length === 1) {
    const t = e.touches[0];
    const x = t.clientX - canvasRect.left;
    const y = t.clientY - canvasRect.top;
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
    }, LONG_PRESS_MS);
    lastInteractionTime = performance.now();
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (state === 'pinching' && e.touches.length === 2) {
    const t0 = e.touches[0], t1 = e.touches[1];
    const dx = t1.clientX - t0.clientX, dy = t1.clientY - t0.clientY;
    const dist = Math.hypot(dx, dy) || 1;
    const ratio = dist / pinch.startDist;
    zoom = clamp(pinch.startZoom * ratio, ZOOM_MIN, ZOOM_MAX);
    const cx = (t0.clientX + t1.clientX) / 2 - canvasRect.left;
    viewStart = clampViewStart(pinch.centerTime - cx / zoom);
    updateZoomUI();
    draw();
    lastInteractionTime = performance.now();
    return;
  }
  if (e.touches.length === 1) {
    const t = e.touches[0];
    const x = t.clientX - canvasRect.left;
    const touch = touches.get(t.identifier);
    if (!touch) return;
    const dx = x - touch.x0;
    if (state === 'idle-down') {
      if (Math.abs(dx) > DRAG_THRESHOLD_TOUCH) {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        state = 'panning';
      }
    } else if (state === 'panning') {
      viewStart = clampViewStart(touch.origView - dx / zoom);
      draw();
    } else if (state === 'selecting') {
      updateSelection(x);
      draw();
    }
    lastInteractionTime = performance.now();
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  if (e.touches.length === 0) {
    if (state === 'idle-down') {
      const ct = e.changedTouches[0];
      const x = ct.clientX - canvasRect.left;
      cuePoint = clamp(xToTime(x), 0, duration);
      seek(cuePoint);
      draw();
    } else if (state === 'selecting') {
      finalizeSelection();
    }
    state = 'idle';
  } else if (e.touches.length === 1 && state === 'pinching') {
    const t = e.touches[0];
    const x = t.clientX - canvasRect.left;
    touches.set(t.identifier, { x0: x, origView: viewStart });
    state = 'panning';
  }
  lastInteractionTime = performance.now();
});

canvas.addEventListener('touchcancel', e => {
  if (longPressTimer) clearTimeout(longPressTimer);
  state = 'idle';
});

/* ---------- drag & drop ---------- */
dropzone.addEventListener('dragover', e => { e.preventDefault(); canvas.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => canvas.classList.remove('dragover'));

$('btnLoad').addEventListener('click', () => $('fileInput').click());

$('btnPlay').addEventListener('click', () => togglePlay(audioEl ? audioEl.currentTime : pauseOffset));
$('btnLoop').addEventListener('click', toggleLoop);
$('btnResetZoom').addEventListener('click', () => {
  zoom = cssW / duration || ZOOM_MIN;
  if (zoom < ZOOM_MIN) zoom = ZOOM_MIN;
  viewStart = 0;
  updateZoomUI();
  draw();
});
document.querySelectorAll('#speedBtns button').forEach(btn => {
  btn.addEventListener('click', () => updateSpeed(btn.dataset.speed));
});
$('zoomCtrl').addEventListener('input', e => {
  const newZoom = parseFloat(e.target.value) || ZOOM_MIN;
  const center = viewStart + (cssW / 2) / zoom;
  zoom = newZoom;
  viewStart = clampViewStart(center - (cssW / 2) / zoom);
  draw();
});
scrub.addEventListener('input', e => { seek(parseFloat(e.target.value) || 0); draw(); });

/* ---------- demo ---------- */
$('btnDemo').addEventListener('click', async () => {
  setStatus('Loading demo\u2026');
  try {
    const r = await fetch('demo.ogg');
    if (!r.ok) throw new Error('local');
    await loadArrayBuffer(await r.arrayBuffer(), 'King Oliver \u2014 Krooked Blues (1923)');
  } catch {
    setStatus('Demo failed. Drop your own file.');
  }
});

function setStatus(msg) {
  const el = $('status');
  el.textContent = '';
  const span = document.createElement('span');
  span.className = 'pill';
  span.textContent = msg;
  el.appendChild(span);
}

/* ---------- safety resets ---------- */
window.addEventListener('blur', () => {
  state = 'idle';
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});
document.addEventListener('mouseleave', () => {
  state = 'idle';
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});

/* ---------- keyboard ---------- */
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay(cuePoint);
  } else if (e.code === 'KeyL') {
    toggleLoop();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    seek(getCurrentTime() - (e.shiftKey ? 5 : 1));
    draw();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    seek(getCurrentTime() + (e.shiftKey ? 5 : 1));
    draw();
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
const DB_VER  = 2;
const STORE   = 'tracks';
const META_STORE = 'meta';
const LAST_KEY= '__last_track__';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (e.oldVersion < 2 && db.objectStoreNames.contains(STORE)) {
        const tx = e.target.transaction;
        const trackStore = tx.objectStore(STORE);
        const getReq = trackStore.get(LAST_KEY);
        getReq.onsuccess = () => {
          const rec = getReq.result;
          if (rec && rec.lastId) {
            const metaStore = tx.objectStore(META_STORE);
            metaStore.put({ key: 'lastTrack', lastId: rec.lastId, name: rec.name, savedAt: rec.savedAt });
            trackStore.delete(LAST_KEY);
          }
        };
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveTrack(id, name, arrayBuffer) {
  const db = await openDB();
  const tx = db.transaction([STORE, META_STORE], 'readwrite');
  tx.objectStore(STORE).put({ id, name, data: arrayBuffer, savedAt: Date.now() });
  tx.objectStore(META_STORE).put({ key: 'lastTrack', lastId: id, name, savedAt: Date.now() });
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
  const db = await openDB();
  const tx = db.transaction(META_STORE, 'readonly');
  const s  = tx.objectStore(META_STORE);
  return new Promise((resolve, reject) => {
    const r = s.get('lastTrack');
    r.onsuccess = () => resolve(r.result || null);
    r.onerror   = e => reject(e.target.error);
  });
}

/* ---------- track list UI ---------- */
function buildSelectContent(select, includeUser, userNames) {
  const placeholder = document.createElement('option');
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Choose a track\u2026';
  select.appendChild(placeholder);

  const builtInGroup = document.createElement('optgroup');
  builtInGroup.label = 'Built-in jazz';
  BUNDLED_TRACKS.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    builtInGroup.appendChild(opt);
  });
  select.appendChild(builtInGroup);

  if (includeUser && userNames && Object.keys(userNames).length) {
    const userGroup = document.createElement('optgroup');
    userGroup.label = 'Your uploads';
    Object.entries(userNames).forEach(([id, name]) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = name;
      userGroup.appendChild(opt);
    });
    select.appendChild(userGroup);
  }
}

async function populateSelects() {
  const selects = [$('trackSelect'), $('trackSelectOverlay')];
  selects.forEach(sel => { sel.textContent = ''; buildSelectContent(sel, false); });

  try {
    const ids = await getSavedIds();
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

    selects.forEach(sel => {
      const prev = sel.value;
      sel.textContent = '';
      buildSelectContent(sel, true, names);
      if (prev) sel.value = prev;
    });
  } catch (err) {
    console.error('populateSelects error:', err);
  }
}

async function selectTrack(id) {
  if (!id) return;
  [$('trackSelect'), $('trackSelectOverlay')].forEach(s => s.value = id);

  const bundle = BUNDLED_TRACKS.find(t => t.id === id);
  if (bundle) {
    setStatus('Loading ' + bundle.name + '\u2026');
    try {
      const existing = await loadTrack(id);
      if (existing && existing.data) {
        await loadArrayBuffer(existing.data, bundle.name);
      } else {
        const r = await fetch(bundle.file);
        if (!r.ok) throw new Error('fetch ' + bundle.file);
        const ab = await r.arrayBuffer();
        await loadArrayBuffer(ab, bundle.name);
        await saveTrack(id, bundle.name, ab);
      }
    } catch (err) {
      setStatus('Failed to load ' + bundle.name + ': ' + err.message);
    }
    return;
  }

  try {
    const rec = await loadTrack(id);
    if (rec && rec.data) {
      setStatus('Loading ' + rec.name + '\u2026');
      await loadArrayBuffer(rec.data, rec.name);
    } else {
      setStatus('Track not found in storage');
    }
  } catch (err) {
    setStatus('Failed to load track: ' + (err.message || err));
  }
}

/* ---------- wiring ---------- */
$('trackSelect').addEventListener('change', e => selectTrack(e.target.value));
$('trackSelectOverlay').addEventListener('change', e => selectTrack(e.target.value));

function loadFile(f) {
  const r = new FileReader();
  r.onload = ev => {
    const ab = ev.target.result;
    const id = 'user_' + encodeURIComponent(f.name) + '_' + Date.now();
    saveTrack(id, f.name, ab).then(() => populateSelects());
    loadArrayBuffer(ab, f.name);
  };
  r.onerror = () => setStatus('Failed to read file');
  r.readAsArrayBuffer(f);
}

$('fileInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) loadFile(f);
});

dropzone.addEventListener('drop', e => {
  e.preventDefault();
  canvas.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

/* ---------- auto-restore last track ---------- */
async function restoreLast() {
  try {
    const meta = await getLastTrackMeta();
    if (!meta || !meta.lastId) return;
    const id = meta.lastId;
    const rec = await loadTrack(id);
    if (rec && rec.data) {
      await loadArrayBuffer(rec.data, rec.name || meta.name || 'Restored track');
      [$('trackSelect'), $('trackSelectOverlay')].forEach(s => s.value = id);
    } else if (BUNDLED_TRACKS.find(t => t.id === id)) {
      await selectTrack(id);
    }
  } catch (err) {
    console.error('restoreLast error:', err);
  }
}

/* ---------- boot ---------- */
resize();
populateSelects();
restoreLast();
