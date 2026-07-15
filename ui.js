import { states, esc, teamName, getScores, rankTeams } from './shared.js';
import { updateAreaLayers } from './map.js';

export function renderAll(gs) {
  updateLeaderboard(gs);
  updateActivity(gs);
  updateMapScoreboard(gs);
  updateAreaLayers(gs);
}

// ── "RIGHT NOW" PANEL ─────────────────────────────────────────────
// Attempts in progress (with age) and each team's permanent lockouts,
// so the state of the board is readable without tapping every zone
function updateActivity(gs) {
  const el = document.getElementById('lb-activity');
  if (!el) return;

  const rows = [];

  Object.entries(gs.areas || {}).forEach(([key, a]) => {
    if (!a.attemptingBy || a.locked) return;
    const att = (gs.attempts && gs.attempts[a.attemptingBy] && gs.attempts[a.attemptingBy][key]) || null;
    const mins = att ? Math.floor((Date.now() - att.startedAt) / 60000) : null;
    const age  = mins === null ? '' : (mins < 1 ? 'just started' : mins + ' min');
    rows.push(
      '<div class="lb-row"><div class="lb-left">' +
        '<div class="lb-dot" style="background:' + states[a.attemptingBy].color + '"></div>' +
        '<span>' + (a.owner !== 0 ? '⚔️' : '⏳') + ' ' + esc(teamName(gs, a.attemptingBy)) +
        ' at <strong>' + esc(a.displayName) + '</strong>' +
        (a.owner !== 0 ? ' (stealing from ' + esc(teamName(gs, a.owner)) + ')' : '') +
        '</span></div>' +
        '<div style="font-size:12px;font-weight:600;color:#9ca3af;">' + esc(age) + '</div></div>'
    );
  });

  [1, 2, 3].forEach(t => {
    const lockedOut = Object.values(gs.areas || {})
      .filter(a => !a.locked && (a.failedBy || []).includes(t))
      .map(a => a.displayName)
      .sort();
    if (!lockedOut.length) return;
    rows.push(
      '<div class="lb-row"><div class="lb-left" style="align-items:flex-start;">' +
        '<div class="lb-dot" style="background:' + states[t].color + ';margin-top:3px;"></div>' +
        '<span style="font-size:12px;color:#6b7280;">❌ ' + esc(teamName(gs, t)) +
        ' locked out of: ' + lockedOut.map(esc).join(', ') + '</span></div></div>'
    );
  });

  el.innerHTML = rows.length
    ? rows.join('')
    : '<div style="font-size:12px;color:#9ca3af;font-style:italic;">Nothing happening right now — get out there!</div>';
}

// Mini scoreboard on the map: each team's score (areas + bonuses)
function updateMapScoreboard(gs) {
  const el = document.getElementById('map-scoreboard');
  if (!el) return;
  const { bonuses, score } = getScores(gs);
  el.innerHTML = [1, 2, 3].map(t =>
    '<span style="display:inline-flex;align-items:center;gap:4px;">' +
      '<span style="width:10px;height:10px;border-radius:50%;background:' +
        states[t].color + ';display:inline-block;"></span>' +
      score[t] +
      (bonuses[t].length ? '<span style="font-size:10px;color:#f59e0b;">★' + bonuses[t].length + '</span>' : '') +
    '</span>'
  ).join('');
}

// ── LEADERBOARD ───────────────────────────────────────────────────
function updateLeaderboard(gs) {
  const { counts, locked, bonuses, score } = getScores(gs);
  const sorted = rankTeams(gs);

  const winnerEl = document.getElementById('lb-winner-banner');
  if (winnerEl) {
    if (gs.winner) {
      winnerEl.style.display = 'block';
      winnerEl.style.background = states[gs.winner.team].color;
      winnerEl.textContent = '🏆 ' + teamName(gs, gs.winner.team) +
        ' reached the winning score and WINS!';
    } else {
      winnerEl.style.display = 'none';
    }
  }

  const lbEl = document.getElementById('leaderboard-rows');
  if (!lbEl) return;

  lbEl.innerHTML = '';
  sorted.forEach((i, rank) => {
    const medal = ['🥇', '🥈', '🥉'][rank];
    const bonusLine = bonuses[i].length
      ? '<div style="font-size:11px;color:#f59e0b;font-weight:600;padding-left:24px;line-height:1.5;">' +
        bonuses[i].map(esc).join(' · ') + '</div>'
      : '';
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.innerHTML =
      '<div class="lb-left" style="flex-direction:column;align-items:flex-start;gap:2px;">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<div class="lb-dot" style="background:' + states[i].color + '"></div>' +
          '<span>' + medal + ' ' + esc(teamName(gs, i)) + '</span>' +
        '</div>' +
        bonusLine +
      '</div>' +
      '<div class="lb-value">' + score[i] +
        '<span style="font-size:12px;font-weight:600;color:#6b7280;margin-left:6px;">' + counts[i] + ' areas</span>' +
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
