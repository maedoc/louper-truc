/* louper-truc — constants & shared state */
export const BLOCK = 64;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2000;
export const LOOP_MIN_SEC = 0.05;
export const DRAG_THRESHOLD_MOUSE = 4;
export const DRAG_THRESHOLD_TOUCH = 8;
export const TAP_MAX_MS = 300;
export const LONG_PRESS_MS = 450;
export const WHEEL_ZOOM_SENSITIVITY = 0.002;
export const WHEEL_PAN_SENSITIVITY = 0.02;
export const DBLCLICK_ZOOM_FACTOR = 2;
export const INTERACTION_TIMEOUT_MS = 250;
export const PLAYBACK_END_THRESHOLD = 0.05;

export const SPEED_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1];

export const s = {
  audioCtx: null,
  audioEl: null,
  blobUrl: null,
  buffer: null,
  peaks: null,
  sampleRate: 0,
  duration: 0,
  zoom: 1,
  viewStart: 0,
  cssW: 0,
  cssH: 0,
  dpr: 1,
  canvasRect: null,
  isPlaying: false,
  playSpeed: 1,
  pauseOffset: 0,
  cuePoint: 0,
  loopOn: false,
  loopStart: 0,
  loopEnd: 0,
  interaction: 'idle',
  pointer: {},
  pinch: {},
  longPressTimer: null,
  lastInteractionTime: 0,
  autoFollow: true,
  raf: 0,
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const clampViewStart = (t) => clamp(t, 0, Math.max(0, s.duration - s.cssW / s.zoom));
export const fmt = (t) => {
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  const d = Math.floor((t % 1) * 10);
  return `${m}:${String(sec).padStart(2, '0')}.${d}`;
};
export const timeToX = (t) => (t - s.viewStart) * s.zoom;
export const xToTime = (x) => s.viewStart + x / s.zoom;
