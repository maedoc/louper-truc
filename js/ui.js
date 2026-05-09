/* louper-truc — UI wiring, resize, boot */
import { s, clampViewStart, ZOOM_MIN } from './state.js';
import { draw, updateZoomUI, init as initWaveform, resizeCanvases } from './waveform.js';
import { init as initInteractions } from './interactions.js';
import { initAudio, togglePlay, updateSpeed, toggleLoop, seek } from './audio.js';
import {
  selectTrack,
  populateSelects,
  loadFile,
  setStatus,
  restoreLast,
  loadArrayBuffer,
} from './catalog.js';

const THEME_KEY = 'louper-theme';

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const btn = document.getElementById('btnTheme');
  if (btn) btn.textContent = theme === 'dark' ? '\u2600' : '\u263E';
  draw();
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const theme = stored || getSystemTheme();
  applyTheme(theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
  });
  document.getElementById('btnTheme').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

function resize() {
  s.canvasRect = document.getElementById('dropzone').getBoundingClientRect();
  s.cssW = s.canvasRect.width;
  s.cssH = s.canvasRect.height;
  s.dpr = window.devicePixelRatio || 1;
  resizeCanvases();
  draw();
}

export function boot() {
  initAudio();
  const canvas = document.getElementById('waveform');
  const dropzone = document.getElementById('dropzone');

  initWaveform(canvas);
  window.addEventListener('resize', resize);
  resize();

  initInteractions(canvas);

  document
    .getElementById('btnLoad')
    .addEventListener('click', () => document.getElementById('fileInput').click());
  document
    .getElementById('btnPlay')
    .addEventListener('click', () => togglePlay(s.pauseOffset));
  document.getElementById('btnLoop').addEventListener('click', toggleLoop);
  document.getElementById('btnResetZoom').addEventListener('click', () => {
    s.zoom = s.cssW / s.duration || ZOOM_MIN;
    if (s.zoom < ZOOM_MIN) s.zoom = ZOOM_MIN;
    s.viewStart = 0;
    updateZoomUI();
    draw();
  });
  document.querySelectorAll('#speedBtns button').forEach((btn) => {
    btn.addEventListener('click', () => updateSpeed(btn.dataset.speed));
  });
  document.getElementById('zoomCtrl').addEventListener('input', (e) => {
    const newZoom = parseFloat(e.target.value) || ZOOM_MIN;
    const center = s.viewStart + s.cssW / 2 / s.zoom;
    s.zoom = newZoom;
    s.viewStart = clampViewStart(center - s.cssW / 2 / s.zoom);
    draw();
  });
  document.getElementById('scrub').addEventListener('input', (e) => {
    seek(parseFloat(e.target.value) || 0);
    draw();
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvas.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => canvas.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    canvas.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  document.getElementById('fileInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) loadFile(f);
  });

  document.getElementById('btnDemo').addEventListener('click', async () => {
    setStatus('Loading demo\u2026');
    try {
      const r = await fetch('demo.ogg');
      if (!r.ok) throw new Error('local');
      await loadArrayBuffer(await r.arrayBuffer(), 'King Oliver \u2014 Krooked Blues (1923)');
    } catch {
      setStatus('Demo failed. Drop your own file.');
    }
  });

  document
    .getElementById('trackSelect')
    .addEventListener('change', (e) => selectTrack(e.target.value));
  document
    .getElementById('trackSelectOverlay')
    .addEventListener('change', (e) => selectTrack(e.target.value));

  populateSelects();
  restoreLast();
  initBuildLink();
  initTheme();
}

function initBuildLink() {
  const a = document.getElementById('buildLink');
  if (!a) return;
  const d = new Date(document.lastModified);
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  a.textContent = 'built on ' + date + ', ' + time;
  a.removeAttribute('href');
}
