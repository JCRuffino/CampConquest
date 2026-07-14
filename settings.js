import { mutateState, pushLog } from './firebase.js';
import { gameState, getMyTeam, setMyTeam, states } from './shared.js';
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
    refreshTimerUI();
    refreshEditorCard();
  }

  assignBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const t      = parseInt(btn.dataset.team);
      const myTeam = getMyTeam();
      if (myTeam === t) setMyTeam(null);
      else if (myTeam !== null) return;
      else setMyTeam(t);
      refreshAssignUI();
      // Re-render UI so claim/lock buttons update immediately
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
    const isAdmin = getMyTeam() === null;
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
    if (getMyTeam() !== null) return;
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
    if (getMyTeam() !== null) return;
    mutateState(gs => {
      if (!gs.timer || !gs.timer.endsAt || Date.now() >= gs.timer.endsAt) return;
      gs.timer.endsAt = Date.now();
      return gs;
    });
  });

  document.getElementById('timer-cancel-btn').addEventListener('click', () => {
    if (getMyTeam() !== null) return;
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

  // ── Area editor (admin) ───────────────────────────────────────────
  const editorCard = document.getElementById('editor-card');
  const editorBtn  = document.getElementById('editor-toggle-btn');

  function refreshEditorCard() {
    if (editorCard) editorCard.style.display = getMyTeam() === null ? 'block' : 'none';
  }

  if (editorBtn) {
    editorBtn.addEventListener('click', () => {
      const active = toggleAreaEditor();
      editorBtn.textContent = active ? '🛑 Stop Editing' : '✏️ Start Area Editor';
      if (active) {
        // Jump to the map so tracing can begin straight away
        document.querySelector('.nav-btn[data-screen="map"]').click();
      }
    });
  }

  // ── Reset ─────────────────────────────────────────────────────────
  const RESET_PASSWORD = 'happycampers'; // 🔑 Change this

  const resetBtn       = document.getElementById('reset-btn');
  const blockedMsg     = document.getElementById('reset-blocked-msg');
  const resetOverlay   = document.getElementById('reset-overlay');
  const confirmBtn     = document.getElementById('reset-confirm-btn');
  const cancelBtn      = document.getElementById('reset-cancel-btn');
  const passwordInput  = document.getElementById('reset-password-input');
  const passwordError  = document.getElementById('reset-password-error');

  function refreshResetBtn() {
    if (getMyTeam()) {
      resetBtn.disabled        = true;
      resetBtn.style.opacity   = '0.4';
      blockedMsg.style.display = 'block';
    } else {
      resetBtn.disabled        = false;
      resetBtn.style.opacity   = '1';
      blockedMsg.style.display = 'none';
    }
  }

  function closeResetModal() {
    resetOverlay.classList.remove('active');
    passwordInput.value        = '';
    passwordError.style.display = 'none';
    passwordInput.style.borderColor = '#e5e7eb';
  }

  resetBtn.addEventListener('click', () => {
    if (getMyTeam()) return;
    closeResetModal(); // clear any previous state
    resetOverlay.classList.add('active');
    setTimeout(() => passwordInput.focus(), 50);
  });

  cancelBtn.addEventListener('click', closeResetModal);

  // Close on backdrop click
  resetOverlay.addEventListener('click', (e) => {
    if (e.target === resetOverlay) closeResetModal();
  });

  confirmBtn.addEventListener('click', () => {
    if (passwordInput.value === RESET_PASSWORD) {
      closeResetModal();
      resetCallback();
    } else {
      passwordError.style.display     = 'block';
      passwordInput.style.borderColor = '#e63946';
      passwordInput.value             = '';
      passwordInput.focus();
    }
  });

  // Allow pressing Enter in the password field
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBtn.click();
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
