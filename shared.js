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

// The gs.resetEpoch value in effect when this device last claimed a
// team — compared later against the current epoch to tell "a full
// reset happened since I joined" (treat this phone as a brand-new
// player) apart from "my team was just released mid-game" (a same
// -group phone swap, no need to re-read the rules). See resetEpoch().
export function getMyTeamEpoch() {
  const v = localStorage.getItem('myTeamEpoch');
  return v ? parseInt(v) : 0;
}

export function setMyTeamEpoch(e) {
  if (e == null) localStorage.removeItem('myTeamEpoch');
  else localStorage.setItem('myTeamEpoch', String(e));
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

// Players per team — 2 or 3, chosen by the admin in Game Setup
export function teamSize(gs) {
  return gs && gs.teamSize === 3 ? 3 : 2;
}

// The players on a team (entered by the admin in Game Setup). Only an
// EMPTY roster gets the generic fallback — a partially-filled roster is
// left as-is, not padded — and the fallback itself is sized to the
// game's current team size, so a 3-player game doesn't show two names.
export function playerNames(gs, team) {
  const p = ((gs && gs.players && gs.players[team]) || []).filter(n => n);
  if (p.length) return p;
  const size = teamSize(gs);
  return size === 3 ? ['Player 1', 'Player 2', 'Player 3'] : ['Player 1', 'Player 2'];
}

// Bumped only by a FULL reset (never a restart, never a single team
// release) — see main.js's reset callback and getMyTeamEpoch() above.
export function resetEpoch(gs) {
  return (gs && gs.resetEpoch) || 0;
}

// ── ADMIN MODE ────────────────────────────────────────────────────
// Unlocked per-device with the admin password (Settings → Admin)
export function isAdminMode() {
  return localStorage.getItem('adminMode') === '1';
}

export function setAdminMode(on) {
  if (on) localStorage.setItem('adminMode', '1');
  else localStorage.removeItem('adminMode');
}

// ── CHALLENGE ATTEMPTS ────────────────────────────────────────────
// A team only sees an area's challenge text once it has STARTED an
// attempt there (gs.attempts[team][key] = { startedAt }) — and starting
// commits the team to recording a pass or a fail
export function getAttempt(gs, team, key) {
  return (gs && gs.attempts && gs.attempts[team] && gs.attempts[team][key]) || null;
}

// Once a team has started a challenge it has SEEN the text forever
export function hasStarted(gs, team, key) {
  return !!getAttempt(gs, team, key);
}

// …but the attempt only counts as in-progress in the area's current
// era. Every pass (claim/steal) bumps the era, so a team returning
// after someone else passed must press Start again (fresh timer, and
// the steal-duel registration happens properly).
export function getCurrentAttempt(gs, team, key) {
  const att = getAttempt(gs, team, key);
  if (!att) return null;
  const a = gs.areas && gs.areas[key];
  if (!a) return null;
  return (att.era || 0) === (a.era || 0) ? att : null;
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

// ── INSTANT WIN ───────────────────────────────────────────────────
// The winning post is more than half the areas' worth of points
// (11 with 21 areas) — and BONUS points count towards it, so a team
// can win on the spot with fewer areas plus bonuses.
export function winThreshold(gs) {
  return Math.floor(Object.keys(gs.areas || {}).length / 2) + 1;
}

export function instantWinner(gs) {
  const { score } = getScores(gs);
  const threshold = winThreshold(gs);
  for (const t of [1, 2, 3]) {
    if (score[t] >= threshold) return { team: t, score: score[t], threshold };
  }
  return null;
}

// ── GAME TIMER / GAME OVER ────────────────────────────────────────
export function isGameOver(gs) {
  if (!gs) return false;
  if (gs.winner) return true;
  return !!(gs.timer && gs.timer.endsAt && Date.now() >= gs.timer.endsAt);
}

// Returns true (and tells the player) when the game is over — call at the
// top of any claim/steal action to soft-block it
export function gameOverGuard(gs) {
  if (!isGameOver(gs)) return false;
  // fire-and-forget import avoids a hard module cycle at load time
  import('./modal.js').then(({ showInfo }) => {
    if (gs.winner) {
      showInfo('🏆 Game over', esc(teamName(gs, gs.winner.team)) + ' reached the winning score!');
    } else {
      showInfo('⏱️ Game over', 'The countdown has ended — no more areas can be claimed or stolen.<br>Check the leaderboard for the final standings.');
    }
  });
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
  if (!gs.attempts) gs.attempts = {};
  if (!gs.players) gs.players = {};
  [1, 2, 3].forEach(t => {
    if (!gs.attempts[t]) gs.attempts[t] = {};
    const p = gs.players[t];
    if (!p) gs.players[t] = [];
    else if (!Array.isArray(p)) gs.players[t] = Object.values(p);
  });
}

export function sanitiseForFirebase(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    return value === undefined ? null : value;
  }));
}

// ── SCORING ───────────────────────────────────────────────────────
// Score = 1 point per area owned, +1 for owning the MOST areas of each
// group below (ties award nobody), +1 for the (uniquely) biggest
// connected group of areas.
export const bonusSets = [
  { label: 'Most Birches', emoji: '🌲', names: ['Birches 1', 'Birches 2', 'Birches 3'] },
  { label: 'Most Willows', emoji: '🌿', names: ['Willows 1', 'Willows 2', 'Willows 4', 'Willows 5'] },
  { label: 'Most Oaks',    emoji: '🌳', names: ['Oaks 1', 'Oaks 2', 'Oaks 3', 'Oaks 4'] },
  { label: 'Most Glades',  emoji: '🏕️', names: ['RPG Glade', 'SD Glade'] },
];

// Returns { counts, locked, cluster, bonuses (labels per team), score }
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

  const bonuses = { 1: [], 2: [], 3: [] };
  bonusSets.forEach(set => {
    const held = { 1: 0, 2: 0, 3: 0 };
    set.names.forEach(n => {
      const a = gs.areas && gs.areas[toKey(n)];
      if (a && held[a.owner] !== undefined) held[a.owner]++;
    });
    const max = Math.max(held[1], held[2], held[3]);
    if (max === 0) return;
    const leaders = [1, 2, 3].filter(t => held[t] === max);
    if (leaders.length === 1) bonuses[leaders[0]].push(set.emoji + ' ' + set.label);
  });

  // Biggest connected group: +1, but only for a unique winner
  const maxCluster = Math.max(cluster[1], cluster[2], cluster[3]);
  if (maxCluster > 0) {
    const leaders = [1, 2, 3].filter(t => cluster[t] === maxCluster);
    if (leaders.length === 1) bonuses[leaders[0]].push('🔗 Most connected (' + maxCluster + ')');
  }

  const score = {
    1: counts[1] + bonuses[1].length,
    2: counts[2] + bonuses[2].length,
    3: counts[3] + bonuses[3].length,
  };

  return { counts, locked, cluster, bonuses, score };
}

// Sort teams by score; locked areas break ties
export function rankTeams(gs) {
  const { counts, locked, score } = getScores(gs);
  return [1, 2, 3].sort((a, b) =>
    (score[b] - score[a]) || (locked[b] - locked[a]) || (counts[b] - counts[a])
  );
}
