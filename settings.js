import { mutateState, pushLog, getUid } from './firebase.js';
import { gameState, getMyTeam, setMyTeam, states, teamName, esc,
         getGameCode, setGameCode, normalizeGameCode, playerNames, teamSize,
         resetEpoch, getMyTeamEpoch, setMyTeamEpoch,
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
  getUid().then(uid => {
    myUid = uid;
    // gameState may already have arrived before auth resolved (or vice
    // versa) — re-check from whichever side finishes second, so the
    // claim-validity check below never gets silently skipped
    syncTeamFromClaims();
    refreshTeamUI();
    maybeOnboard();
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

  let pickerOpen     = false;
  let pickerDeclined = false; // "just watching" — don't re-prompt this session
  let kickNote       = false; // lightweight re-pick (no rules) vs full onboarding
  // Handle of the "new game starting" holding note (see below) — kept
  // so startOnboarding() can dismiss it once real rosters arrive,
  // instead of stacking a second modal on top of it
  let holdingNoteHandle = null;

  function anyRosterExists() {
    const gs = gameState.data;
    if (!gs) return false;
    return [1, 2, 3].some(t => ((gs.players && gs.players[t]) || []).filter(n => n).length > 0);
  }

  // Being on a team requires holding its claim — if it's gone (admin
  // release, a full reset, or another phone somehow took it), drop off.
  // A FULL reset bumps gs.resetEpoch; if that's moved on since this
  // phone last claimed a team, treat it as a brand-new player (full
  // onboarding, rules and all) — otherwise it's a same-game phone
  // swap (e.g. a dead phone), so skip straight to a lightweight re-pick.
  function syncTeamFromClaims() {
    const gs     = gameState.data;
    const myTeam = getMyTeam();
    if (!gs || !myTeam || !myUid) return;
    const claims = gs.teamClaims || {};
    if (claims[myTeam] === myUid) return; // still valid, nothing to do

    const wasFullReset = resetEpoch(gs) > getMyTeamEpoch();
    setMyTeam(null);
    pickerDeclined = false;
    if (isAdminMode() || availableTeams().length) {
      kickNote = !wasFullReset;
    } else if (anyRosterExists()) {
      // At least one team is set up, just all claimed — a real dead end
      showInfo('👋 Thanks for playing',
        'Thanks for playing, you have now been disconnected from the game, please close this window.');
      kickNote = false;
    } else {
      // No team has a roster at all — this is the moment right after a
      // Full Reset, before the admin has saved the next group's setup.
      // Transient: hold here (dismissable) until rosters exist, then
      // startOnboarding() below closes this and takes over.
      holdingNoteHandle = showInfo('🔄 New game starting',
        'The admin is setting up the next game — you\'ll be asked to pick your team when they\'re ready.');
      kickNote = false;
    }
  }

  // A phone with no team is onboarded (playing? → rules → picker); a
  // phone released mid-game without an intervening full reset re-picks
  // without the rules. Called after every gameState update AND once
  // this device's auth uid resolves, so neither trigger can race past
  // the other and leave a stale claim undetected (see getUid() above).
  function maybeOnboard() {
    const gs = gameState.data;
    if (gs && !getMyTeam() && !isAdminMode() && !pickerDeclined) {
      if (kickNote) offerTeamPick(true);
      else startOnboarding();
    }
  }

  async function offerTeamPick(auto) {
    if (pickerOpen) return;
    if (isAdminMode()) return; // the admin teaches, they don't play
    if (getMyTeam()) return;   // already on a team
    const avail = availableTeams();
    if (!avail.length) return;
    pickerOpen = true;
    try {
      const gs  = gameState.data;
      const note = kickNote
        ? '<strong>The admin released this phone from its team — pick again.</strong><br><br>'
        : '';
      kickNote = false;
      const res = await showModal({
        title: '👥 Which team is this phone for?',
        bodyHTML: note + 'Each team has one phone. Pick your set of players — teams already on a phone aren\'t shown.',
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
      setMyTeamEpoch(resetEpoch(gameState.data)); // mark: valid as of this reset epoch
      rerender();
    } finally {
      pickerOpen = false;
    }
  }

  // ── Onboarding ────────────────────────────────────────────────────
  // A fresh phone is asked whether it's playing, then sent to the
  // Rules screen; the button at the bottom of the rules confirms
  // they've been read and opens the team picker. Phones released
  // mid-game (kickNote) skip the rules and go straight to the picker.
  const rulesDoneBtn = document.getElementById('rules-done-btn');
  let onboardingActive = false; // asked / reading the rules

  async function startOnboarding() {
    if (onboardingActive || pickerOpen) return;
    if (isAdminMode() || getMyTeam()) return;
    if (!availableTeams().length) return;
    // Rosters have arrived — the holding note (if any) is stale now;
    // dismiss it so it doesn't sit stacked under this modal
    if (holdingNoteHandle) {
      holdingNoteHandle.close();
      holdingNoteHandle = null;
    }
    onboardingActive = true;
    const res = await showModal({
      title: '🏕️ Playing in the next game?',
      bodyHTML: 'Is this phone for a team in the next game?',
      buttons: [
        { id: 'play',  label: '🎮 Yes, we\'re playing', style: 'primary' },
        { id: 'watch', label: '👀 Just watching',       style: 'ghost' },
      ],
      dismissable: true,
    });
    if (!res || res.button !== 'play') {
      pickerDeclined   = true;
      onboardingActive = false;
      return;
    }
    await showInfo('📖 Read the rules first',
      'Read through every section with your team and ask the admin any questions — ' +
      'then press the button at the bottom of the rules to join your team.',
      'Open the rules');
    document.querySelector('.nav-btn[data-screen="rules"]').click();
    if (rulesDoneBtn) rulesDoneBtn.style.display = 'block';
    // onboardingActive stays true until the rules are confirmed
  }

  if (rulesDoneBtn) rulesDoneBtn.addEventListener('click', async () => {
    if (getMyTeam()) { rulesDoneBtn.style.display = 'none'; return; }
    const ok = await showConfirm('✅ All read?',
      'Confirm your team has read the rules and asked any questions.',
      'Yes — choose our team', 'Keep reading');
    if (!ok) return;
    if (!availableTeams().length) {
      await showInfo('😬 No teams free',
        'All teams are already on a phone — check with the admin.');
      return;
    }
    rulesDoneBtn.style.display = 'none';
    onboardingActive = false;
    await offerTeamPick(false);
    if (getMyTeam()) document.querySelector('.nav-btn[data-screen="map"]').click();
  });

  function refreshTeamUI() {
    const myTeam = getMyTeam();
    const gs     = gameState.data;
    if (rulesDoneBtn && myTeam) rulesDoneBtn.style.display = 'none';
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
    if (pickBtn)  pickBtn.style.display  = (!myTeam && !isAdminMode() && availableTeams().length) ? 'block' : 'none';
    if (leaveBtn) leaveBtn.style.display = myTeam ? 'inline-flex' : 'none';
    refreshAdminUI();
  }

  if (pickBtn) pickBtn.addEventListener('click', () => {
    // If onboarding is already mid-flight (rules screen open, waiting on
    // the confirm button), startOnboarding() below would just no-op —
    // send them back to confirm the rules instead of doing nothing
    if (onboardingActive) {
      document.querySelector('.nav-btn[data-screen="rules"]').click();
      if (rulesDoneBtn) rulesDoneBtn.style.display = 'block';
      return;
    }
    pickerDeclined = false;
    startOnboarding(); // playing? → rules → picker
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
    if (setupSizeLabel) setupSizeLabel.textContent = rawSize == null ? '—' : String(rawSize);
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
        bodyHTML: 'This game has no team size yet — how many players per team?',
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
      setupStatus.textContent = committed ? '✅ Saved' : '❌ Not saved — still connecting? Try again.';
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
        message:   '⏱️ Countdown started — ' + lenText.trim() + ' on the clock',
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
        'Everything is wiped: the board, the history, team names, rosters — ' +
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
    maybeOnboard();
  }

  refreshTeamUI();
  return { refresh };
}
