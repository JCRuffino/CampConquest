export const states = [
  { label: "Unclaimed", color: "#808080" },
  { label: "Team A",    color: "#e63946" },
  { label: "Team B",    color: "#1d6fd1" },
  { label: "Team C",    color: "#2a9d3f" },
];

// Escape user-supplied strings before inserting into innerHTML
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getMyTeam() {
  const v = localStorage.getItem('myTeam');
  return v ? parseInt(v) : null;
}

export function setMyTeam(t) {
  if (t === null) localStorage.removeItem('myTeam');
  else localStorage.setItem('myTeam', String(t));
}

// ── GAME CODE ─────────────────────────────────────────────────────
// The secret code that namespaces all data in Firebase
// (camp/<code>/…). The security rules only allow access under the
// right code, so the public repo exposes nothing — see README.
export function getGameCode() {
  return localStorage.getItem('gameCode') || null;
}

export function setGameCode(code) {
  if (!code) localStorage.removeItem('gameCode');
  else localStorage.setItem('gameCode', code);
}

// Lowercase letters/digits/dashes only, so it's always a valid
// Firebase path segment and there's no ambiguity when typing it
export function normalizeGameCode(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
}

// Areas merged from areas.js geometry + challenges.csv text:
// { name, polygon, initialChallenge, controlChallenge }
export const allAreas  = [];
export const gameState = { data: null };

export function toKey(name) {
  return name.replace(/[.#$\/\[\]]/g, '_');
}

export function teamName(gs, i) {
  if (!i || !states[i]) return 'Unclaimed';
  const names = (gs && gs.teamNames) || {};
  return names[i] || states[i].label;
}

export function findArea(key) {
  return allAreas.find(a => toKey(a.name) === key) || null;
}

// ── GAME TIMER ────────────────────────────────────────────────────
export function isGameOver(gs) {
  return !!(gs && gs.timer && gs.timer.endsAt && Date.now() >= gs.timer.endsAt);
}

// Returns true (and tells the player) when the game is over — call at the
// top of any claim/lock action to soft-block it after the countdown
export function gameOverGuard(gs) {
  if (!isGameOver(gs)) return false;
  window.alert('⏱️ The game has ended!\n\nNo more areas can be claimed or locked.\nCheck the leaderboard for the final standings.');
  return true;
}

export function formatCountdown(ms) {
  const s   = Math.max(0, Math.floor(ms / 1000));
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec);
}

// Firebase stores empty arrays as missing keys — restore them so the
// rest of the code can assume they exist
export function fixArrays(gs) {
  Object.values(gs.areas || {}).forEach(a => {
    if (!a.failedControl) a.failedControl = [];
    else if (!Array.isArray(a.failedControl)) a.failedControl = Object.values(a.failedControl);
  });
}

export function sanitiseForFirebase(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    return value === undefined ? null : value;
  }));
}

// ── SCORING ───────────────────────────────────────────────────────
// Returns { counts: {1,2,3,0}, locked: {1,2,3} }
export function getScores(gs) {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const locked = { 1: 0, 2: 0, 3: 0 };
  Object.values(gs.areas || {}).forEach(a => {
    counts[a.owner] = (counts[a.owner] || 0) + 1;
    if (a.owner && a.locked) locked[a.owner]++;
  });
  return { counts, locked };
}

// Sort teams by areas owned, locked areas as tiebreaker
export function rankTeams(gs) {
  const { counts, locked } = getScores(gs);
  return [1, 2, 3].sort((a, b) =>
    (counts[b] - counts[a]) || (locked[b] - locked[a])
  );
}
