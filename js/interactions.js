/* louper-truc — interaction state machine & event handlers */
import {
  s,
  clamp,
  clampViewStart,
  xToTime,
  DRAG_THRESHOLD_MOUSE,
  DRAG_THRESHOLD_TOUCH,
  TAP_MAX_MS,
  LONG_PRESS_MS,
  WHEEL_ZOOM_SENSITIVITY,
  WHEEL_PAN_SENSITIVITY,
  DBLCLICK_ZOOM_FACTOR,
  ZOOM_MIN,
  ZOOM_MAX,
  LOOP_MIN_SEC,
} from './state.js';
import { draw, updateZoomUI } from './waveform.js';
import { seek, togglePlay, toggleLoop, getCurrentTime } from './audio.js';

const VALID_STATES = new Set(['idle', 'idle-down', 'panning', 'selecting', 'pinching']);

const TRANSITIONS = {
  idle: new Set(['mousedown', 'touchstart', 'blur']),
  'idle-down': new Set(['mousemove', 'mouseup', 'touchmove', 'touchend', 'longpress', 'blur']),
  panning: new Set(['mousemove', 'mouseup', 'touchmove', 'touchend', 'blur']),
  selecting: new Set(['mousemove', 'mouseup', 'touchmove', 'touchend', 'blur']),
  pinching: new Set(['touchmove', 'touchend', 'blur']),
};

function transition(event) {
  const current = s.interaction;
  if (current === 'idle' && event === 'blur') return;
  if (!VALID_STATES.has(current)) {
    s.interaction = 'idle';
    return;
  }
  const allowed = TRANSITIONS[current];
  if (!allowed || !allowed.has(event)) return;
  switch (event) {
    case 'mousedown':
    case 'touchstart':
      s.interaction = 'idle-down';
      break;
    case 'mousemove':
    case 'touchmove':
      s.interaction = s.interaction === 'selecting' ? 'selecting' : 'panning';
      break;
    case 'mouseup':
    case 'touchend':
    case 'blur':
      s.interaction = 'idle';
      break;
    case 'longpress':
      if (s.interaction === 'idle-down') s.interaction = 'selecting';
      break;
  }
}

function updateSelection(x) {
  const ti = clamp(xToTime(x), 0, s.duration);
  if (ti >= s.loopStart) s.loopEnd = ti;
  else {
    s.loopEnd = s.loopStart;
    s.loopStart = ti;
  }
}

function finalizeSelection() {
  if (s.loopEnd - s.loopStart < LOOP_MIN_SEC) {
    s.loopStart = 0;
    s.loopEnd = 0;
  } else if (!s.loopOn) toggleLoop();
}

const touches = new Map();

