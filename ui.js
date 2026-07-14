import { states, gameState, toKey, getMyTeam, esc, teamName, allAreas,
         getScores, rankTeams, isVisited } from './shared.js';
import { updateAreaLayers } from './map.js';
import { claimArea, scoutArea } from './actions.js';

export function renderAll(gs) {
  updateLeaderboard(gs);
  updateMapScoreboard(gs);
  updateAreaLayers(gs);
  renderAreasPanel(gs);
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

// ── AREAS SCREEN ──────────────────────────────────────────────────
// One card per area: status, the challenge (if scouted), the result to
// beat, and the same actions as the map popup
function renderAreasPanel(gs) {
  const list = document.getElementById('areas-list');
  if (!list) return;

  const myTeam  = getMyTeam();
  const isAdmin = myTeam === null;
  list.innerHTML = '';

  allAreas.forEach(area => {
    const key = toKey(area.name);
    const a   = gs.areas && gs.areas[key];
    if (!a) return;

    const expected    = { owner: a.owner, locked: !!a.locked };
    const isUnclaimed = a.owner === 0;
    const isMine      = myTeam !== null && a.owner === myTeam;
    const revealed    = isAdmin || isVisited(gs, myTeam, key);

    const chipColor = a.locked ? '#9b59b6' : states[a.owner].color;
    const chipText  = a.locked
      ? '🔒 ' + teamName(gs, a.owner)
      : isUnclaimed ? 'Unclaimed' : teamName(gs, a.owner);

    let challengeHTML;
    if (revealed) {
      challengeHTML =
        '<div style="font-size:12px;color:#374151;margin-top:6px;line-height:1.5;">' +
          '<span style="font-weight:700;color:#f4a300;">⚡ Challenge:</span> ' +
          esc(area.challenge || '—') +
        '</div>' +
        (!isUnclaimed
          ? '<div style="font-size:12px;color:#374151;margin-top:4px;">' +
              '<span style="font-weight:700;">🎯 Result to beat:</span> ' + esc(a.result || '—') +
            '</div>'
          : '');
    } else {
      challengeHTML =
        '<div style="font-size:12px;color:#9ca3af;margin-top:6px;font-style:italic;">' +
          '❓ Not scouted yet — go there to reveal the challenge.' +
        '</div>';
    }

    let buttonsHTML = '';
    if (!a.locked && myTeam !== null && !isMine && revealed) {
      buttonsHTML =
        '<div class="card-buttons" style="margin-top:10px;">' +
          '<button class="btn" data-action="claim" style="background:' + states[myTeam].color + ';">' +
            (isUnclaimed ? '⛺ Claim' : '😈 Steal & Lock') +
          '</button>' +
        '</div>';
    } else if (myTeam !== null && !revealed) {
      buttonsHTML =
        '<div class="card-buttons" style="margin-top:10px;">' +
          '<button class="btn btn-amber" data-action="scout">📍 We\'re Here — Reveal</button>' +
        '</div>';
    }

    const statusNote = a.locked
      ? '<div style="font-size:11px;color:#9ca3af;margin-top:6px;">Stolen areas are locked for the rest of the game.</div>'
      : (isMine
        ? '<div style="font-size:11px;color:#9ca3af;margin-top:6px;">Yours — another team can steal it by beating your result.</div>'
        : '');

    const card = document.createElement('div');
    card.className = 'challenge-card';
    card.innerHTML =
      '<div class="card-title">' +
        '<span class="card-badge" style="background:' + chipColor + ';">' + esc(chipText) + '</span>' +
        esc(area.name) +
      '</div>' +
      challengeHTML +
      statusNote +
      '<div class="error-msg"></div>' +
      buttonsHTML;

    const errorEl = card.querySelector('.error-msg');
    function showError(msg) {
      errorEl.textContent   = msg;
      errorEl.style.display = 'block';
    }

    const claimBtn = card.querySelector('[data-action="claim"]');
    if (claimBtn) claimBtn.addEventListener('click', async () => {
      const confirmMsg = isUnclaimed
        ? '⛺ Claim ' + area.name + '?\n\nOnly press this once your team has genuinely completed the challenge!'
        : '😈 Steal ' + area.name + '?\n\nOnly press this if your team genuinely BEAT the result "' +
          (a.result || '—') + '".\nStolen areas lock permanently!';
      if (!window.confirm(confirmMsg)) return;
      const result = window.prompt(
        '🎯 What result did your team get?\n(e.g. "14 catches", "38 seconds" — this is what others must beat)'
      );
      if (result === null) return;
      const trimmed = result.trim().slice(0, 60);
      if (!trimmed) { showError('You must record a result.'); return; }
      const res = await claimArea(key, myTeam, expected, trimmed);
      if (!res.ok && res.reason) showError(res.reason);
    });

    const scoutBtn = card.querySelector('[data-action="scout"]');
    if (scoutBtn) scoutBtn.addEventListener('click', async () => {
      const ok = window.confirm(
        '📍 Reveal the challenge at ' + area.name + '?\n\n' +
        'Honour system: only do this if your team is genuinely AT this area.'
      );
      if (!ok) return;
      await scoutArea(key, myTeam, false);
    });

    list.appendChild(card);
  });
}
