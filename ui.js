import { states, esc, teamName, getScores, rankTeams } from './shared.js';
import { updateAreaLayers } from './map.js';

export function renderAll(gs) {
  updateLeaderboard(gs);
  updateMapScoreboard(gs);
  updateAreaLayers(gs);
}

// Mini scoreboard on the map: per team, the size of its largest
// connected group (the score) with total zones in brackets
function updateMapScoreboard(gs) {
  const el = document.getElementById('map-scoreboard');
  if (!el) return;
  const { counts, cluster } = getScores(gs);
  el.innerHTML = [1, 2, 3].map(t =>
    '<span style="display:inline-flex;align-items:center;gap:4px;">' +
      '<span style="width:10px;height:10px;border-radius:50%;background:' +
        states[t].color + ';display:inline-block;"></span>' +
      '🔗' + cluster[t] +
      '<span style="font-size:10px;color:#9ca3af;">(' + counts[t] + ')</span>' +
    '</span>'
  ).join('');
}

// ── LEADERBOARD ───────────────────────────────────────────────────
function updateLeaderboard(gs) {
  const { counts, locked, cluster } = getScores(gs);
  const sorted = rankTeams(gs);

  const lbEl = document.getElementById('leaderboard-rows');
  if (!lbEl) return;

  lbEl.innerHTML = '';
  sorted.forEach((i, rank) => {
    const medal = ['🥇', '🥈', '🥉'][rank];
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.innerHTML =
      '<div class="lb-left">' +
        '<div class="lb-dot" style="background:' + states[i].color + '"></div>' +
        '<span>' + medal + ' ' + esc(teamName(gs, i)) + '</span>' +
      '</div>' +
      '<div class="lb-value">🔗 ' + cluster[i] +
        '<span style="font-size:12px;font-weight:600;color:#6b7280;margin-left:6px;">' + counts[i] + ' total</span>' +
        '<span style="font-size:12px;font-weight:600;color:#9b59b6;margin-left:6px;">🔒 ' + locked[i] + '</span>' +
      '</div>';
    lbEl.appendChild(row);
  });

  const unclaimedRow = document.createElement('div');
  unclaimedRow.className = 'lb-row';
  unclaimedRow.innerHTML =
    '<div class="lb-left">' +
      '<div class="lb-dot" style="background:' + states[0].color + '"></div>' +
      '<span style="color:#6b7280;">Unclaimed</span>' +
    '</div>' +
    '<div class="lb-value" style="color:#9ca3af;">' + counts[0] + '</div>';
  lbEl.appendChild(unclaimedRow);

  // Per-team area breakdown
  const detailEl = document.getElementById('lb-area-breakdown');
  if (detailEl) {
    detailEl.innerHTML = '';
    sorted.forEach(t => {
      const owned = Object.entries(gs.areas || {})
        .filter(([, a]) => a.owner === t)
        .map(([, a]) => (a.locked ? '🔒 ' : '') + a.displayName)
        .sort();

      const row = document.createElement('div');
      row.className = 'lb-row';
      row.innerHTML =
        '<div class="lb-left" style="flex-direction:column;align-items:flex-start;gap:2px;">' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div class="lb-dot" style="background:' + states[t].color + '"></div>' +
            '<span>' + esc(teamName(gs, t)) + '</span>' +
          '</div>' +
          '<div style="font-size:11px;color:#9ca3af;padding-left:24px;line-height:1.4;">' +
            (owned.length ? owned.map(esc).join(', ') : '—') +
          '</div>' +
        '</div>';
      detailEl.appendChild(row);
    });
  }
}
