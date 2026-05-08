/* louper-truc — track catalog & file loading */
import { s, fmt, ZOOM_MIN } from './state.js';
import { draw, computePeaks, updateZoomUI } from './waveform.js';
import { initAudio } from './audio.js';
import { saveTrack, loadTrack, getSavedIds, openDB } from './persistence.js';

const STORE = 'tracks';

export const BUNDLED_TRACKS = [
  { id: 'b1', file: 'assets/tracks/01_Bloomdido.ogg', name: 'Bloomdido' },
  { id: 'b2', file: 'assets/tracks/02_My_Melancholy_Baby.ogg', name: 'My Melancholy Baby' },
  { id: 'b3', file: 'assets/tracks/03_Relaxin_with_Lee.ogg', name: "Relaxin' with Lee" },
  { id: 'b4', file: 'assets/tracks/04_Leap_Frog.ogg', name: 'Leap Frog' },
  { id: 'b5', file: 'assets/tracks/05_An_Oscar_for_Treadwell.ogg', name: 'An Oscar for Treadwell' },
  { id: 'b6', file: 'assets/tracks/06_Mohawk.ogg', name: 'Mohawk' },
  {
    id: 'b7',
    file: 'assets/tracks/07_My_Melancholy_Baby_Complete.ogg',
    name: 'My Melancholy Baby (complete)',
  },
  {
    id: 'b8',
    file: 'assets/tracks/08_Relaxin_with_Lee_Complete.ogg',
    name: "Relaxin' with Lee (complete)",
  },
  { id: 'b9', file: 'assets/tracks/09_Leap_Frog_Complete.ogg', name: 'Leap Frog (complete)' },
  {
    id: 'b10',
    file: 'assets/tracks/10_Leap_Frog_Complete_2.ogg',
    name: 'Leap Frog (complete take 2)',
  },
  {
    id: 'b11',
    file: 'assets/tracks/11_Leap_Frog_Complete_3.ogg',
    name: 'Leap Frog (complete take 3)',
  },
  {
    id: 'b12',
    file: 'assets/tracks/12_Oscar_for_Treadwell_Complete.ogg',
    name: 'Oscar for Treadwell (complete)',
  },
  { id: 'b13', file: 'assets/tracks/13_Mohawk_Complete.ogg', name: 'Mohawk (complete)' },
  { id: 'b14', file: 'assets/tracks/14_A_Night_In_Tunisia.ogg', name: 'A Night in Tunisia' },
  {
    id: 'b15',
    file: 'assets/tracks/15_Blues_For_Alice_Alt.ogg',
    name: 'Blues for Alice (alt take)',
  },
  { id: 'b16', file: 'assets/tracks/16_Blues_For_Alice.ogg', name: 'Blues for Alice' },
  { id: 'b17', file: 'assets/tracks/17_All_Blues.ogg', name: 'All Blues' },
  { id: 'b18', file: 'assets/tracks/18_Half_Nelson.ogg', name: 'Half Nelson' },
  { id: 'b19', file: 'assets/tracks/19_Airegin.ogg', name: 'Airegin' },
  { id: 'b20', file: 'assets/tracks/20_Moments_Notice.ogg', name: "Moment's Notice" },
];

export async function loadArrayBuffer(ab, name) {
  initAudio();
  if (ab.byteLength < 200) {
    const text = new TextDecoder().decode(ab);
    if (text.startsWith('version https://git-lfs.github.com')) {
      setStatus('Audio file is a Git LFS pointer, not actual audio. Pull LFS content first.');
      return;
    }
  }
  try {
    const decoded = await s.audioCtx.decodeAudioData(ab.slice(0));
    s.buffer = decoded;
    s.sampleRate = s.buffer.sampleRate;
    s.duration = s.buffer.duration;
    if (s.blobUrl) URL.revokeObjectURL(s.blobUrl);
    s.blobUrl = URL.createObjectURL(new Blob([ab]));
    s.audioEl.src = s.blobUrl;
    s.audioEl.playbackRate = s.playSpeed;
    computePeaks();
    s.cuePoint = 0;
    s.loopStart = 0;
    s.loopEnd = s.duration;
    s.pauseOffset = 0;
    s.loopOn = false;
    s.viewStart = 0;
    s.zoom = s.cssW / s.duration;
    if (s.zoom < ZOOM_MIN) s.zoom = ZOOM_MIN;
    updateZoomUI();
    document.getElementById('scrub').max = s.duration;
    document.getElementById('timeEnd').textContent = fmt(s.duration);
    setStatus(name);
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('zoomHint').classList.remove('hidden');
    draw();
  } catch (err) {
    setStatus('Failed to decode audio: ' + (err.message || err));
  }
}

function buildSelectContent(select, includeUser, userNames) {
  const placeholder = document.createElement('option');
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Choose a track\u2026';
  select.appendChild(placeholder);

  const builtInGroup = document.createElement('optgroup');
  builtInGroup.label = 'Built-in jazz';
  BUNDLED_TRACKS.forEach((t) => {
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

export async function populateSelects() {
  const selects = [
    document.getElementById('trackSelect'),
    document.getElementById('trackSelectOverlay'),
  ];
  selects.forEach((sel) => {
    sel.textContent = '';
    buildSelectContent(sel, false);
  });

  try {
    const ids = await getSavedIds();
    if (!ids.length) return;
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const st = tx.objectStore(STORE);
    const names = {};
    await Promise.all(
      ids.map(
        (id) =>
          new Promise((resolve) => {
            const r = st.get(id);
            r.onsuccess = () => {
              names[id] = (r.result && r.result.name) || id;
              resolve();
            };
            r.onerror = () => {
              names[id] = id;
              resolve();
            };
          }),
      ),
    );

    selects.forEach((sel) => {
      const prev = sel.value;
      sel.textContent = '';
      buildSelectContent(sel, true, names);
      if (prev) sel.value = prev;
    });
  } catch (err) {
    console.error('populateSelects error:', err);
  }
}

export async function selectTrack(id) {
  if (!id) return;
  const selects = [
    document.getElementById('trackSelect'),
    document.getElementById('trackSelectOverlay'),
  ];
  selects.forEach((sel) => (sel.value = id));

  const bundle = BUNDLED_TRACKS.find((t) => t.id === id);
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

export function loadFile(f) {
  const r = new FileReader();
  r.onload = (ev) => {
    const ab = ev.target.result;
    const id = 'user_' + encodeURIComponent(f.name) + '_' + Date.now();
    saveTrack(id, f.name, ab).then(() => populateSelects());
    loadArrayBuffer(ab, f.name);
  };
  r.onerror = () => setStatus('Failed to read file');
  r.readAsArrayBuffer(f);
}

export function setStatus(msg) {
  const el = document.getElementById('status');
  el.textContent = '';
  const span = document.createElement('span');
  span.className = 'pill';
  span.textContent = msg;
  el.appendChild(span);
}

export async function restoreLast() {
  const { getLastTrackMeta } = await import('./persistence.js');
  try {
    const meta = await getLastTrackMeta();
    if (!meta || !meta.lastId) return;
    const id = meta.lastId;
    const rec = await loadTrack(id);
    if (rec && rec.data) {
      await loadArrayBuffer(rec.data, rec.name || meta.name || 'Restored track');
      [
        document.getElementById('trackSelect'),
        document.getElementById('trackSelectOverlay'),
      ].forEach((sel) => (sel.value = id));
    } else if (BUNDLED_TRACKS.find((t) => t.id === id)) {
      await selectTrack(id);
    }
  } catch (err) {
    console.error('restoreLast error:', err);
  }
}
