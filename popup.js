// ── AREA POPUP ────────────────────────────────────────────────────
// The whole game is played through this popup: start/resolve attempts,
// blind steal verdicts, and the admin's per-area controls. The open
// popup re-renders itself when the area's state changes remotely.

import { states, gameState, toKey, getMyTeam, esc, teamName, teamSize,
         hasStarted, getCurrentAttempt, isAdminMode, formatCountdown } from './shared.js';
import { claimArea, failChallenge, startAttempt, adminSetArea, adminClearAttempt } from './actions.js';
import { showModal, showConfirm, showPrompt } from './modal.js';
import { setWakeLock } from './wakelock.js';
import { getMap, getAreaLayers } from './map.js';

// The currently open popup: { key, latlng, sig } — used to re-render
// it in place when a Firebase update changes this area
let open = null;
// While a modal flow (start/claim/fail) is running, don't yank the
// popup out from under the player
let busy = false;
let popupCloseHooked = false;

function buildSig(gs, key) {
  const a = gs.areas && gs.areas[key];
  if (!a) return '';
  const myTeam = getMyTeam();
  const att    = myTeam !== null ? getCurrentAttempt(gs, myTeam, key) : null;
  return JSON.stringify([
    a.owner, !!a.locked, a.attemptingBy || 0, (a.failedBy || []).join(','),
    a.result || '', a.era || 0, a.passMark || '', att ? att.startedAt : 0,
    !!gs.winner,
  ]);
}

// Called from updateAreaLayers on every state update
export function popupSync(gs) {
  if (!open || busy) return;
  const sig = buildSig(gs, open.key);
  if (sig === open.sig) return;
  const layer = getAreaLayers()[open.key];
  if (layer) openAreaPopup(layer.area, open.latlng);
}

function minutesAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  return m < 1 ? 'under a minute ago' : m + ' min ago';
}

