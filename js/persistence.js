/* louper-truc — IndexedDB persistence */
import { } from './state.js';

const DB_NAME = 'louper_truc_db';
const DB_VER  = 2;
const STORE   = 'tracks';
const META_STORE = 'meta';
const LAST_KEY = '__last_track__';

export function openDB() {
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

export async function saveTrack(id, name, arrayBuffer) {
  const db = await openDB();
  const tx = db.transaction([STORE, META_STORE], 'readwrite');
  tx.objectStore(STORE).put({ id, name, data: arrayBuffer, savedAt: Date.now() });
  tx.objectStore(META_STORE).put({ key: 'lastTrack', lastId: id, name, savedAt: Date.now() });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

export async function loadTrack(id) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const s  = tx.objectStore(STORE);
  return new Promise((resolve, reject) => {
    const r = s.get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror     = e => reject(e.target.error);
  });
}

export async function getSavedIds() {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const st = tx.objectStore(STORE);
  return new Promise((resolve, reject) => {
    const r = st.getAllKeys();
    r.onsuccess = () => resolve(r.result.filter(k => k !== LAST_KEY));
    r.onerror   = e => reject(e.target.error);
  });
}

export async function getLastTrackMeta() {
  const db = await openDB();
  const tx = db.transaction(META_STORE, 'readonly');
  const st = tx.objectStore(META_STORE);
  return new Promise((resolve, reject) => {
    const r = st.get('lastTrack');
    r.onsuccess = () => resolve(r.result || null);
    r.onerror   = e => reject(e.target.error);
  });
}
