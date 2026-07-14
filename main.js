import { pushState, mutateState, pushLog, listenToGameState, clearLog, listenToLog } from './firebase.js';
import { initMap, addAreas, getMap } from './map.js';
import { initSettings } from './settings.js';
import { renderAll } from './ui.js';
import { allAreas, gameState, fixArrays, toKey, esc, states,
         formatCountdown, getGameCode, setGameCode, normalizeGameCode } from './shared.js';
import { areaDefinitions } from './areas.js';

function defaultState(areas) {
  const areaState = {};
  areas.forEach(area => {
    areaState[toKey(area.name)] = {
      owner:       0,
      locked:      false,
      result:      '',
      failedBy:    [],
      displayName: area.name,
    };
  });
  return {
    areas:   areaState,
    visited: { 1: {}, 2: {}, 3: {} },
  };
}

document.addEventListener('DOMContentLoaded', () => {

  // ── Game code ──────────────────────────────────────────────────
  // Everything in Firebase lives under camp/<code>, and the security
  // rules only allow access with the right code — so nothing works
  // (and nothing is exposed) without it. Asked once per device; if
  // dismissed, it can be set later in Settings → Game Code.

  // A shared link like https://…/?code=xyz sets the code directly —
  // stored, then stripped from the address bar
  const urlCode = normalizeGameCode(new URLSearchParams(window.location.search).get('code'));
  if (urlCode) {
    setGameCode(urlCode);
    window.history.replaceState(null, '', window.location.pathname);
  }

  if (!getGameCode()) {
    const entered = normalizeGameCode(
      window.prompt('🏕️ Enter the game code\n\n(ask whoever set up the game — letters, numbers and dashes only)')
    );
    if (entered) setGameCode(entered);
  }

  const settings = initSettings(() => {
    pushState(defaultState(allAreas));
    clearLog();
  });

  try {
    initMap();
  } catch (e) {
    console.error('❌ initMap() failed:', e);
  }

  // ── History state ──────────────────────────────────────────────
  let cachedEntries = [];

  function renderHistory(entries) {
    const container  = document.getElementById('history-list');
    const teamFilter = document.getElementById('history-filter-team').value;
    const typeFilter = document.getElementById('history-filter-type').value;

    const filtered = entries.filter(e => {
      const teamMatch = teamFilter === 'all' || String(e.team) === teamFilter;
      const typeMatch = typeFilter === 'all' || e.type === typeFilter;
      return teamMatch && typeMatch;
    });

    if (filtered.length === 0) {
      container.innerHTML =
        '<span style="font-size:13px;color:#9ca3af;font-style:italic;">No entries found.</span>';
      return;
    }

    const teamNames = (gameState.data && gameState.data.teamNames) || {};

    // Each entry is badged with the team it belongs to, in that team's colour
    function teamBadge(t) {
      if (!t || !states[t]) return { color: '#6b7280', label: 'Admin' };
      return { color: states[t].color, label: teamNames[t] || states[t].label };
    }

    container.innerHTML = filtered.map(e => {
      const time  = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Timer events (countdown started/ended) get a full-width banner
      if (e.type === 'timer') {
        return (
          '<div style="background:#111827;color:white;border-radius:12px;padding:10px 14px;' +
          'margin-bottom:8px;text-align:center;font-size:13px;font-weight:700;">' +
            esc(e.message) +
            ' <span style="opacity:0.6;font-weight:600;font-size:11px;">' + time + '</span>' +
          '</div>'
        );
      }

      const badge = teamBadge(e.team);
      return (
        '<div style="background:white;border:1px solid #e5e7eb;border-radius:12px;' +
        'padding:10px 14px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,0.06);">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
            '<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;' +
            'font-weight:700;color:white;background:' + badge.color + ';">' + esc(badge.label) + '</span>' +
            '<span style="font-size:11px;color:#9ca3af;font-weight:600;">' + time + '</span>' +
          '</div>' +
          '<div style="font-size:13px;color:#374151;font-weight:500;">' + esc(e.message) + '</div>' +
        '</div>'
      );
    }).join('');
  }

  // ── Toasts for big events ──────────────────────────────────────
  const toastColors = { 0: '#6b7280', 1: '#e63946', 2: '#1d6fd1', 3: '#2a9d3f' };

  function showToast(e) {
    const cont = document.getElementById('toast-container');
    const div  = document.createElement('div');
    div.className = 'toast';
    div.style.borderLeft = '5px solid ' + (toastColors[e.team] || '#6b7280');
    div.textContent = e.message;
    cont.appendChild(div);
    requestAnimationFrame(() => div.classList.add('show'));
    setTimeout(() => {
      div.classList.remove('show');
      setTimeout(() => div.remove(), 300);
    }, 6000);
  }

  let lastToastTs = null;
  function handleToasts(entries) {
    const newest = entries.length ? entries[0].timestamp : 0;
    if (lastToastTs === null) {
      lastToastTs = newest; // don't replay the backlog on page load
      return;
    }
    entries
      .filter(e => e.big && e.timestamp > lastToastTs)
      .reverse()
      .forEach(showToast);
    if (newest > lastToastTs) lastToastTs = newest;
  }

  // One permanent log listener feeds the history screen and the toasts
  listenToLog(entries => {
    cachedEntries = entries;
    if (document.getElementById('screen-history').classList.contains('active')) {
      renderHistory(entries);
    }
    handleToasts(entries);
  });

  // ── Countdown ticker ───────────────────────────────────────────
  let endLogAttempted = false;

  function maybeLogGameEnd() {
    if (endLogAttempted) return;
    endLogAttempted = true;
    // The endLogged flag is flipped in a transaction so exactly one
    // device writes the GAME OVER entry
    mutateState(gs => {
      if (!gs.timer || !gs.timer.endsAt) return;
      if (Date.now() < gs.timer.endsAt) return;
      if (gs.timer.endLogged) return;
      gs.timer.endLogged = true;
      return gs;
    }).then(committed => {
      if (committed) {
        pushLog({
          timestamp: Date.now(),
          team:      0,
          type:      'timer',
          big:       true,
          message:   '🏁 GAME OVER — the countdown has ended! Check the leaderboard for final standings.',
        });
      }
    });
  }

  setInterval(() => {
    const pill = document.getElementById('countdown-pill');
    const gs   = gameState.data;
    const t    = gs && gs.timer;
    if (!t || !t.endsAt) {
      pill.style.display = 'none';
      endLogAttempted = false;
      return;
    }
    const remaining = t.endsAt - Date.now();
    pill.style.display = 'block';
    if (remaining <= 0) {
      pill.textContent = '⏱️ GAME OVER';
      pill.classList.add('ended');
      maybeLogGameEnd();
    } else {
      pill.textContent = '⏱️ ' + formatCountdown(remaining);
      pill.classList.remove('ended');
      endLogAttempted = false;
    }
  }, 1000);

  // ── Nav ────────────────────────────────────────────────────────
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('screen-' + btn.dataset.screen).classList.add('active');
      if (btn.dataset.screen === 'map')     setTimeout(() => getMap().invalidateSize(), 50);
      if (btn.dataset.screen === 'history') renderHistory(cachedEntries);
    });
  });

  // ── Filter dropdowns ───────────────────────────────────────────
  document.getElementById('history-filter-team').addEventListener('change', () => {
    renderHistory(cachedEntries);
  });
  document.getElementById('history-filter-type').addEventListener('change', () => {
    renderHistory(cachedEntries);
  });

  // ── Accordion ──────────────────────────────────────────────────
  document.querySelectorAll('.accordion-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const body = btn.nextElementSibling;
      btn.classList.toggle('open');
      body.classList.toggle('open');
    });
  });

  // ── Load challenge text and merge with area geometry ───────────
  fetch('challenges.csv')
    .then(r => r.text())
    .then(challengesCsv => {

      // Tab-separated: Area, Challenge, Pass Mark — challenge text can
      // freely contain commas
      const byName = {};
      const lines  = challengesCsv.trim().split('\n');
      lines.shift();
      lines.forEach(line => {
        const [name, challenge, passMark] = line.split('\t');
        if (!name) return;
        byName[name.trim()] = {
          challenge: (challenge || '').trim(),
          passMark:  (passMark || '').trim(),
        };
      });

      areaDefinitions.forEach(def => {
        const ch = byName[def.name];
        if (!ch) console.warn('⚠️ No challenge found in challenges.csv for area:', def.name);
        allAreas.push({
          name:      def.name,
          polygon:   def.polygon,
          challenge: ch ? ch.challenge : '',
          passMark:  ch ? ch.passMark : '',
        });
      });
      console.log('🏕️ Areas loaded:', allAreas.length);

      if (allAreas.length === 0) {
        console.error('❌ No areas defined — aborting boot');
        document.getElementById('sync-status').textContent = '🔴 Data Error';
        return;
      }

      addAreas(allAreas);

      // ── Firebase listener ──────────────────────────────────────
      listenToGameState((data) => {
        if (data) {
          gameState.data = data;
          fixArrays(gameState.data);
          // Areas added to areas.js after a game was created still need
          // state entries, or they'd be unclickable until the next reset
          let missing = false;
          allAreas.forEach(area => {
            const key = toKey(area.name);
            if (!gameState.data.areas[key]) missing = true;
          });
          if (missing) {
            mutateState(gs => {
              allAreas.forEach(area => {
                const key = toKey(area.name);
                if (!gs.areas[key]) {
                  gs.areas[key] = {
                    owner: 0, locked: false, result: '', failedBy: [], displayName: area.name,
                  };
                }
              });
              return gs;
            });
            return; // re-render happens when the mutation echoes back
          }
          document.getElementById('sync-status').textContent = '🟢 Live';
          renderAll(gameState.data);
          settings.refresh();
        } else {
          console.log('🔥 No Firebase data — creating default state');
          pushState(defaultState(allAreas));
        }
      }, (error) => {
        // A permission error nearly always means a wrong game code
        const denied = error && String(error.message || error).toUpperCase().includes('PERMISSION');
        document.getElementById('sync-status').textContent =
          denied ? '🔴 Wrong game code?' : '🔴 Offline';
      });

    })
    .catch(err => {
      console.error('❌ Boot error:', err);
      document.getElementById('sync-status').textContent = '🔴 Offline';
    });

});