export function openAreaPopup(area, latlng) {
  const map = getMap();
  const gs  = gameState.data;
  if (!gs || !gs.areas) return;
  const key = toKey(area.name);
  const a   = gs.areas[key];
  if (!a) return;

  if (!popupCloseHooked) {
    popupCloseHooked = true;
    map.on('popupclose', () => { if (!busy) open = null; });
  }

  const myTeam   = getMyTeam();
  const admin    = isAdminMode();
  const expected = { owner: a.owner, locked: !!a.locked };

  const isUnclaimed = a.owner === 0;
  const isMine      = myTeam !== null && a.owner === myTeam;
  const iFailed     = myTeam !== null && (a.failedBy || []).includes(myTeam);
  const attempt     = myTeam !== null ? getCurrentAttempt(gs, myTeam, key) : null;
  // Challenge text is revealed only once a team STARTS an attempt (or
  // if you're the owner — you passed it — or a password admin)
  const revealed    = admin || isMine || hasStarted(gs, myTeam, key);
  // Some challenges need a genuinely different version for 2-player
  // teams (not just reworded) — challenges.csv carries an optional
  // override, used only when the game is currently set to 2 per team
  const is2p          = teamSize(gs) === 2;
  const challengeText = (is2p && area.challenge2p) ? area.challenge2p : area.challenge;
  // The admin can override the CSV pass mark mid-game
  const basePassMark = (is2p && area.passMark2p) ? area.passMark2p : area.passMark;
  const passMark     = a.passMark || basePassMark;

  const statusText = a.locked
    ? '🔒 Locked by ' + esc(teamName(gs, a.owner)) + ' — cannot be taken'
    : isUnclaimed
      ? 'Unclaimed'
      : 'Claimed by ' + esc(teamName(gs, a.owner)) + ' — can be stolen';

  let body = '';
  let actionsHTML = '';

  if (revealed) {
    body =
      '<div style="margin-top:8px;">' +
        '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;' +
          'font-weight:700;color:white;background:#f4a300;">⚡ Challenge</span>' +
        '<div style="font-size:12px;color:#374151;margin-top:4px;line-height:1.5;">' +
          esc(challengeText || 'No challenge set') + '</div>' +
      '</div>';
    // Second-screen info (e.g. the animals to act, the Scout Promise)
    // stays behind a button so only the player who should read it does
    if (area.info) {
      body +=
        '<button id="info-btn" class="btn btn-neutral btn-sm btn-full" style="margin-top:8px;">' +
          '📄 Show extra info</button>';
    }
    // A stealing team is NOT shown the pass mark or the score to beat —
    // they attempt blind and only learn the owner's result after
    // committing their own
    if (passMark && (isUnclaimed || isMine || admin)) {
      body +=
        '<div style="font-size:12px;color:#374151;margin-top:6px;">' +
          '<span style="font-weight:700;">🎯 Pass mark:</span> ' + esc(passMark) +
        '</div>';
    }
    if (!isUnclaimed && (isMine || admin)) {
      body +=
        '<div style="font-size:12px;color:#374151;margin-top:6px;">' +
          '<span style="font-weight:700;">🏅 Result to beat:</span> ' +
          esc(a.result || '—') +
          ' <span style="color:#9ca3af;">(' + esc(teamName(gs, a.owner)) + ')</span>' +
        '</div>';
    }
  } else {
    body =
      '<div style="font-size:12px;color:#6b7280;margin-top:8px;line-height:1.5;">' +
        '❓ The challenge here is secret until your team starts an attempt.' +
      '</div>';
  }

  if ((a.failedBy || []).length > 0) {
    body += '<div style="font-size:11px;color:#9ca3af;margin-top:6px;">Locked out (failed): ' +
      (a.failedBy || []).map(t => esc(teamName(gs, t))).join(', ') + '</div>';
  }

  if (a.attemptingBy && !a.locked) {
    const attRec = (gs.attempts && gs.attempts[a.attemptingBy] && gs.attempts[a.attemptingBy][key]) || null;
    const age    = attRec ? ' (started ' + minutesAgo(attRec.startedAt) + ')' : '';
    body += '<div style="font-size:12px;color:#e63946;font-weight:700;margin-top:6px;">' +
      (a.owner !== 0 ? '⚔️ ' : '⏳ ') + esc(teamName(gs, a.attemptingBy)) +
      (a.owner !== 0 ? ' is contesting this area — win or lose, it locks!' : ' is attempting this challenge!') +
      esc(age) + '</div>';
  }

  if (a.locked) {
    body += '<div style="font-size:12px;color:#6b7280;margin-top:8px;">' +
      'This area is locked in for the rest of the game.</div>';
  } else if (isMine) {
    body += '<div style="font-size:12px;color:#6b7280;margin-top:8px;">' +
      'Your area — another team can steal it (and lock it) by beating your result. If their steal fails, it locks for you.</div>';
  } else if (myTeam === null) {
    if (!admin) {
      body += '<div style="font-size:12px;color:#9ca3af;margin-top:8px;">Join a team in Settings to play.</div>';
    }
  } else if (iFailed) {
    body += '<div style="font-size:12px;color:#e63946;font-weight:600;margin-top:8px;">' +
      '❌ Your team failed this challenge — this area is off-limits to you for the rest of the game.</div>';
  } else if (a.attemptingBy && a.attemptingBy !== myTeam) {
    body += isUnclaimed
      ? '<div style="font-size:12px;color:#f59e0b;font-weight:600;margin-top:8px;">' +
        '⏳ Wait — you can start if they fail.</div>'
      : '<div style="font-size:12px;color:#e63946;font-weight:600;margin-top:8px;">' +
        '🚫 Too late — ' + esc(teamName(gs, a.attemptingBy)) + ' got here first. Only one team can contest a claimed area.</div>';
  } else if (!attempt) {
    // Not started yet — starting reveals the challenge (and any timer,
    // which begins immediately: no warning, that's the fun) and commits
    // the team to a pass or a fail
    actionsHTML =
      '<button id="start-btn" class="btn btn-full" style="margin-top:10px;background:' +
      states[myTeam].color + ';">▶️ Start Challenge Attempt</button>' +
      '<div style="font-size:11px;color:#9ca3af;margin-top:6px;text-align:center;">' +
        'Starting reveals the challenge and commits your team to a pass or a fail.' +
        (isUnclaimed ? '' : ' Stealing shuts the other team out — win or lose, this area locks.') +
      '</div>';
  } else {
    // Attempt in progress — timer (if any) and resolve buttons
    if (area.timer) {
      const timerLabel = area.timer.mode === 'down'
        ? area.timer.minutes + '-minute countdown'
        : 'time elapsed';
      body +=
        '<div style="margin-top:10px;text-align:center;background:#111827;color:white;' +
          'border-radius:10px;padding:8px;">' +
          '<div style="font-size:10px;opacity:0.7;text-transform:uppercase;letter-spacing:0.05em;">' +
            timerLabel + '</div>' +
          '<div id="attempt-timer" style="font-size:22px;font-weight:800;">—</div>' +
        '</div>';
    }
    const verb = isUnclaimed ? '⛺ We Passed — Claim!' : '🏁 We\'re Done — Enter Our Result';
    actionsHTML =
      '<button id="claim-btn" class="btn btn-full" style="margin-top:10px;background:' +
      states[myTeam].color + ';">' + verb + '</button>' +
      '<button id="fail-btn" class="btn btn-neutral btn-full" style="margin-top:6px;">' +
        (isUnclaimed ? '❌ We Failed' : '❌ We Failed / Gave Up') + '</button>';
  }

  const content = document.createElement('div');
  content.className = 'popup-box';
  content.innerHTML =
    '<strong>' + esc(area.name) + '</strong>' +
    '<div class="popup-sub">' + statusText + '</div>' +
    body +
    '<div class="error-msg" id="popup-error"></div>' +
    actionsHTML;

  function showError(msg) {
    if (!msg) return;
    const el = content.querySelector('#popup-error');
    el.textContent   = msg;
    el.style.display = 'block';
  }

  function reopen() {
    openAreaPopup(area, latlng);
  }

  // Live ticker for the attempt timer
  const timerEl = content.querySelector('#attempt-timer');
  if (timerEl && attempt && area.timer) {
    const tick = () => {
      if (!timerEl.isConnected) { clearInterval(intv); return; }
      const elapsed = Date.now() - attempt.startedAt;
      if (area.timer.mode === 'down') {
        const remaining = area.timer.minutes * 60000 - elapsed;
        timerEl.textContent = remaining <= 0 ? "⏰ TIME'S UP" : formatCountdown(remaining);
        if (remaining <= 0) timerEl.style.color = '#f87171';
      } else {
        timerEl.textContent = formatCountdown(elapsed);
      }
    };
    const intv = setInterval(tick, 500);
    tick();
  }

  const startBtn = content.querySelector('#start-btn');
  if (startBtn) startBtn.addEventListener('click', async () => {
    busy = true;
    try {
      const ok = await showConfirm(
        '▶️ Start the challenge at ' + esc(area.name) + '?',
        'Only start when your team is <strong>at this area</strong> and ready.<br><br>' +
        'The challenge is revealed, any timer starts immediately, and your team must then record either a pass or a fail.' +
        (isUnclaimed ? '' : '<br><br><strong>Stealing shuts the other team out — win or lose, this area locks.</strong>'),
        '▶️ Start!', 'Not yet'
      );
      if (!ok) return;
      const res = await startAttempt(key, myTeam, expected);
      if (!res.ok) { showError(res.reason); return; }
      setWakeLock(true);
    } finally {
      busy = false;
    }
    reopen();
  });

  const infoBtn = content.querySelector('#info-btn');
  if (infoBtn) infoBtn.addEventListener('click', () => {
    showModal({
      title: '📄 Extra info',
      bodyHTML: area.info,
      buttons: [{ id: 'ok', label: 'Close', style: 'primary' }],
      dismissable: true,
    });
  });

  // Guess challenges carry a numeric answer in challenges.csv: results
  // must be numbers, and steals are judged by the app (closest wins)
  // without ever revealing the answer to the players
  const isGuess = area.answer != null;

  // Steal results are entered via showPrompt (a single field, no risk
  // of a stray Enter submitting the wrong button); claims use
  // promptClaim below, which folds the "only claim if you passed"
  // reminder into the same modal as the result field.
  async function promptResult(bodyText, prefill) {
    while (true) {
      const result = await showPrompt('🏅 Your result',
        isGuess ? 'Enter your guess as a number, e.g. "41.82".' : bodyText,
        { label: isGuess ? 'Your guess' : 'Result', value: prefill, maxlength: 60 });
      if (result === null) return null;
      if (!result) { prefill = ''; showError('You must record a result.'); continue; }
      if (isGuess && isNaN(parseFloat(result))) {
        prefill = result;
        showError('Your guess must be a number, e.g. "41.82".');
        continue;
      }
      return result;
    }
  }

  // Claiming an unclaimed area: one modal carries both the "only claim
  // if you passed" reminder and the result field, instead of a confirm
  // followed by a separate prompt
  async function promptClaim(prefill) {
    const reminderHTML = isGuess
      ? 'Lock in your team\'s guess — it becomes the score rivals must beat.'
      : 'Only claim if your team genuinely reached the pass mark' +
        (passMark ? ' (<strong>' + esc(passMark) + '</strong>)' : '') + '!';
    while (true) {
      const res = await showModal({
        title: '⛺ Claim ' + esc(area.name),
        bodyHTML: reminderHTML,
        fields: [{
          id: 'result',
          label: isGuess ? 'Your guess' : 'Result',
          value: prefill,
          placeholder: isGuess ? 'e.g. "41.82"' : 'e.g. "14 catches", "3:38"',
          maxlength: 60,
        }],
        buttons: [
          { id: 'claim', label: '⛺ We passed — Claim!', color: states[myTeam].color },
          { id: 'back',  label: 'Back', style: 'ghost' },
        ],
        dismissable: true,
      });
      if (!res || res.button === 'back') return null;
      const result = (res.values.result || '').trim();
      if (!result) { prefill = ''; showError('You must record a result.'); continue; }
      if (isGuess && isNaN(parseFloat(result))) {
        prefill = result;
        showError('Your guess must be a number, e.g. "41.82".');
        continue;
      }
      return result;
    }
  }

  const claimBtn = content.querySelector('#claim-btn');
  if (claimBtn) claimBtn.addEventListener('click', async () => {
    // For count-up challenges the elapsed time IS the natural result
    let suggested = '';
    if (area.timer && area.timer.mode === 'up' && attempt) {
      suggested = formatCountdown(Date.now() - attempt.startedAt);
    }

    busy = true;
    try {
      if (isUnclaimed) {
        const result = await promptClaim(suggested);
        if (result === null) return;
        const res = await claimArea(key, myTeam, expected, result);
        if (!res.ok) { showError(res.reason); return; }
        setWakeLock(false);
        getMap().closePopup();
        return;
      }

      // Steal: commit your result BLIND, then the owner's score is
      // revealed and the comparison settles the duel either way
      let prefill = suggested;
      while (true) {
        const result = await promptResult(
          'Be honest — you\'ll find out what you were up against next…', prefill);
        if (result === null) return; // abort — the attempt stays in progress

        // Closest-wins guesses: the app compares both guesses to the
        // stored answer and settles the duel itself — no going back
        // after the owner's guess is revealed
        const ownerVal = parseFloat(a.result);
        if (isGuess && !isNaN(ownerVal)) {
          const mineOff  = Math.abs(parseFloat(result) - area.answer);
          const ownerOff = Math.abs(ownerVal - area.answer);
          const win      = mineOff < ownerOff; // tie → the owner keeps it
          const verdict = await showModal({
            title: '🥁 The moment of truth',
            bodyHTML:
              esc(teamName(gs, a.owner)) + '\'s guess: <strong>' + esc(a.result) + '</strong><br>' +
              'Your guess: <strong>' + esc(result) + '</strong>' +
              '<div style="text-align:center;font-size:16px;font-weight:800;margin:10px 0;">' +
                (win
                  ? '🎉 Your guess is closer — you steal the area!'
                  : '🛡️ ' + esc(teamName(gs, a.owner)) + '\'s guess is closer (or equal) — it locks for them.') +
              '</div>',
            buttons: [win
              ? { id: 'go', label: '😈 Steal &amp; lock!', color: states[myTeam].color }
              : { id: 'go', label: '🔒 Lock it for ' + esc(teamName(gs, a.owner)), style: 'neutral' }],
            dismissable: false,
          });
          void verdict;
          const res = win
            ? await claimArea(key, myTeam, expected, result)
            : await failChallenge(key, myTeam, expected);
          if (!res.ok) { showError(res.reason); return; }
          setWakeLock(false);
          getMap().closePopup();
          return;
        }

        const verdict = await showModal({
          title: '🥁 The moment of truth',
          bodyHTML:
            'The score to beat, set by <strong>' + esc(teamName(gs, a.owner)) + '</strong>:' +
            '<div style="text-align:center;font-size:18px;font-weight:800;margin:10px 0;">"' + esc(a.result || '—') + '"</div>' +
            'Your result: <strong>"' + esc(result) + '"</strong>' +
            '<div style="font-size:12px;color:#6b7280;margin-top:8px;">A tie is not a beat — you must do strictly better to steal.</div>',
          buttons: [
            { id: 'beat',  label: '✅ We beat it — steal &amp; lock!', color: states[myTeam].color },
            { id: 'short', label: '🛡️ We fell short — locks for ' + esc(teamName(gs, a.owner)), style: 'neutral' },
            { id: 'back',  label: '↩ Go back', style: 'ghost' },
          ],
          dismissable: false, // an accidental tap must not settle an area forever
        });
        if (verdict.button === 'back') { prefill = result; continue; }

        const res = verdict.button === 'beat'
          ? await claimArea(key, myTeam, expected, result)
          : await failChallenge(key, myTeam, expected);
        if (!res.ok) { showError(res.reason); return; }
        setWakeLock(false);
        getMap().closePopup();
        return;
      }
    } finally {
      busy = false;
    }
  });

  const failBtn = content.querySelector('#fail-btn');
  if (failBtn) failBtn.addEventListener('click', async () => {
    busy = true;
    try {
      const ok = await showConfirm(
        '❌ Record a FAILED attempt?',
        isUnclaimed
          ? 'Your team will <strong>never</strong> be able to attempt ' + esc(area.name) + ' again.'
          : 'The steal has failed — ' + esc(area.name) + ' <strong>locks permanently</strong> for ' +
            esc(teamName(gs, a.owner)) + '!',
        'Yes, we failed', 'Back', 'danger'
      );
      if (!ok) return;
      const res = await failChallenge(key, myTeam, expected);
      if (!res.ok) { showError(res.reason); return; }
      setWakeLock(false);
      getMap().closePopup();
    } finally {
      busy = false;
    }
  });

  // ── Admin: full control over the area ──────────────────────────
  if (admin) {
    const adminDiv = document.createElement('div');
    adminDiv.innerHTML =
      '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;">' +
        '<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:6px;">⚙️ Admin: Set Area</div>' +
        '<select id="admin-owner-select" style="width:100%;margin-bottom:6px;">' +
          [0, 1, 2, 3].map(i =>
            '<option value="' + i + '"' + (i === a.owner ? ' selected' : '') + '>' +
            esc(teamName(gs, i)) + '</option>'
          ).join('') +
        '</select>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#374151;' +
          'text-transform:none;letter-spacing:0;font-weight:600;margin:0 0 6px;">' +
          '<input type="checkbox" id="admin-locked-check"' + (a.locked ? ' checked' : '') + ' ' +
            'style="width:auto;margin:0;" /> Locked' +
        '</label>' +
        '<input type="text" id="admin-result-input" maxlength="60" placeholder="Result to beat" ' +
          'value="' + esc(a.result || '') + '" ' +
          'style="width:100%;padding:6px 8px;border:1px solid #e5e7eb;border-radius:8px;' +
          'font-family:inherit;outline:none;margin-bottom:6px;box-sizing:border-box;" />' +
        '<input type="text" id="admin-passmark-input" maxlength="60" placeholder="Pass mark" ' +
          'value="' + esc(passMark || '') + '" ' +
          'style="width:100%;padding:6px 8px;border:1px solid #e5e7eb;border-radius:8px;' +
          'font-family:inherit;outline:none;margin-bottom:8px;box-sizing:border-box;" />' +
        '<button id="admin-apply-btn" class="btn btn-amber btn-full btn-sm">🔄 Apply</button>' +
        (a.attemptingBy && !a.locked
          ? '<button id="admin-unstick-btn" class="btn btn-neutral btn-full btn-sm" style="margin-top:6px;">' +
            '🧹 Clear stuck attempt (' + esc(teamName(gs, a.attemptingBy)) + ')</button>'
          : '') +
      '</div>';
    content.appendChild(adminDiv);

    adminDiv.querySelector('#admin-apply-btn').addEventListener('click', async () => {
      await adminSetArea(key, {
        owner:    parseInt(adminDiv.querySelector('#admin-owner-select').value),
        locked:   adminDiv.querySelector('#admin-locked-check').checked,
        result:   adminDiv.querySelector('#admin-result-input').value.trim().slice(0, 60),
        passMark: adminDiv.querySelector('#admin-passmark-input').value.trim().slice(0, 60),
      });
      getMap().closePopup();
    });

    const unstickBtn = adminDiv.querySelector('#admin-unstick-btn');
    if (unstickBtn) unstickBtn.addEventListener('click', async () => {
      busy = true;
      try {
        const ok = await showConfirm('🧹 Clear stuck attempt?',
          esc(teamName(gs, a.attemptingBy)) + '\'s attempt is abandoned and the area reopens to everyone eligible. ' +
          'Their attempt no longer counts (they keep having seen the challenge).',
          'Clear it', 'Cancel', 'amber');
        if (!ok) return;
        const res = await adminClearAttempt(key);
        if (!res.ok) { showError(res.reason); return; }
        getMap().closePopup();
      } finally {
        busy = false;
      }
    });
  }

  L.popup({ maxWidth: 280 })
    .setLatLng(latlng)
    .setContent(content)
    .openOn(map);

  open = { key, latlng, sig: buildSig(gs, key) };
}
