import { mutateState, pushLog, getUid } from './firebase.js';
import { gameState, getMyTeam, setMyTeam, states, teamName, esc,
         getGameCode, setGameCode, normalizeGameCode, playerNames, teamSize,
         isAdminMode, setAdminMode } from './shared.js';
import { claimTeam, releaseTeam } from './actions.js';
import { toggleAreaEditor } from './map.js';
import { showModal, showConfirm, showInfo } from './modal.js';

export function initSettings(resetCallback) {

  // ── Your team ─────────────────────────────────────────────────────
  // The admin enters the rosters (Game Setup below); each player phone
  // claims one team from those still free. Being on a team means
  // holding its claim (gameState.teamClaims[team] === this device's
  // auth uid) — if the claim goes (admin release, reset), the phone
  // drops off the team and is offered the pick again.
  const currentLabel = document.getElementById('current-team-label');
  const pickBtn      = document.getElementById('team-pick-btn');
  const leaveBtn     = document.getElementById('team-leave-btn');

  let myUid = null;
  getUid().then(uid => { myUid = uid; refreshTeamUI(); });

  function availableTeams() {
    const gs = gameState.data;
    if (!gs) return [];
    const claims = gs.teamClaims || {};
    return [1, 2, 3].filter(t => {
      const roster = ((gs.players && gs.players[t]) || []).filter(n => n);
      return roster.length > 0 && !claims[t];
    });
  }

  let pickerOpen     = false;
  let pickerDeclined = false; // "just watching" — don't re-prompt this session

  async function offerTeamPick(auto) {
    if (pickerOpen) return;
    const avail = availableTeams();
    if (!avail.length) return;
    pickerOpen = true;
    try {
      const gs  = gameState.data;
      const res = await showModal({
        title: '👥 Which team is this phone for?',
        bodyHTML: 'Each team has one phone. Pick your set of players — teams already on a phone aren\'t shown.',
        buttons: [
          ...avail.map(t => ({
            id:    't' + t,
            label: esc(playerNames(gs, t).join(' & ')) + ' — ' + esc(teamName(gs, t)),
            color: states[t].color,
          })),
          { id: 'watch', label: 'Not playing / just watching', style: 'ghost' },
        ],
        dismissable: true,
      });
      if (!res || res.button === 'watch') {
        if (auto) pickerDeclined = true;
        return;
      }
      const t = parseInt(res.button.slice(1));
      const r = await claimTeam(t);
      if (!r.ok) {
        await showInfo('😬 Too slow', esc(r.reason || 'That team was just taken.'));
        pickerOpen = false;
        return offerTeamPick(auto); // re-offer with the updated list
      }
      setMyTeam(t);
      rerender();
    } finally {
      pickerOpen = false;
    }
  }

  function refreshTeamUI() {
    const myTeam = getMyTeam();
    const gs     = gameState.data;
    if (myTeam) {
      currentLabel.textContent = '✅ You are on ' + teamName(gs, myTeam) +
        ' — ' + playerNames(gs, myTeam).join(' & ');
      currentLabel.style.color = states[myTeam].color;
    } else {
      currentLabel.textContent = availableTeams().length
        ? 'No team assigned yet.'
        : 'No team assigned — spectator/admin mode.';
      currentLabel.style.color = '#555';
    }
    if (pickBtn)  pickBtn.style.display  = (!myTeam && availableTeams().length) ? 'block' : 'none';
    if (leaveBtn) leaveBtn.style.display = myTeam ? 'inline-flex' : 'none';
    refreshAdminUI();
  }

  if (pickBtn) pickBtn.addEventListener('click', () => {
    pickerDeclined = false;
    offerTeamPick(false);
  });

  if (leaveBtn) leaveBtn.addEventListener('click', async () => {
    const myTeam = getMyTeam();
    if (!myTeam) return;
    const ok = await showConfirm('Leave ' + esc(teamName(gameState.data, myTeam)) + '?',
      'This frees the team for another phone to claim.', 'Leave team');
    if (!ok) return;
    await releaseTeam(myTeam);
    setMyTeam(null);
    pickerDeclined = false;
    rerender();
  });

  function rerender() {
    refreshTeamUI();
    if (gameState.data) {
      import('./ui.js').then(({ renderAll }) => renderAll(gameState.data));
    }
  }

  // ── Game setup (admin) ────────────────────────────────────────────
  const setupCard    = document.getElementById('setup-card');
  const setupSaveBtn = document.getElementById('setup-save-btn');
  const setupStatus  = document.getElementById('setup-save-status');

  let setupSizeChoice = null; // unsaved local selection; falls back to gs.teamSize

  function selectedSize() {
    return setupSizeChoice || teamSize(gameState.data);
  }

  function refreshSetupUI() {
    const size = selectedSize();
    document.querySelectorAll('.team-size-btn').forEach(b => {
      const active = parseInt(b.dataset.size) === size;
      b.classList.toggle('btn-primary', active);
      b.classList.toggle('btn-ghost', !active);
    });
    [1, 2, 3].forEach(t => {
      const third = document.getElementById('setup-player-' + t + '-3');
      if (third) third.style.display = size === 3 ? '' : 'none';
    });
    const claims = (gameState.data && gameState.data.teamClaims) || {};
    [1, 2, 3].forEach(t => {
      const el = document.getElementById('setup-claim-' + t);
      if (!el) return;
      el.innerHTML = claims[t]
        ? '📱 Phone connected · <button class="btn btn-ghost btn-sm setup-release-btn" data-team="' + t + '">Release</button>'
        : '📵 No phone connected yet';
    });
  }

  document.querySelectorAll('.team-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      setupSizeChoice = parseInt(b.dataset.size);
      refreshSetupUI();
    });
  });

  // Release buttons are re-rendered with the claim status — delegate
  if (setupCard) setupCard.addEventListener('click', async e => {
    const btn = e.target.closest('.setup-release-btn');
    if (!btn || !isAdminMode()) return;
    const t  = parseInt(btn.dataset.team);
    const ok = await showConfirm('Release ' + esc(teamName(gameState.data, t)) + '\'s phone?',
      'That phone drops off the team and the team becomes claimable again.', 'Release');
    if (ok) releaseTeam(t);
  });

  if (setupSaveBtn) setupSaveBtn.addEventListener('click', async () => {
    if (!isAdminMode()) return;
    const size = selectedSize();
    const committed = await mutateState(gs => {
      gs.teamSize = size;
      if (!gs.teamNames) gs.teamNames = {};
      if (!gs.players)   gs.players   = {};
      [1, 2, 3].forEach(t => {
        const nameEl = document.getElementById('setup-teamname-' + t);
        const nm = nameEl ? nameEl.value.trim().slice(0, 12) : '';
        if (nm) gs.teamNames[t] = nm;
        const roster = [];
        for (let i = 1; i <= size; i++) {
          const el = document.getElementById('setup-player-' + t + '-' + i);
          const v  = el ? el.value.trim().slice(0, 15) : '';
          if (v) roster.push(v);
        }
        gs.players[t] = roster;
      });
      return gs;
    });
    if (setupStatus) {
      setupStatus.textContent = committed ? '✅ Saved' : '❌ Not saved — still connecting? Try again.';
      setupStatus.style.color = committed ? '#2a9d3f' : '#e63946';
      setupStatus.style.display = 'block';
      setTimeout(() => { setupStatus.style.display = 'none'; }, 4000);
    }
  });

  // ── Game timer ────────────────────────────────────────────────────
  const timerStatus    = document.getElementById('timer-status');
  const timerMinutes   = document.getElementById('timer-minutes');
  const timerStartRow  = document.getElementById('timer-start-row');
  const timerAdjustRow = document.getElementById('timer-adjust-row');

  function refreshTimerUI() {
    const gs      = gameState.data;
    const t       = gs && gs.timer;
    const isAdmin = isAdminMode();
    const running = t && t.endsAt && Date.now() < t.endsAt;
    const ended   = t && t.endsAt && Date.now() >= t.endsAt;

    if (running) {
      timerStatus.textContent = '⏱️ Countdown running — ends at ' +
        new Date(t.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      timerStartRow.style.display  = 'none';
      timerAdjustRow.style.display = isAdmin ? 'flex' : 'none';
    } else if (ended) {
      timerStatus.textContent = '🏁 The game has ended.';
      // Only an admin can start a new countdown once a game has ended
      timerStartRow.style.display  = isAdmin ? 'flex' : 'none';
      timerAdjustRow.style.display = isAdmin ? 'flex' : 'none';
    } else {
      timerStatus.textContent = 'No countdown set.';
      timerStartRow.style.display  = isAdmin ? 'flex' : 'none';
      timerAdjustRow.style.display = 'none';
    }
  }

  document.getElementById('timer-start-btn').addEventListener('click', () => {
    const mins = parseInt(timerMinutes.value);
    if (isNaN(mins) || mins < 1) return;
    mutateState(gs => {
      if (gs.timer && gs.timer.endsAt && Date.now() < gs.timer.endsAt) return; // already running
      gs.timer = { endsAt: Date.now() + mins * 60000 };
      return gs;
    }).then(committed => {
      if (!committed) return;
      pushLog({
        timestamp: Date.now(),
        team:      0,
        type:      'timer',
        message:   '⏱️ Countdown started — ' + mins + ' minute' + (mins !== 1 ? 's' : '') + ' on the clock',
      });
      timerMinutes.value = '';
    });
  });

  function adjustTimer(deltaMs, label) {
    if (!isAdminMode()) return;
    mutateState(gs => {
      if (!gs.timer || !gs.timer.endsAt) return;
      gs.timer.endsAt += deltaMs;
      // Extending a finished game back past "now" un-ends it, so the
      // GAME OVER entry can fire again when it actually ends
      if (gs.timer.endsAt > Date.now()) delete gs.timer.endLogged;
      return gs;
    }).then(committed => {
      if (committed) {
        pushLog({
          timestamp: Date.now(),
          team:      0,
          type:      'timer',
          message:   '⏱️ Admin adjusted the countdown (' + label + ')',
        });
      }
    });
  }
  document.getElementById('timer-plus-btn').addEventListener('click',  () => adjustTimer(5 * 60000, '+5 minutes'));
  document.getElementById('timer-minus-btn').addEventListener('click', () => adjustTimer(-5 * 60000, '−5 minutes'));

  document.getElementById('timer-endnow-btn').addEventListener('click', () => {
    if (!isAdminMode()) return;
    mutateState(gs => {
      if (!gs.timer || !gs.timer.endsAt || Date.now() >= gs.timer.endsAt) return;
      gs.timer.endsAt = Date.now();
      return gs;
    });
  });

  document.getElementById('timer-cancel-btn').addEventListener('click', () => {
    if (!isAdminMode()) return;
    mutateState(gs => {
      if (!gs.timer) return;
      gs.timer = null;
      return gs;
    }).then(committed => {
      if (committed) {
        pushLog({
          timestamp: Date.now(),
          team:      0,
          type:      'timer',
          message:   '⏱️ Countdown cancelled',
        });
      }
    });
  });

  // ── Game code ─────────────────────────────────────────────────────
  const codeLabel = document.getElementById('game-code-label');
  const codeInput = document.getElementById('game-code-input');
  const codeBtn   = document.getElementById('game-code-btn');

  if (codeLabel) codeLabel.textContent = 'Current code: ' + (getGameCode() || '—');

  if (codeBtn) codeBtn.addEventListener('click', async () => {
    const code = normalizeGameCode(codeInput.value);
    if (!code) return;
    const ok = await showConfirm('🔑 Switch game code?',
      'Switch to game code "<strong>' + esc(code) + '</strong>"?<br>The app will reload and connect to that game\'s data.',
      'Switch & reload');
    if (!ok) return;
    setGameCode(code);
    // Firebase listeners are bound to the old path — a reload is the
    // clean way to reconnect everything under the new code
    window.location.reload();
  });

  // ── Admin mode ────────────────────────────────────────────────────
  // Unlocks the area editor, game reset, timer controls, and the
  // per-area admin panel in map popups
  const ADMIN_PASSWORD = 'bankofcum'; // 🔑

  const adminStatus  = document.getElementById('admin-status');
  const adminInput   = document.getElementById('admin-password-input');
  const adminBtn     = document.getElementById('admin-unlock-btn');
  const adminError   = document.getElementById('admin-password-error');
  const adminRow      = document.getElementById('admin-unlock-row');
  const editorCard    = document.getElementById('editor-card');
  const resetCard     = document.getElementById('reset-card');
  const broadcastCard = document.getElementById('broadcast-card');

  function refreshAdminUI() {
    const on = isAdminMode();
    if (adminStatus) {
      adminStatus.textContent = on
        ? '✅ Admin mode active on this device'
        : 'Enter the admin password to unlock admin controls.';
      adminStatus.style.color = on ? '#2a9d3f' : '#6b7280';
    }
    if (adminRow)    adminRow.style.display   = on ? 'none' : 'flex';
    if (adminBtn)    adminBtn.textContent     = on ? '🔒 Lock' : 'Unlock';
    if (setupCard)     setupCard.style.display     = on ? 'block' : 'none';
    if (editorCard)    editorCard.style.display    = on ? 'block' : 'none';
    if (resetCard)     resetCard.style.display     = on ? 'block' : 'none';
    if (broadcastCard) broadcastCard.style.display = on ? 'block' : 'none';
    // Player phones (on a team, not admin) see no admin unlock at all
    const adminCard = document.getElementById('admin-card');
    if (adminCard) adminCard.style.display = (getMyTeam() && !on) ? 'none' : 'block';
    const lockBtn = document.getElementById('admin-lock-btn');
    if (lockBtn) lockBtn.style.display = on ? 'inline-flex' : 'none';
    if (on) refreshSetupUI();
    refreshTimerUI();
  }

  if (adminBtn) adminBtn.addEventListener('click', () => {
    if (adminInput.value === ADMIN_PASSWORD) {
      setAdminMode(true);
      adminInput.value = '';
      adminError.style.display = 'none';
      refreshAdminUI();
      if (gameState.data) {
        import('./ui.js').then(({ renderAll }) => renderAll(gameState.data));
      }
    } else {
      adminError.style.display = 'block';
      adminInput.value = '';
      adminInput.focus();
    }
  });

  if (adminInput) adminInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') adminBtn.click();
  });

  const adminLockBtn = document.getElementById('admin-lock-btn');
  if (adminLockBtn) adminLockBtn.addEventListener('click', () => {
    setAdminMode(false);
    refreshAdminUI();
    if (gameState.data) {
      import('./ui.js').then(({ renderAll }) => renderAll(gameState.data));
    }
  });

  // ── Broadcast (admin) ─────────────────────────────────────────────
  const broadcastInput = document.getElementById('broadcast-input');
  const broadcastBtn   = document.getElementById('broadcast-btn');

  if (broadcastBtn) broadcastBtn.addEventListener('click', () => {
    if (!isAdminMode()) return;
    const text = broadcastInput.value.trim().slice(0, 120);
    if (!text) return;
    pushLog({
      team:    0,
      type:    'timer', // renders as the full-width banner in History
      big:     true,    // toasts on every device
      message: '📣 ' + text,
    });
    broadcastInput.value = '';
  });

  if (broadcastInput) broadcastInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') broadcastBtn.click();
  });

  // ── Area editor (admin) ───────────────────────────────────────────
  const editorBtn = document.getElementById('editor-toggle-btn');

  if (editorBtn) {
    editorBtn.addEventListener('click', () => {
      const active = toggleAreaEditor();
      editorBtn.textContent = active ? '🛑 Stop Editing' : '✏️ Start Area Editor';
      if (active) {
        // Jump to the map so editing can begin straight away
        document.querySelector('.nav-btn[data-screen="map"]').click();
      }
    });
  }

  // ── Reset (admin) ─────────────────────────────────────────────────
  const resetBtn = document.getElementById('reset-btn');

  resetBtn.addEventListener('click', async () => {
    if (!isAdminMode()) return;
    const ok = await showConfirm('⚠️ Reset the ENTIRE game?',
      'Every area goes back to unclaimed and the history is wiped. ' +
      'The game setup (team size, names and rosters) is kept, but player ' +
      'phones drop off their teams and pick again.<br><br><strong>This cannot be undone.</strong>',
      'Yes, reset', 'Cancel', 'danger');
    if (!ok) return;
    resetCallback();
  });

  // ── Public API ────────────────────────────────────────────────────
  function refresh() {
    const gs     = gameState.data;
    const myTeam = getMyTeam();

    // Being on a team requires holding its claim — if it's gone
    // (admin release, reset, or another phone took it), drop off
    if (gs && myTeam && myUid) {
      const claims = gs.teamClaims || {};
      if (claims[myTeam] !== myUid) setMyTeam(null);
    }

    // Keep the admin setup inputs in sync with the saved state
    const names   = (gs && gs.teamNames) || {};
    const players = (gs && gs.players)   || {};
    [1, 2, 3].forEach(t => {
      const nameInput = document.getElementById('setup-teamname-' + t);
      if (nameInput && !nameInput.matches(':focus')) {
        nameInput.value = names[t] || states[t].label;
      }
      const roster = players[t] || [];
      for (let i = 1; i <= 3; i++) {
        const el = document.getElementById('setup-player-' + t + '-' + i);
        if (el && !el.matches(':focus')) el.value = roster[i - 1] || '';
      }
    });

    refreshTeamUI();

    // A phone with no team gets offered the free teams (once per
    // session, unless it asks again via the Choose button)
    if (gs && !getMyTeam() && !isAdminMode() && !pickerDeclined) {
      offerTeamPick(true);
    }
  }

  refreshTeamUI();
  return { refresh };
}
