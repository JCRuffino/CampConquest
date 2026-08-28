import { mutateState, pushLog, getUid } from './firebase.js';
import { gameState, getMyTeam, setMyTeam, states, teamName, esc,
         getGameCode, setGameCode, normalizeGameCode, playerNames, teamSize,
         isAdminMode, setAdminMode } from './shared.js';
import { claimTeam, releaseTeam } from './actions.js';
import { toggleAreaEditor } from './map.js';
import { showModal, showConfirm, showInfo } from './modal.js';

export function initSettings(resetCallback) {

  // ── Your team ─────────────────────────────────────────────────────
  // Every phone that connects is asked who it is: a player, or the
  // admin. Players then pick their team from those still free, and are
  // offered the rules with the option to skip. Being on a team means
  // holding that team's claim (gameState.teamClaims[team] === this
  // device's auth uid); if the claim goes (admin release, reset) the
  // phone drops off and the entry flow offers it again.
  const currentLabel = document.getElementById('current-team-label');
  const pickBtn      = document.getElementById('team-pick-btn');
  const leaveBtn     = document.getElementById('team-leave-btn');

  let myUid = null;
  getUid().then(uid => {
    myUid = uid;
    // gameState may already have arrived before auth resolved (or vice
    // versa) — re-check from whichever side finishes second, so the
    // claim-validity check below never gets silently skipped
    syncTeamFromClaims();
    refreshTeamUI();
    maybeRunEntryFlow();
  });

  function availableTeams() {
    const gs = gameState.data;
    if (!gs) return [];
    const claims = gs.teamClaims || {};
    return [1, 2, 3].filter(t => {
      const roster = ((gs.players && gs.players[t]) || []).filter(n => n);
      return roster.length > 0 && !claims[t];
    });
  }

  function hasValidClaim() {
    const gs     = gameState.data;
    const myTeam = getMyTeam();
    if (!gs || !myTeam || !myUid) return false;
    return (gs.teamClaims || {})[myTeam] === myUid;
  }

  // A modal chain is already running; never stack a second one on it
  let flowOpen = false;
  // They dismissed the entry flow, or said they're the admin, so stop
  // auto-asking this session. The Settings button always re-opens it,
  // so this can never become a dead end.
  let entryDeclined = false;

  // Being on a team requires holding its claim. If it's gone (admin
  // release, a reset, or another phone took it) drop off and let the
  // entry flow offer a fresh pick, which it does as soon as there is a
  // free team to pick.
  function syncTeamFromClaims() {
    const gs     = gameState.data;
    const myTeam = getMyTeam();
    if (!gs || !myTeam || !myUid) return;
    if ((gs.teamClaims || {})[myTeam] === myUid) return; // still valid
    setMyTeam(null);
    entryDeclined = false;
    if (!availableTeams().length) {
      showInfo('👋 Thanks for playing',
        'This phone has been disconnected from the game. If another game is being set up, ' +
        'you will be asked to pick a team as soon as it is ready.');
    }
  }

  // Called after every gameState update and once the auth uid resolves,
  // so neither can race past the other. Only auto-runs when a team is
  // actually free, so a phone waiting on the admin isn't nagged with a
  // dialog it can't act on; it runs the moment one becomes available.
  function maybeRunEntryFlow() {
    if (flowOpen || entryDeclined) return;
    if (!gameState.data || isAdminMode() || hasValidClaim()) return;
    if (!availableTeams().length) return;
    runEntryFlow(true);
  }

  async function runEntryFlow(auto) {
    if (flowOpen) return;
    if (isAdminMode() || hasValidClaim()) return;
    flowOpen = true;
    try {
      const role = await showModal({
        title: '🏕️ Welcome to Camp Conquest',
        bodyHTML: 'Who is using this phone?',
        buttons: [
          { id: 'player', label: '🎮 A team playing the game', style: 'primary' },
          { id: 'admin',  label: '🛠️ The admin running it',    style: 'amber' },
        ],
        dismissable: true,
      });
      if (!role) { if (auto) entryDeclined = true; return; }
      if (role.button === 'admin') {
        entryDeclined = true; // don't nag; Settings can re-open this
        await showInfo('🛠️ Admin',
          'Enter the admin password in Settings to unlock the admin controls.',
          'Take me to Settings');
        document.querySelector('.nav-btn[data-screen="settings"]').click();
        return;
      }
      await pickTeamThenRules(auto);
    } finally {
      flowOpen = false;
    }
  }

  // Pick a team, then offer the rules. Callers own the flowOpen guard.
  async function pickTeamThenRules(auto) {
    while (true) {
      const gs    = gameState.data;
      const avail = availableTeams();
      if (!avail.length) {
        await showInfo('⏳ No teams free',
          'Either every team is already on a phone, or the admin has not set the teams up yet. ' +
          'Check with the admin, then try again.');
        return false;
      }
      const res = await showModal({
        title: '👥 Which team is this phone for?',
        bodyHTML: 'Each team has one phone. Pick your set of players; teams already on a phone are not shown.',
        buttons: [
          ...avail.map(t => ({
            id:    't' + t,
            label: esc(playerNames(gs, t).join(' & ')) + ' (' + esc(teamName(gs, t)) + ')',
            color: states[t].color,
          })),
          { id: 'none', label: 'Not playing / just watching', style: 'ghost' },
        ],
        dismissable: true,
      });
      if (!res || res.button === 'none') { if (auto) entryDeclined = true; return false; }
      const t = parseInt(res.button.slice(1));
      const r = await claimTeam(t);
      if (!r.ok) {
        await showInfo('😬 Too slow', esc(r.reason || 'That team was just taken.'));
        continue; // re-offer with the updated list
      }
      setMyTeam(t);
      rerender();
      await offerRules();
      return true;
    }
  }

  // Optional by design: a returning group who already know the game can
  // skip straight to the map, and the Rules tab is always there anyway
  async function offerRules() {
    const res = await showModal({
      title: '📖 Read the rules?',
      bodyHTML: 'Worth reading through with your team before you start. ' +
                'They are always on the Rules tab if you want them later.',
      buttons: [
        { id: 'read', label: '📖 Read the rules', style: 'primary' },
        { id: 'skip', label: 'Skip, we know how to play', style: 'ghost' },
      ],
      dismissable: true,
    });
    const screen = (res && res.button === 'read') ? 'rules' : 'map';
    document.querySelector('.nav-btn[data-screen="' + screen + '"]').click();
  }

  function refreshTeamUI() {
    const myTeam = getMyTeam();
    const gs     = gameState.data;
    if (myTeam) {
      currentLabel.textContent = '✅ You are on ' + teamName(gs, myTeam) +
        ': ' + playerNames(gs, myTeam).join(' & ');
      currentLabel.style.color = states[myTeam].color;
    } else {
      currentLabel.textContent = isAdminMode()
        ? 'No team assigned: admin mode.'
        : 'No team assigned yet.';
      currentLabel.style.color = '#555';
    }
    // Shown whenever this phone isn't on a team, even if no team is
    // currently free: the flow explains why rather than dead-ending
    if (pickBtn)  pickBtn.style.display  = (!myTeam && !isAdminMode()) ? 'block' : 'none';
    if (leaveBtn) leaveBtn.style.display = myTeam ? 'inline-flex' : 'none';
    refreshAdminUI();
  }

  if (pickBtn) pickBtn.addEventListener('click', async () => {
    if (flowOpen) return;
    entryDeclined = false;
    flowOpen = true;
    try {
      await pickTeamThenRules(false);
    } finally {
      flowOpen = false;
    }
  });

  if (leaveBtn) leaveBtn.addEventListener('click', async () => {
    const myTeam = getMyTeam();
    if (!myTeam) return;
    const ok = await showConfirm('Leave ' + esc(teamName(gameState.data, myTeam)) + '?',
      'This frees the team so another phone can join as them.', 'Leave team');
    if (!ok) return;
    const r = await releaseTeam(myTeam);
    if (!r.ok) {
      await showInfo('❌ Could not leave', esc(r.reason || 'Please try again.'));
      return; // the remote claim never changed — stay on the team locally too
    }
    setMyTeam(null);
    entryDeclined = false;
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

  // Fields being edited are "dirty" until saved — refresh() must not
  // clobber them when remote state changes (phones claiming/leaving
  // teams write state while the admin is mid-typing)
  if (setupCard) setupCard.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => { inp.dataset.dirty = '1'; });
  });

  function clearSetupDirty() {
    if (setupCard) setupCard.querySelectorAll('input').forEach(inp => {
      delete inp.dataset.dirty;
    });
  }

  const setupSizeLabel = document.getElementById('setup-size-label');

  function refreshSetupUI() {
    // teamSize() (shared.js) treats "unset" the same as 2 — fine for
    // gameplay, but Setup must tell an untouched game apart from one
    // deliberately set to 2, so read the raw value here instead
    const gs      = gameState.data;
    const rawSize = gs ? gs.teamSize : null;
    if (setupSizeLabel) setupSizeLabel.textContent = rawSize == null ? 'Not set' : String(rawSize);
    const size = rawSize == null ? 2 : rawSize; // keep the 3rd input hidden until a size is chosen
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

  // Release buttons are re-rendered with the claim status — delegate
  if (setupCard) setupCard.addEventListener('click', async e => {
    const btn = e.target.closest('.setup-release-btn');
    if (!btn || !isAdminMode()) return;
    const t  = parseInt(btn.dataset.team);
    const ok = await showConfirm('Release ' + esc(teamName(gameState.data, t)) + '\'s phone?',
      'That phone drops off the team and another phone can join as them.', 'Release');
    if (ok) releaseTeam(t);
  });

  if (setupSaveBtn) setupSaveBtn.addEventListener('click', async () => {
    if (!isAdminMode()) return;
    // Players-per-team is fixed for the whole game and normally only
    // changed via Full Reset. But a brand-new game code has never been
    // through a reset (gameState.data.teamSize is null, not 2 or 3), so
    // there's no size to keep — ask once, here, as part of the very
    // first save. This is the ONLY other place the size can be set;
    // once it's non-null, Full Reset remains the only way to change it.
    let size = gameState.data ? gameState.data.teamSize : null;
    if (size == null) {
      const res = await showModal({
        title: '👥 Players per team',
        bodyHTML: 'This game has no team size yet. How many players per team?',
        buttons: [
          { id: 'size2',  label: '2 players per team', style: 'primary' },
          { id: 'size3',  label: '3 players per team', style: 'primary' },
          { id: 'cancel', label: 'Cancel', style: 'ghost' },
        ],
        dismissable: true,
      });
      if (!res || res.button === 'cancel') return; // abort — no half-written setup
      size = res.button === 'size3' ? 3 : 2;
    }
    const committed = await mutateState(gs => {
      gs.teamSize = size;
      if (!gs.teamNames) gs.teamNames = {};
      if (!gs.players)   gs.players   = {};
      [1, 2, 3].forEach(t => {
        const nameEl = document.getElementById('setup-teamname-' + t);
        const nm = nameEl ? nameEl.value.trim().slice(0, 12) : '';
        // Blank (or the stock label) reverts the team to its default name
        gs.teamNames[t] = (nm && nm !== states[t].label) ? nm : null;
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
    if (committed) clearSetupDirty();
    if (setupStatus) {
      setupStatus.textContent = committed ? '✅ Saved' : '❌ Not saved. Still connecting? Try again.';
      setupStatus.style.color = committed ? '#2a9d3f' : '#e63946';
      setupStatus.style.display = 'block';
      setTimeout(() => { setupStatus.style.display = 'none'; }, 4000);
    }
  });

  // ── Game timer ────────────────────────────────────────────────────
  const timerStatus    = document.getElementById('timer-status');
  const timerStartRow  = document.getElementById('timer-start-row');
  const timerAdjustRow = document.getElementById('timer-adjust-row');
  const timerLenLabel  = document.getElementById('timer-length-label');

  // Game length defaults to 3 hours; ± buttons tune it before starting
  let pendingMinutes = 180;

  function refreshTimerLength() {
    if (timerLenLabel) {
      timerLenLabel.textContent =
        Math.floor(pendingMinutes / 60) + 'h ' + String(pendingMinutes % 60).padStart(2, '0') + 'm';
    }
  }

  const timerDecBtn = document.getElementById('timer-dec-btn');
  const timerIncBtn = document.getElementById('timer-inc-btn');
  if (timerDecBtn) timerDecBtn.addEventListener('click', () => {
    pendingMinutes = Math.max(15, pendingMinutes - 15);
    refreshTimerLength();
  });
  if (timerIncBtn) timerIncBtn.addEventListener('click', () => {
    pendingMinutes = Math.min(12 * 60, pendingMinutes + 15);
    refreshTimerLength();
  });
  refreshTimerLength();

  function refreshTimerUI() {
    const gs      = gameState.data;
    const t       = gs && gs.timer;
    const isAdmin = isAdminMode();
    const running = t && t.endsAt && Date.now() < t.endsAt;
    const ended   = t && t.endsAt && Date.now() >= t.endsAt;

    if (running) {
      timerStatus.textContent = '⏱️ Countdown running, ends at ' +
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
    if (!isAdminMode()) return;
    const mins = pendingMinutes;
    mutateState(gs => {
      if (gs.timer && gs.timer.endsAt && Date.now() < gs.timer.endsAt) return; // already running
      gs.timer = { endsAt: Date.now() + mins * 60000 };
      return gs;
    }).then(committed => {
      if (!committed) return;
      const h = Math.floor(mins / 60), m = mins % 60;
      const lenText = (h ? h + 'h ' : '') + (m ? m + 'm' : (h ? '' : '0m'));
      pushLog({
        timestamp: Date.now(),
        team:      0,
        type:      'timer',
        big:       true,
        message:   '⏱️ Countdown started: ' + lenText.trim() + ' on the clock',
      });
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

  if (codeLabel) codeLabel.textContent = 'Current code: ' + (getGameCode() || 'None');

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
      // The admin runs the game, they don't play — free any team this
      // phone was holding so a player phone can claim it
      const myTeam = getMyTeam();
      if (myTeam) {
        releaseTeam(myTeam);
        setMyTeam(null);
      }
      adminInput.value = '';
      adminError.style.display = 'none';
      refreshTeamUI();
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

  // ── Resets (admin) ────────────────────────────────────────────────
  // Restart: same players, fresh board — setup and phone claims kept.
  // Full reset: next group — teams, rosters and claims wiped too, so
  // phones from the previous game drop off and the picker starts clean.
  const restartBtn = document.getElementById('restart-btn');
  const resetBtn   = document.getElementById('reset-btn');

  if (restartBtn) restartBtn.addEventListener('click', async () => {
    if (!isAdminMode()) return;
    const ok = await showConfirm('🔄 Restart the game?',
      'Every area goes back to unclaimed and the history is wiped. ' +
      'Teams, rosters and connected phones all stay as they are.' +
      '<br><br><strong>This cannot be undone.</strong>',
      'Yes, restart', 'Cancel', 'danger');
    if (!ok) return;
    resetCallback('restart');
  });

  resetBtn.addEventListener('click', async () => {
    if (!isAdminMode()) return;
    // Players-per-team is chosen HERE, for the incoming group, and
    // nowhere else — this is the only moment it can change
    const res = await showModal({
      title: '⚠️ Full reset for a new group',
      bodyHTML:
        'Everything is wiped: the board, the history, team names, rosters, ' +
        'and every phone is disconnected from its team.<br><br>' +
        'How many players per team for this new group?' +
        '<br><br><strong>This cannot be undone.</strong>',
      buttons: [
        { id: 'size2',  label: '2 players per team → Full Reset', style: 'danger' },
        { id: 'size3',  label: '3 players per team → Full Reset', style: 'danger' },
        { id: 'cancel', label: 'Cancel', style: 'ghost' },
      ],
      dismissable: true,
    });
    if (!res || res.button === 'cancel') return;
    resetCallback('full', res.button === 'size3' ? 3 : 2);
  });

  // ── Public API ────────────────────────────────────────────────────
  function refresh() {
    const gs = gameState.data;
    syncTeamFromClaims();

    // Keep the admin setup inputs in sync with the saved state — but
    // never overwrite a field being edited (focused or unsaved-dirty)
    const canFill = el => el && !el.matches(':focus') && !el.dataset.dirty;
    const names   = (gs && gs.teamNames) || {};
    const players = (gs && gs.players)   || {};
    [1, 2, 3].forEach(t => {
      const nameInput = document.getElementById('setup-teamname-' + t);
      if (canFill(nameInput)) nameInput.value = names[t] || states[t].label;
      const roster = players[t] || [];
      for (let i = 1; i <= 3; i++) {
        const el = document.getElementById('setup-player-' + t + '-' + i);
        if (canFill(el)) el.value = roster[i - 1] || '';
      }
    });

    refreshTeamUI();
    maybeRunEntryFlow();
  }

  refreshTeamUI();
  return { refresh };
}
