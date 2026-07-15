import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue, remove, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { sanitiseForFirebase, fixArrays, getGameCode } from './shared.js';

// ── FIREBASE CONFIG ───────────────────────────────────────────────
// This config is public by design — the data is protected by the
// security rules, which only allow access under
// camp/<secret game code>. See README.md.
const firebaseConfig = {
  apiKey: "AIzaSyD_yYZDs-fEBsLYYoflFZ4u5ZdsGM46d-o",
  authDomain: "campconquest.firebaseapp.com",
  databaseURL: "https://campconquest-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "campconquest",
  storageBucket: "campconquest.firebasestorage.app",
  messagingSenderId: "191567680796",
  appId: "1:191567680796:web:36c74453c5fdebc27516d9"
};

// All data lives under camp/<game code> — the code is entered by each
// player on first load and is never committed to the repo
function DB_ROOT() {
  return 'camp/' + getGameCode();
}

const app  = initializeApp(firebaseConfig);
const db   = getDatabase(app);
const auth = getAuth(app);

// ── ANONYMOUS AUTH ────────────────────────────────────────────────
const authReady = signInAnonymously(auth)
  .then(() => {
    console.log('✅ Firebase: signed in anonymously');
  })
  .catch(e => {
    console.error('❌ Firebase: anonymous auth failed:', e);
    throw e;
  });

// ── DEVICE ID ─────────────────────────────────────────────────────
// The anonymous auth UID — security rules only let a device write to
// playerLocations/<its own uid>, so IDs must come from auth
function getDeviceId() {
  return auth.currentUser.uid;
}

// ── GAME STATE WRITE ──────────────────────────────────────────────
// Full overwrite — only for creating/resetting the game
export async function pushState(gs) {
  await authReady;
  const clean = sanitiseForFirebase(gs);
  return set(ref(db, DB_ROOT() + '/gameState'), clean);
}

// Atomic mutation — runs `mutator` against the server's current state
// inside a transaction, so concurrent actions from different players
// merge instead of overwriting each other. The mutator receives the
// current state and must return it to commit, or return nothing to
// abort (e.g. a validation check failed against the latest state).
export async function mutateState(mutator) {
  await authReady;
  const result = await runTransaction(ref(db, DB_ROOT() + '/gameState'), (current) => {
    if (current === null) return undefined;
    fixArrays(current);
    const updated = mutator(current);
    return updated ? sanitiseForFirebase(updated) : undefined;
  });
  if (!result.committed) console.warn('⚠️ Game state change was not committed');
  return result.committed;
}

// ── GAME STATE READ ───────────────────────────────────────────────
export function listenToGameState(callback, onError) {
  authReady
    .then(() => {
      onValue(
        ref(db, DB_ROOT() + '/gameState'),
        (snapshot) => {
          if (snapshot.exists()) callback(snapshot.val());
          else callback(null);
        },
        (error) => {
          console.error('❌ Failed to read data from Firebase:', error);
          if (onError) onError(error);
        }
      );
    })
    .catch(e => {
      console.error('❌ Firebase auth not ready, cannot listen:', e);
      if (onError) onError(e);
    });
}

// ── PLAYER LOCATIONS WRITE ────────────────────────────────────────
export async function pushPlayerLocation(team, lat, lng, name) {
  await authReady;
  const id = getDeviceId();
  return set(ref(db, DB_ROOT() + '/playerLocations/' + id), {
    team, lat, lng, name,
    ts: Date.now()
  });
}

export async function removePlayerLocation() {
  await authReady;
  const id = getDeviceId();
  return remove(ref(db, DB_ROOT() + '/playerLocations/' + id));
}

// ── PLAYER LOCATIONS READ ─────────────────────────────────────────
export function listenToPlayerLocations(callback) {
  authReady.then(() => {
    onValue(ref(db, DB_ROOT() + '/playerLocations'), (snapshot) => {
      callback(snapshot.exists() ? snapshot.val() : {});
    });
  });
}

// ── GAME LOG WRITE ────────────────────────────────────────────────
// The timestamp is always the SERVER's clock — a phone with a skewed
// clock would otherwise break history ordering and suppress everyone
// else's toasts (which fire on timestamp > last-seen)
export async function pushLog(entry) {
  await authReady;
  return push(ref(db, DB_ROOT() + '/gameLog'), { ...entry, timestamp: serverTimestamp() });
}

export async function clearLog() {
  await authReady;
  return set(ref(db, DB_ROOT() + '/gameLog'), null);
}

// ── CONNECTION STATE ──────────────────────────────────────────────
// True/false as the client's link to the RTDB comes and goes — used
// for the "reconnecting" indicator (reads go silently stale otherwise)
export function listenToConnection(callback) {
  authReady.then(() => {
    onValue(ref(db, '.info/connected'), snap => callback(!!snap.val()));
  });
}

// ── GAME LOG READ ─────────────────────────────────────────────────
// Returns an unsubscribe function so callers can detach the listener
export function listenToLog(callback) {
  let unsubscribe = null;
  let cancelled   = false;
  authReady.then(() => {
    if (cancelled) return;
    unsubscribe = onValue(ref(db, DB_ROOT() + '/gameLog'), snap => {
      const data    = snap.val();
      const entries = data
        ? Object.values(data).sort((a, b) => b.timestamp - a.timestamp)
        : [];
      callback(entries);
    });
  });
  return () => {
    cancelled = true;
    if (unsubscribe) unsubscribe();
  };
}
