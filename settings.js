import { mutateState, pushLog } from './firebase.js';
import { gameState, getMyTeam, setMyTeam, states,
         getGameCode, setGameCode, normalizeGameCode,
         isAdminMode, setAdminMode } from './shared.js';
import { toggleAreaEditor } from './map.js';

export function initSettings(resetCallback) {

  // ── Team assignment ───────────────────────────────────────────────
  const assignBtns   = document.querySelectorAll('.team-assign-btn');
  const currentLabel = document.getElementById('current-team-label');
  const activeClasses = { 1: 'active-a', 2: 'active-b', 3: 'active-c' };

  function refreshAssignUI() {
    const myTeam = getMyTeam();
    const gs     = gameState.data;
    const names  = (gs && gs.teamNames) || {};
    assignBtns.forEach(btn => {
      const t    = parseInt(btn.dataset.team);
      const name = names[t] || states[t].label;
      btn.classList.remove('active-a', 'active-b', 'active-c');
      if (myTeam === t) {
        btn.textContent = 'Leave ' + name;
        btn.classList.add(activeClasses[t]);
      } else {
        btn.textContent = 'Join ' + name;
      }
      // No direct switching — you must leave your team before joining another
      btn.disabled = myTeam !== null && myTeam !== t;
    });
    if (myTeam) {
      const name = (gameState.data && gameState.data.teamNames && gameState.data.teamNames[myTeam])
        || states[myTeam].label;
      currentLabel.textContent = '✅ You are on ' + name;
      currentLabel.style.color = states[myTeam].color;
    } else {
      currentLabel.textContent = 'No team assigned — spectator/admin mode';
      currentLabel.style.color = '#555';
    }
    refreshResetBtn();
    refreshAdminUI();
  }

  assignBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const t      = parseInt(btn.dataset.team);
      const myTeam = getMyTeam();
      if (myTeam === t) setMyTeam(null);
      else if (myTeam !== null) return;
      else {
        // Challenges alternate between the two players, so the app
        // needs both names when a team is joined
        const existing = (gameState.data && gameState.data.players && gameState.data.players[t]) || [];
        const n1 = window.prompt('👤 First team member\'s name?', existing[0] || '');
        if (n1 === null) return; // cancelled — don't join
        const n2 = window.prompt('👤 Second team member\'s name?', existing[1] || '');
        if (n2 === null) return;
        const names = [n1.trim().slice(0, 15) || 'Player 1', n2.trim().slice(0, 15) || 'Player 2'];
        setMyTeam(t);
        mutateState(gs => {
          if (!gs.players) gs.players = {};
          gs.players[t] = names;
          return gs;
        });
      }
      refreshAssignUI();
      // Re-render UI so claim/steal buttons update immediately
      if (gameState.data) {
        import('./ui.js').then(({ renderAll }) => renderAll(gameState.data));
      }
    });
  });

  // ── Team names ────────────────────────────────────────────────────
  [1, 2, 3].forEach(t => {
    const input   = document.getElementById('name-input-' + t);
    const saveBtn = document.querySelector('.btn-save-name[data-team="' + t + '"]');

    saveBtn.addEventListener('click', () => {
      const val = input.value.trim().slice(0, 12);
      if (!val) return;
      mutateState(gs => {
        if (!gs.teamNames) gs.teamNames = {};
        gs.teamNames[t] = val;
        return gs;
      });
    });
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
      timerStartRow.style.display  = 'flex';
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

  if (codeBtn) codeBtn.addEventListener('click', () => {
    const code = normalizeGameCode(codeInput.value);
    if (!code) return;
    if (!window.confirm('Switch to game code "' + code + '"?\n\nThe app will reload and connect to that game\'s data.')) return;
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
  const adminRow     = document.getElementById('admin-unlock-row');
  const editorCard   = document.getElementById('editor-card');
  const resetCard    = document.getElementById('reset-card');

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
    if (editorCard)  editorCard.style.display = on ? 'block' : 'none';
    if (resetCard)   resetCard.style.display  = on ? 'block' : 'none';
    const lockBtn = document.getElementById('admin-lock-btn');
    if (lockBtn) lockBtn.style.display = on ? 'inline-flex' : 'none';
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

  function refreshResetBtn() {
    // visibility handled by refreshAdminUI via the card
  }

  resetBtn.addEventListener('click', () => {
    if (!isAdminMode()) return;
    const ok = window.confirm(
      '⚠️ Reset the ENTIRE game?\n\n' +
      'Every area goes back to unclaimed and the history is wiped.\n' +
      'This cannot be undone.'
    );
    if (!ok) return;
    resetCallback();
  });

  // ── Public API ────────────────────────────────────────────────────
  function refresh() {
    const gs    = gameState.data;
    const names = (gs && gs.teamNames) || {};
    [1, 2, 3].forEach(t => {
      const input = document.getElementById('name-input-' + t);
      if (input && !input.matches(':focus')) {
        input.value = names[t] || states[t].label;
      }
    });
    refreshAssignUI();
  }

  refreshAssignUI();
  return { refresh };
}
