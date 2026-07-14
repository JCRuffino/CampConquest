import { connections } from './areas.js';

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
// { name, polygon, row, col, challenge }
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

// ── SCOUTING ──────────────────────────────────────────────────────
// A team only sees an area's challenge once one of its players has
// been there (gs.visited[team][key] = true)
export function isVisited(gs, team, key) {
  return !!(gs && gs.visited && gs.visited[team] && gs.visited[team][key]);
}

// Ray-casting point-in-polygon; polygon is [[lat, lng], …]
export function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── SCORING: LARGEST CONNECTED GROUP ──────────────────────────────
// Stateside Scramble style — a team's score is the size of the biggest
// group of its zones that are all connected to each other (via the
// connections defined in areas.js).
const adjacency = {};
connections.forEach(([a, b]) => {
  const ka = toKey(a), kb = toKey(b);
  (adjacency[ka] = adjacency[ka] || []).push(kb);
  (adjacency[kb] = adjacency[kb] || []).push(ka);
});

export function largestCluster(gs, team) {
  const owned = new Set(
    Object.entries(gs.areas || {})
      .filter(([, a]) => a.owner === team)
      .map(([k]) => k)
  );
  let best = 0;
  const seen = new Set();
  owned.forEach(start => {
    if (seen.has(start)) return;
    let size = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop();
      size++;
      (adjacency[k] || []).forEach(n => {
        if (owned.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      });
    }
    if (size > best) best = size;
  });
  return best;
}

// ── GAME TIMER / GAME OVER ────────────────────────────────────────
export function isGameOver(gs) {
  return !!(gs && gs.timer && gs.timer.endsAt && Date.now() >= gs.timer.endsAt);
}

// Returns true (and tells the player) when the game is over — call at the
// top of any claim/steal action to soft-block it
export function gameOverGuard(gs) {
  if (!isGameOver(gs)) return false;
  window.alert('⏱️ The game has ended!\n\nNo more areas can be claimed or stolen.\nCheck the leaderboard for the final standings.');
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

// Firebase strips empty objects/arrays — restore the containers the
// rest of the code assumes exist
export function fixArrays(gs) {
  if (!gs.areas) gs.areas = {};
  Object.values(gs.areas).forEach(a => {
    if (!a.failedBy) a.failedBy = [];
    else if (!Array.isArray(a.failedBy)) a.failedBy = Object.values(a.failedBy);
  });
  if (!gs.visited) gs.visited = {};
  [1, 2, 3].forEach(t => {
    if (!gs.visited[t]) gs.visited[t] = {};
  });
}

export function sanitiseForFirebase(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    return value === undefined ? null : value;
  }));
}

// ── SCORING ───────────────────────────────────────────────────────
// Returns { counts: {1,2,3,0}, locked: {1,2,3}, cluster: {1,2,3} }
export function getScores(gs) {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const locked = { 1: 0, 2: 0, 3: 0 };
  Object.values(gs.areas || {}).forEach(a => {
    counts[a.owner] = (counts[a.owner] || 0) + 1;
    if (a.owner && a.locked) locked[a.owner]++;
  });
  const cluster = {
    1: largestCluster(gs, 1),
    2: largestCluster(gs, 2),
    3: largestCluster(gs, 3),
  };
  return { counts, locked, cluster };
}

// Sort teams by largest connected group; total areas then locked areas
// break ties
export function rankTeams(gs) {
  const { counts, locked, cluster } = getScores(gs);
  return [1, 2, 3].sort((a, b) =>
    (cluster[b] - cluster[a]) || (counts[b] - counts[a]) || (locked[b] - locked[a])
  );
}
