/* louper-truc — UI wiring, resize, boot */
import { s, clampViewStart, ZOOM_MIN } from './state.js';
import { draw, updateZoomUI, init as initWaveform, resizeCanvases } from './waveform.js';
import { init as initInteractions } from './interactions.js';
import { togglePlay, updateSpeed, toggleLoop, seek } from './audio.js';
import { selectTrack, populateSelects, loadFile, setStatus, restoreLast, loadArrayBuffer } from './catalog.js';

function resize() {
  s.canvasRect = document.getElementById('dropzone').getBoundingClientRect();
  s.cssW = s.canvasRect.width;
  s.cssH = s.canvasRect.height;
  s.dpr = window.devicePixelRatio || 1;
  resizeCanvases();
  draw();
}

export function boot() {
  const canvas = document.getElementById('waveform');
  const dropzone = document.getElementById('dropzone');

  initWaveform(canvas);
  window.addEventListener('resize', resize);
  resize();

  initInteractions(canvas);

  document.getElementById('btnLoad').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('btnPlay').addEventListener('click', () => togglePlay(s.pauseOffset));
  document.getElementById('btnLoop').addEventListener('click', toggleLoop);
  document.getElementById('btnResetZoom').addEventListener('click', () => {
    s.zoom = s.cssW / s.duration || ZOOM_MIN;
    if (s.zoom < ZOOM_MIN) s.zoom = ZOOM_MIN;
    s.viewStart = 0;
    updateZoomUI();
    draw();
  });
  document.getElementById('speedCtrl').addEventListener('input', e => updateSpeed(e.target.value));
  document.getElementById('zoomCtrl').addEventListener('input', e => {
    const newZoom = parseFloat(e.target.value) || ZOOM_MIN;
    const center = s.viewStart + (s.cssW / 2) / s.zoom;
    s.zoom = newZoom;
    s.viewStart = clampViewStart(center - (s.cssW / 2) / s.zoom);
    draw();
  });
  document.getElementById('scrub').addEventListener('input', e => {
    seek(parseFloat(e.target.value) || 0);
    draw();
  });

  dropzone.addEventListener('dragover', e => { e.preventDefault(); canvas.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => canvas.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    canvas.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  document.getElementById('fileInput').addEventListener('change', e => {
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

  document.getElementById('trackSelect').addEventListener('change', e => selectTrack(e.target.value));
  document.getElementById('trackSelectOverlay').addEventListener('change', e => selectTrack(e.target.value));

  populateSelects();
  restoreLast();
}
