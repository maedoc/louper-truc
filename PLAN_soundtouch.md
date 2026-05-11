# SoundTouchJS Integration Plan

## Goal
Fix Safari OGG quantization bug (seeking plays from ~1s chunk boundary instead of requested position) and preserve pitch during time-stretch playback (50%–110% speed range).

## Root Causes
1. **Safari OGG decoder** seeks at ~1-second granularity; `currentTime` reports correctly but audio output snaps to chunk boundary. Already fixed by porting to Web Audio API `AudioBufferSourceNode`.
2. **Pitch shift on speed change**: `AudioBufferSourceNode.playbackRate` shifts pitch (unlike `<audio>` with `preservesPitch=true`). Need SoundTouchJS to decouple tempo from pitch.

## Solution
Insert `SoundTouchNode` (AudioWorklet) between `AudioBufferSourceNode` and `destination`:
```
AudioBufferSourceNode → SoundTouchNode → audioCtx.destination
```
- `source.playbackRate = speed` (drives tempo)
- `soundTouchNode.playbackRate = speed` (tells SoundTouch the input rate)
- `soundTouchNode.pitch = 1.0` (keeps original pitch)

## Step-by-step

### Step 1: Install dependency
```bash
npm install @soundtouchjs/audio-worklet
```

### Step 2: Add postinstall script to `package.json`
Copy the worklet processor to `js/vendor/` (gitignored):
```json
"scripts": {
  "postinstall": "mkdir -p js/vendor && cp node_modules/@soundtouchjs/audio-worklet/dist/soundtouch-processor.js js/vendor/"
}
```

### Step 3: Add `js/vendor/` to `.gitignore`
```
js/vendor/
```

### Step 4: Update `js/state.js`
Add `soundTouchNode: null` to the state object.

### Step 5: Update `js/audio.js`
1. Import `SoundTouchNode` at top:
   ```js
   import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
   ```
2. Add module-level `let workletRegistered = false;`
3. In `initAudio()`, after creating `audioCtx`:
   ```js
   if (!workletRegistered) {
     await audioCtx.audioWorklet.addModule('js/vendor/soundtouch-processor.js');
     workletRegistered = true;
   }
   ```
   Note: `initAudio()` must remain sync (Safari user-gesture requirement). The worklet registration should happen in a separate early init call or be fire-and-forget with a guard. See Step 8.
4. In `startSource()`, after creating `sourceNode`:
   ```js
   s.soundTouchNode = new SoundTouchNode(audioCtx);
   sourceNode.connect(s.soundTouchNode);
   s.soundTouchNode.connect(audioCtx.destination);
   s.soundTouchNode.playbackRate = s.speed;
   s.soundTouchNode.pitch = 1.0;
   ```
5. In `killSource()`, before disconnecting `sourceNode`:
   ```js
   if (s.soundTouchNode) {
     s.soundTouchNode.disconnect();
     s.soundTouchNode = null;
   }
   ```
6. In `updateSpeed()`:
   ```js
   if (s.soundTouchNode) {
     s.soundTouchNode.playbackRate = speed;
   }
   ```

### Step 6: Mirror all changes in `app.js`
`app.js` is the monolithic fallback — every change to `js/audio.js` and `js/state.js` must be replicated.

### Step 7: Update `index.html`
Remove or hide the now-unused `<audio id="audioPlayer">` element (optional cleanup).

### Step 8: Early worklet registration
Worklet registration is async (~50ms). Must complete before first play. Options:
- **A (recommended):** Call a one-time `ensureWorklet()` on page load / track load (fire-and-forget with a promise guard). `initAudio()` stays sync for user-gesture compatibility.
  ```js
  let workletReady = null;
  function ensureWorklet() {
    if (!workletReady) {
      workletReady = audioCtx.audioWorklet.addModule('js/vendor/soundtouch-processor.js');
    }
    return workletReady;
  }
  ```
  Call `ensureWorklet()` early (e.g. on first `initAudio()` or on track load). In `startSource()`, `await ensureWorklet()` before creating `SoundTouchNode`. Since `startSource()` is not called from a user-gesture handler, awaiting is safe.
- **B:** Register in `initAudio()` with `await` — **rejected** because `initAudio()` must stay sync for Safari.

### Step 9: Test
- [ ] Play at 100% — pitch and tempo normal
- [ ] Play at 50% — tempo half, pitch preserved
- [ ] Play at 110% — tempo fast, pitch preserved
- [ ] Seek while playing — correct position, no chunk boundary snap
- [ ] Seek while paused — correct position on resume
- [ ] Speed change during playback — smooth transition, pitch stays constant
- [ ] Loop wrap — seamless restart
- [ ] Safari 14.1+ — all above working
- [ ] Chrome/Firefox — no regression

## Risks & Mitigations
| Risk | Mitigation |
|------|-----------|
| Safari AudioWorklet support (14.1+) | App targets modern Safari; acceptable |
| Worklet registration fails | Guard with try/catch; fall back to pitch-shifted playback |
| SoundTouchJS quality outside 0.5–2.0x | App range is 50%–110% (0.5–1.1), well within sweet spot |
| `SoundTouchNode` latency | Should be minimal (no additional buffering for real-time use) |
| `app.js` drift from modular `js/` | Mirror changes immediately; test both entry points |
| SoundTouchJS npm package structure may differ | Verify `dist/soundtouch-processor.js` exists after install; adjust path if needed |

## Critical Context
- Safari suspends `AudioContext` on page load; `resume()` must NOT be awaited (breaks user-gesture context)
- `AudioBufferSourceNode` is single-use; must create new node on every play/seek/loop-wrap
- `onended` fires asynchronously for killed source nodes; must check node identity in closure
- `app.js` is a monolithic fallback version that must be kept in sync with modular `js/` files
- No bundler — raw ES modules served statically

## Relevant Files
- `js/audio.js` — Core playback engine
- `js/state.js` — Shared state (add `soundTouchNode`)
- `js/interactions.js` — Event handlers (no changes expected)
- `js/catalog.js` — Track loading (may need `ensureWorklet()` call)
- `js/waveform.js` — Waveform renderer (no changes expected)
- `app.js` — Monolithic fallback (mirror all changes)
- `index.html` — DOM structure (optional cleanup)
- `package.json` — Add dependency + postinstall script
- `.gitignore` — Add `js/vendor/`