export function init(canvas) {
  /* mouse: left-click = loop selection, middle/right = pan */
  canvas.addEventListener('mousedown', (e) => {
    const x = e.clientX - s.canvasRect.left;
    s.pointer = { x0: x, time0: performance.now(), origView: s.viewStart };
    if (e.button === 1 || e.button === 2) {
      s.interaction = 'panning';
      e.preventDefault();
    } else {
      s.interaction = 'selecting';
      const ti = xToTime(x);
      s.loopStart = ti;
      s.loopEnd = ti;
      draw();
    }
    s.lastInteractionTime = performance.now();
  });

  window.addEventListener('mousemove', (e) => {
    if (s.interaction === 'idle') return;
    const x = e.clientX - s.canvasRect.left;
    const dx = x - s.pointer.x0;
    if (s.interaction === 'panning') {
      s.viewStart = clampViewStart(s.pointer.origView - dx / s.zoom);
      draw();
      s.lastInteractionTime = performance.now();
    } else if (s.interaction === 'selecting') {
      updateSelection(x);
      draw();
      s.lastInteractionTime = performance.now();
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (s.interaction === 'idle') return;
    if (s.interaction === 'selecting') {
      if (Math.abs(e.clientX - s.canvasRect.left - s.pointer.x0) <= DRAG_THRESHOLD_MOUSE) {
        s.cuePoint = clamp(xToTime(e.clientX - s.canvasRect.left), 0, s.duration);
        seek(s.cuePoint);
        s.loopStart = 0;
        s.loopEnd = 0;
        if (s.loopOn) toggleLoop();
      } else {
        finalizeSelection();
      }
    }
    s.interaction = 'idle';
    draw();
    s.lastInteractionTime = performance.now();
  });

  /* scroll: pan by default, shift+scroll = zoom */
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.shiftKey) {
        const x = e.clientX - s.canvasRect.left;
        const t = xToTime(x);
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        s.zoom = clamp(s.zoom * factor, ZOOM_MIN, ZOOM_MAX);
        s.viewStart = clampViewStart(t - x / s.zoom);
        updateZoomUI();
      } else {
        const dt = e.deltaY * WHEEL_PAN_SENSITIVITY;
        s.viewStart = clampViewStart(s.viewStart + dt);
      }
      draw();
      s.lastInteractionTime = performance.now();
    },
    { passive: false },
  );

  /* double-click zoom */
  canvas.addEventListener('dblclick', (e) => {
    const x = e.clientX - s.canvasRect.left;
    const t = xToTime(x);
    s.zoom = clamp(s.zoom * DBLCLICK_ZOOM_FACTOR, ZOOM_MIN, ZOOM_MAX);
    s.viewStart = clampViewStart(t - x / s.zoom);
    updateZoomUI();
    draw();
  });

  /* touch — unchanged: drag=pan, long-press=loop, pinch=zoom */
  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        s.interaction = 'pinching';
        const t0 = e.touches[0],
          t1 = e.touches[1];
        const dx = t1.clientX - t0.clientX,
          dy = t1.clientY - t0.clientY;
        s.pinch.startDist = Math.hypot(dx, dy) || 1;
        s.pinch.startZoom = s.zoom;
        const cx = (t0.clientX + t1.clientX) / 2 - s.canvasRect.left;
        s.pinch.centerTime = xToTime(cx);
        if (s.longPressTimer) {
          clearTimeout(s.longPressTimer);
          s.longPressTimer = null;
        }
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const x = t.clientX - s.canvasRect.left;
        const y = t.clientY - s.canvasRect.top;
        touches.set(t.identifier, { x0: x, y0: y, origView: s.viewStart, time0: performance.now() });
        transition('touchstart');
        s.longPressTimer = setTimeout(() => {
          transition('longpress');
          if (s.interaction === 'selecting') {
            const ti = xToTime(x);
            s.loopStart = ti;
            s.loopEnd = ti;
            if (navigator.vibrate) navigator.vibrate(20);
            draw();
          }
        }, LONG_PRESS_MS);
        s.lastInteractionTime = performance.now();
      }
    },
    { passive: false },
  );

  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      if (s.interaction === 'pinching' && e.touches.length === 2) {
        const t0 = e.touches[0],
          t1 = e.touches[1];
        const dx = t1.clientX - t0.clientX,
          dy = t1.clientY - t0.clientY;
        const dist = Math.hypot(dx, dy) || 1;
        const ratio = dist / s.pinch.startDist;
        s.zoom = clamp(s.pinch.startZoom * ratio, ZOOM_MIN, ZOOM_MAX);
        const cx = (t0.clientX + t1.clientX) / 2 - s.canvasRect.left;
        s.viewStart = clampViewStart(s.pinch.centerTime - cx / s.zoom);
        updateZoomUI();
        draw();
        s.lastInteractionTime = performance.now();
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const x = t.clientX - s.canvasRect.left;
        const touch = touches.get(t.identifier);
        if (!touch) return;
        const dx = x - touch.x0;
        if (s.interaction === 'idle-down') {
          if (Math.abs(dx) > DRAG_THRESHOLD_TOUCH) {
            if (s.longPressTimer) {
              clearTimeout(s.longPressTimer);
              s.longPressTimer = null;
            }
            transition('touchmove');
          }
        } else if (s.interaction === 'panning') {
          s.viewStart = clampViewStart(touch.origView - dx / s.zoom);
          draw();
        } else if (s.interaction === 'selecting') {
          updateSelection(x);
          draw();
        }
        s.lastInteractionTime = performance.now();
      }
    },
    { passive: false },
  );

  canvas.addEventListener('touchend', (e) => {
    if (s.longPressTimer) {
      clearTimeout(s.longPressTimer);
      s.longPressTimer = null;
    }
    if (e.touches.length === 0) {
      const ct = e.changedTouches[0];
      const x = ct.clientX - s.canvasRect.left;
      const touch = touches.get(ct.identifier);
      const dx = touch ? Math.abs(x - touch.x0) : Infinity;
      const dt = touch ? performance.now() - touch.time0 : Infinity;
      const isTap = dt < TAP_MAX_MS && dx < DRAG_THRESHOLD_TOUCH * 2;
      if (isTap && s.interaction !== 'selecting') {
        s.cuePoint = clamp(xToTime(x), 0, s.duration);
        seek(s.cuePoint);
        draw();
      } else if (s.interaction === 'selecting') {
        finalizeSelection();
      }
      touches.delete(ct.identifier);
      transition('touchend');
    } else if (e.touches.length === 1 && s.interaction === 'pinching') {
      const t = e.touches[0];
      const x = t.clientX - s.canvasRect.left;
        touches.set(t.identifier, { x0: x, origView: s.viewStart, time0: performance.now() });
      s.interaction = 'panning';
    }
    s.lastInteractionTime = performance.now();
  });

  canvas.addEventListener('touchcancel', () => {
    if (s.longPressTimer) clearTimeout(s.longPressTimer);
    s.interaction = 'idle';
  });

  /* safety resets */
  window.addEventListener('blur', () => {
    transition('blur');
    if (s.longPressTimer) {
      clearTimeout(s.longPressTimer);
      s.longPressTimer = null;
    }
  });
  document.addEventListener('mouseleave', () => {
    transition('blur');
    if (s.longPressTimer) {
      clearTimeout(s.longPressTimer);
      s.longPressTimer = null;
    }
  });

  /* keyboard */
  window.addEventListener('keydown', (e) => {
    if (
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'BUTTON' ||
      e.target.tagName === 'SELECT'
    )
      return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay(s.cuePoint);
    } else if (e.code === 'KeyL') {
      toggleLoop();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      const base = s.isPlaying ? getCurrentTime() : s.pauseOffset;
      seek(base - (e.shiftKey ? 5 : 1));
      draw();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      const base = s.isPlaying ? getCurrentTime() : s.pauseOffset;
      seek(base + (e.shiftKey ? 5 : 1));
      draw();
    }
  });
}
