import { states, gameState, toKey, getMyTeam, esc, teamName,
         allAreas, getScores, rankTeams } from './shared.js';
import { updateAreaLayers } from './map.js';
import { claimArea, lockArea, failControl } from './actions.js';

export function renderAll(gs) {
  updateLeaderboard(gs);
  updateMapScoreboard(gs);
  updateAreaLayers(gs);
  renderAreasPanel(gs);
}

// Mini scoreboard on the map: a dot and area count per team
function updateMapScoreboard(gs) {
  const el = document.getElementById('map-scoreboard');
  if (!el) return;
  const { counts, locked } = getScores(gs);
  el.innerHTML = [1, 2, 3].map(t =>
    '<span style="display:inline-flex;align-items:center;gap:4px;">' +
      '<span style="width:10px;height:10px;border-radius:50%;background:' +
        states[t].color + ';display:inline-block;"></span>' +
      counts[t] + (locked[t] ? '<span style="font-size:10px;">🔒' + locked[t] + '</span>' : '') +
    '</span>'
  ).join('');
}

// ── LEADERBOARD ───────────────────────────────────────────────────
function updateLeaderboard(gs) {
  const { counts, locked } = getScores(gs);
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
      '<div class="lb-value">' + counts[i] +
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
// One card per area: status, both challenges, and the same actions as
// the map popup so everything can be driven from this list too
function renderAreasPanel(gs) {
  const list = document.getElementById('areas-list');
  if (!list) return;

  const myTeam = getMyTeam();
  list.innerHTML = '';

  allAreas.forEach(area => {
    const key = toKey(area.name);
    const a   = gs.areas && gs.areas[key];
    if (!a) return;

    const expected    = { owner: a.owner, locked: !!a.locked };
    const isUnclaimed = a.owner === 0;
    const isMine      = myTeam !== null && a.owner === myTeam;
    const iFailed     = myTeam !== null && (a.failedControl || []).includes(myTeam);

    const chipColor = a.locked ? '#9b59b6' : states[a.owner].color;
    const chipText  = a.locked
      ? '🔒 ' + teamName(gs, a.owner)
      : isUnclaimed ? 'Unclaimed' : teamName(gs, a.owner);

    const failedNote = (a.failedControl || []).length > 0
      ? '<div style="font-size:11px;color:#9ca3af;margin-top:6px;">Control failed by: ' +
        (a.failedControl || []).map(t => esc(teamName(gs, t))).join(', ') + '</div>'
      : '';

    let buttonsHTML = '';
    if (!a.locked && myTeam !== null) {
      if (isMine && !iFailed) {
        buttonsHTML =
          '<div class="card-buttons" style="margin-top:10px;">' +
            '<button class="btn" data-action="lock" style="background:#9b59b6;">🔒 Lock It In</button>' +
            '<button class="btn btn-neutral" data-action="fail">❌ We Failed</button>' +
          '</div>';
      } else if (!isMine) {
        buttonsHTML =
          '<div class="card-buttons" style="margin-top:10px;">' +
            '<button class="btn" data-action="claim" style="background:' + states[myTeam].color + ';">' +
              (isUnclaimed ? '⛺ Claim' : '😈 Steal') +
            '</button>' +
          '</div>';
      }
    }

    const card = document.createElement('div');
    card.className = 'challenge-card';
    card.innerHTML =
      '<div class="card-title">' +
        '<span class="card-badge" style="background:' + chipColor + ';">' + esc(chipText) + '</span>' +
        esc(area.name) +
      '</div>' +
      '<div style="font-size:12px;color:#374151;margin-top:6px;line-height:1.5;">' +
        '<span style="font-weight:700;color:#f4a300;">⚡ Initial:</span> ' +
        esc(area.initialChallenge || '—') +
      '</div>' +
      '<div style="font-size:12px;color:#374151;margin-top:4px;line-height:1.5;">' +
        '<span style="font-weight:700;color:#9b59b6;">🔒 Control:</span> ' +
        esc(area.controlChallenge || '—') +
      '</div>' +
      failedNote +
      '<div class="error-msg"></div>' +
      buttonsHTML;

    const errorEl = card.querySelector('.error-msg');
    function showError(msg) {
      errorEl.textContent   = msg;
      errorEl.style.display = 'block';
    }

    card.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        let confirmMsg, fn;
        if (action === 'claim') {
          confirmMsg = (isUnclaimed ? '⛺ Claim ' : '😈 Steal ') + area.name + '?\n\n' +
            'Only press this once your team has genuinely completed the initial challenge!';
          fn = claimArea;
        } else if (action === 'lock') {
          confirmMsg = '🔒 Lock ' + area.name + '?\n\n' +
            'Only press this once your team has genuinely completed the control challenge.';
          fn = lockArea;
        } else {
          confirmMsg = '❌ Record a failed control challenge at ' + area.name + '?\n\n' +
            'Your team will NOT be able to attempt it again.';
          fn = failControl;
        }
        if (!window.confirm(confirmMsg)) return;
        const res = await fn(key, myTeam, expected);
        if (!res.ok && res.reason) showError(res.reason);
      });
    });

    list.appendChild(card);
  });
}
