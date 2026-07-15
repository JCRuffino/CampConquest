import { pushPlayerLocation, removePlayerLocation, listenToPlayerLocations } from './firebase.js';
import { states, gameState, toKey, getMyTeam, esc, teamName, playerNames,
         hasStarted, getCurrentAttempt, isAdminMode, formatCountdown } from './shared.js';
import { claimArea, failChallenge, startAttempt, adminSetArea } from './actions.js';
import { siteBoundary } from './areas.js';

let map;
let userMarker   = null;
let userCircle   = null;
let lastPosition = null;

// key → { area, polygon, label }
const areaLayers    = {};
const playerMarkers = {};

// Names too wide for their zone break onto two lines, one word per line
const TWO_LINE_NAMES = new Set(['Main Campfire', 'RPG Glade', 'SD Glade', 'Village Square']);

function labelHTML(name, locked) {
  const safe = TWO_LINE_NAMES.has(name)
    ? name.split(' ').map(esc).join('<br>')
    : esc(name);
  return (locked ? '🔒 ' : '') + safe;
}

// ── SITE ILLUSTRATION OVERLAY ─────────────────────────────────────
// When the nicer hand-drawn site map is ready, drop the image in this
// folder and set e.g.:
//   const SITE_IMAGE = { url: 'site-map.png', bounds: [[50.8587, 0.2362], [50.8618, 0.2417]] };
// bounds = [south-west corner, north-east corner] the image stretches over.
const SITE_IMAGE = null;

export function initMap() {
  // Bushy Wood Activity Centre, Hailsham BN27 3LZ
  map = L.map('map').setView([50.86025, 0.23887], 17);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    maxNativeZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  if (SITE_IMAGE) {
    L.imageOverlay(SITE_IMAGE.url, SITE_IMAGE.bounds, { opacity: 0.9 }).addTo(map);
  }

  // Site perimeter (from OpenStreetMap) as a static outline
  L.polygon(siteBoundary, {
    color: '#111827',
    weight: 3,
    dashArray: '10,8',
    fill: false,
    interactive: false,
  }).addTo(map);

  map.locate({ watch: true, enableHighAccuracy: true });

  map.on('locationfound', function(e) {
    lastPosition = e.latlng;
    const radius = e.accuracy / 2;
    if (userMarker) {
      userMarker.setLatLng(e.latlng);
      userCircle.setLatLng(e.latlng).setRadius(radius);
    } else {
      userMarker = L.circleMarker(e.latlng, {
        radius: 8, color: 'white', fillColor: '#4285F4', fillOpacity: 1, weight: 3
      }).addTo(map).bindTooltip('You are here', { permanent: false, direction: 'top' });
      userCircle = L.circle(e.latlng, {
        radius, color: '#4285F4', fillOpacity: 0.1, weight: 1
      }).addTo(map);
    }
  });

  initPlayerLocationSharing();
}

export function getMap() {
  return map;
}

// ── AREA POLYGONS ─────────────────────────────────────────────────
export function addAreas(areas) {
  // Ground that belongs to no zone (gaps between unlinked zones, the
  // southern woodland) renders as light grey hatching: the site polygon
  // with every zone cut out as a hole, drawn under the zones
  const noMansLand = L.polygon(
    [siteBoundary].concat(areas.map(a => a.polygon)),
    { stroke: false, fillColor: '#9ca3af', fillOpacity: 0.45, interactive: false }
  ).addTo(map);
  ensureHatchPatterns();
  if (noMansLand._path) noMansLand._path.setAttribute('fill', 'url(#hatch-0)');

  areas.forEach(area => {
    const key = toKey(area.name);

    const polygon = L.polygon(area.polygon, styleFor(0, false)).addTo(map);

    // Permanent name label at the polygon's centre
    const label = L.tooltip({
      permanent:   true,
      direction:   'center',
      className:   'area-label',
      interactive: false,
    })
      .setLatLng(polygon.getBounds().getCenter())
      .setContent(labelHTML(area.name, false))
      .addTo(map);

    polygon.on('click', e => {
      if (editorActive) {
        selectEditorZone(key);
        return;
      }
      handleAreaClick(area, e.latlng);
    });

    areaLayers[key] = { area, polygon, label };
  });

  // Frame the whole site on first load
  const all = Object.values(areaLayers).map(l => l.polygon.getBounds());
  if (all.length) {
    map.fitBounds(all.reduce((acc, b) => acc.extend(b), all[0]), { padding: [30, 30] });
  }
}

// ── TEAM-COLOUR HATCH PATTERNS ────────────────────────────────────
// Claimed-but-unlocked zones get a diagonal-stripe fill; locked zones
// are solid. SVG patterns are injected into Leaflet's overlay SVG.
function ensureHatchPatterns() {
  const svg = map.getPane('overlayPane').querySelector('svg');
  if (!svg || svg.querySelector('#hatch-1')) return;
  const NS   = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(NS, 'defs');
  // hatch-0 = light grey for no-man's-land; hatch-1..3 = team colours
  [0, 1, 2, 3].forEach(t => {
    const pattern = document.createElementNS(NS, 'pattern');
    pattern.setAttribute('id', 'hatch-' + t);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', '10');
    pattern.setAttribute('height', '10');
    pattern.setAttribute('patternTransform', 'rotate(45)');
    const stripe = document.createElementNS(NS, 'rect');
    stripe.setAttribute('width', t === 0 ? '3' : '4.5');
    stripe.setAttribute('height', '10');
    stripe.setAttribute('fill', t === 0 ? '#9ca3af' : states[t].color);
    pattern.appendChild(stripe);
    defs.appendChild(pattern);
  });
  svg.appendChild(defs);
}

function styleFor(owner, locked) {
  const color = states[owner].color;
  return {
    color:       owner === 0 ? '#9ca3af' : color,
    weight:      locked ? 4 : (owner === 0 ? 1.5 : 2.5),
    fillColor:   color,
    fillOpacity: owner === 0 ? 0.04 : (locked ? 0.6 : 0.45),
  };
}

// Restyle every polygon from the latest game state — called on each
// Firebase update so all phones recolour live. Claimed-but-unlocked
// zones show hatched (stealable); locked zones are solid.
export function updateAreaLayers(gs) {
  ensureHatchPatterns();
  Object.entries(areaLayers).forEach(([key, layer]) => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    layer.polygon.setStyle(styleFor(a.owner, a.locked));
    if (a.owner !== 0 && !a.locked && layer.polygon._path) {
      // setStyle just wrote a solid fill attribute; swap it for the hatch
      layer.polygon._path.setAttribute('fill', 'url(#hatch-' + a.owner + ')');
    }
    layer.label.setContent(labelHTML(layer.area.name, a.locked));
  });
}

// ── AREA POPUP ────────────────────────────────────────────────────
function handleAreaClick(area, latlng) {
  const gs = gameState.data;
  if (!gs || !gs.areas) return;
  const key = toKey(area.name);
  const a   = gs.areas[key];
  if (!a) return;

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
  // The admin can override the CSV pass mark mid-game
  const passMark    = a.passMark || area.passMark;

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
          esc(area.challenge || 'No challenge set') + '</div>' +
      '</div>';
    if (passMark) {
      body +=
        '<div style="font-size:12px;color:#374151;margin-top:6px;">' +
          '<span style="font-weight:700;">🎯 Pass mark:</span> ' + esc(passMark) +
        '</div>';
    }
    if (!isUnclaimed) {
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
    body += isUnclaimed
      ? '<div style="font-size:12px;color:#f59e0b;font-weight:700;margin-top:6px;">' +
        '⏳ ' + esc(teamName(gs, a.attemptingBy)) + ' is attempting this challenge right now!</div>'
      : '<div style="font-size:12px;color:#e63946;font-weight:700;margin-top:6px;">' +
        '⚔️ ' + esc(teamName(gs, a.attemptingBy)) + ' is contesting this area — win or lose, it locks!</div>';
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
        '⏳ Wait — ' + esc(teamName(gs, a.attemptingBy)) + ' is attempting this challenge. You can start if they fail.</div>'
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
    // Attempt in progress — phone-duty reminder, timer (if any), and
    // resolve buttons
    const players = playerNames(gs, myTeam);
    const holder  = players[attempt.holder || 0];
    const doer    = players[1 - (attempt.holder || 0)];
    body +=
      '<div style="font-size:12px;color:#374151;font-weight:600;margin-top:8px;' +
        'background:#fef3c7;border-radius:8px;padding:6px 8px;">' +
        '📱 ' + esc(holder) + ' holds the phone and reads aloud — 💪 ' + esc(doer) + ' does the challenge!' +
      '</div>';
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
    const verb = isUnclaimed ? '⛺ We Passed — Claim!' : '😈 We Beat It — Steal &amp; Lock!';
    actionsHTML =
      '<button id="claim-btn" class="btn btn-full" style="margin-top:10px;background:' +
      states[myTeam].color + ';">' + verb + '</button>' +
      '<button id="fail-btn" class="btn btn-neutral btn-full" style="margin-top:6px;">❌ We Failed</button>';
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
    const el = content.querySelector('#popup-error');
    el.textContent   = msg;
    el.style.display = 'block';
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
    const ok = window.confirm(
      '▶️ Start the challenge at ' + area.name + '?\n\n' +
      'Only start when your team is AT this area and ready.\n' +
      'The challenge is revealed, any timer starts immediately, and your ' +
      'team must then record either a pass or a fail.'
    );
    if (!ok) return;
    const res = await startAttempt(key, myTeam, expected);
    if (!res.ok) { showError(res.reason || ''); return; }
    window.alert(
      '📱 Make sure ' + res.holder + ' is holding the phone!\n\n' +
      res.holder + ' reads the challenge out loud — ' + res.attempter + ' is the one who does it.'
    );
    map.closePopup();
    // Reopen straight away, now showing the challenge and timer
    setTimeout(() => handleAreaClick(area, latlng), 150);
  });

  const claimBtn = content.querySelector('#claim-btn');
  if (claimBtn) claimBtn.addEventListener('click', async () => {
    const confirmMsg = isUnclaimed
      ? '⛺ Claim ' + area.name + '?\n\nOnly press this if your team genuinely reached the pass mark' +
        (passMark ? ' (' + passMark + ')' : '') + '!'
      : '😈 Steal ' + area.name + '?\n\nOnly press this if your team genuinely BEAT the result "' +
        (a.result || '—') + '".\nStolen areas lock permanently!';
    if (!window.confirm(confirmMsg)) return;

    // For count-up challenges the elapsed time IS the natural result
    let suggested = '';
    if (area.timer && area.timer.mode === 'up' && attempt) {
      suggested = formatCountdown(Date.now() - attempt.startedAt);
    }
    const result = window.prompt(
      '🏅 What result did your team get?\n(e.g. "14 catches", "3:38" — this is what others must beat)',
      suggested
    );
    if (result === null) return;
    const trimmed = result.trim().slice(0, 60);
    if (!trimmed) { showError('You must record a result.'); return; }

    const res = await claimArea(key, myTeam, expected, trimmed);
    if (!res.ok) { showError(res.reason || ''); return; }
    map.closePopup();
  });

  const failBtn = content.querySelector('#fail-btn');
  if (failBtn) failBtn.addEventListener('click', async () => {
    const ok = window.confirm(
      '❌ Record a FAILED attempt at ' + area.name + '?\n\n' +
      (isUnclaimed
        ? 'Your team will NEVER be able to attempt this area again.'
        : 'The steal has failed — the area LOCKS permanently for ' + teamName(gs, a.owner) + '!')
    );
    if (!ok) return;
    const res = await failChallenge(key, myTeam, expected);
    if (!res.ok) { showError(res.reason || ''); return; }
    map.closePopup();
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
          'font-size:12px;font-family:inherit;outline:none;margin-bottom:6px;box-sizing:border-box;" />' +
        '<input type="text" id="admin-passmark-input" maxlength="60" placeholder="Pass mark" ' +
          'value="' + esc(passMark || '') + '" ' +
          'style="width:100%;padding:6px 8px;border:1px solid #e5e7eb;border-radius:8px;' +
          'font-size:12px;font-family:inherit;outline:none;margin-bottom:8px;box-sizing:border-box;" />' +
        '<button id="admin-apply-btn" class="btn btn-amber btn-full btn-sm">🔄 Apply</button>' +
      '</div>';
    content.appendChild(adminDiv);

    adminDiv.querySelector('#admin-apply-btn').addEventListener('click', async () => {
      await adminSetArea(key, {
        owner:    parseInt(adminDiv.querySelector('#admin-owner-select').value),
        locked:   adminDiv.querySelector('#admin-locked-check').checked,
        result:   adminDiv.querySelector('#admin-result-input').value.trim().slice(0, 60),
        passMark: adminDiv.querySelector('#admin-passmark-input').value.trim().slice(0, 60),
      });
      map.closePopup();
    });
  }

  L.popup({ maxWidth: 280 })
    .setLatLng(latlng)
    .setContent(content)
    .openOn(map);
}

// ── AREA EDITOR (admin tool) ──────────────────────────────────────
// Adjust an existing zone: tap it, drag its corner handles, then copy
// the updated snippet into areas.js. No new zones are created.
let editorActive  = false;
let editorKey     = null;
let editorHandles = [];
let editorControl = null;

export function isEditorActive() {
  return editorActive;
}

export function toggleAreaEditor() {
  editorActive = !editorActive;
  if (editorActive) startEditor();
  else stopEditor();
  return editorActive;
}

function startEditor() {
  editorControl = document.createElement('div');
  editorControl.id = 'editor-control';
  editorControl.innerHTML =
    '<div id="editor-hint" style="font-size:12px;font-weight:700;margin-bottom:6px;">✏️ Tap a zone to edit its corners</div>' +
    '<div style="display:flex;gap:6px;justify-content:center;">' +
      '<button id="editor-copy" class="btn btn-success btn-sm" disabled>📋 Copy Snippet</button>' +
    '</div>';
  document.getElementById('screen-map').appendChild(editorControl);

  editorControl.querySelector('#editor-copy').addEventListener('click', copyEditorSnippet);
}

function stopEditor() {
  clearEditorHandles();
  editorKey = null;
  if (editorControl) {
    editorControl.remove();
    editorControl = null;
  }
}

function clearEditorHandles() {
  editorHandles.forEach(h => map.removeLayer(h));
  editorHandles = [];
}

const handleIcon = L.divIcon({
  className: '',
  html: '<div style="width:16px;height:16px;background:white;border:3px solid #f59e0b;' +
        'border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function selectEditorZone(key) {
  const layer = areaLayers[key];
  if (!layer) return;
  clearEditorHandles();
  editorKey = key;

  const hint = editorControl && editorControl.querySelector('#editor-hint');
  if (hint) hint.textContent = '✏️ ' + layer.area.name + ' — drag the handles, then Copy';
  const copyBtn = editorControl && editorControl.querySelector('#editor-copy');
  if (copyBtn) copyBtn.disabled = false;

  const ring = layer.polygon.getLatLngs()[0];
  ring.forEach((latlng, i) => {
    const handle = L.marker(latlng, { icon: handleIcon, draggable: true, zIndexOffset: 2000 }).addTo(map);
    handle.on('drag', () => {
      ring[i] = handle.getLatLng();
      layer.polygon.setLatLngs([ring]);
    });
    handle.on('dragend', () => {
      layer.label.setLatLng(layer.polygon.getBounds().getCenter());
    });
    editorHandles.push(handle);
  });
}

function copyEditorSnippet() {
  if (!editorKey) return;
  const layer = areaLayers[editorKey];
  const ring  = layer.polygon.getLatLngs()[0];
  const snippet =
    '  {\n' +
    '    name: "' + layer.area.name.replace(/"/g, '\\"') + '",\n' +
    '    polygon: [\n' +
    ring.map(p => '      [' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + '],').join('\n') + '\n' +
    '    ],\n' +
    '  },\n';

  const out = document.getElementById('editor-output');
  if (out) {
    out.value += snippet;
    out.parentElement.style.display = 'block';
  }
  if (navigator.clipboard) navigator.clipboard.writeText(snippet).catch(() => {});
  console.log('✏️ Updated area snippet:\n' + snippet);
  window.alert('✅ Updated "' + layer.area.name + '" copied!\n\nPaste it over that area\'s entry in areas.js (also in the box in Settings). The change is only on this device until areas.js is updated.');
}

// ── PLAYER LOCATION SHARING ───────────────────────────────────────
function makePlayerIcon(color, label) {
  return L.divIcon({
    className: '',
    html:
      '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">' +
        '<div class="player-dot" style="' +
          '--pc:' + color + ';' +
          'width:18px;height:18px;border-radius:50%;' +
          'background:' + color + ';' +
          'border:2px solid white;' +
          'box-shadow:0 2px 6px rgba(0,0,0,0.4);">' +
        '</div>' +
        '<div style="' +
          'background:' + color + ';color:white;' +
          'font-size:10px;font-weight:700;' +
          'padding:1px 5px;border-radius:6px;' +
          'white-space:nowrap;' +
          'box-shadow:0 1px 4px rgba(0,0,0,0.3);' +
          'font-family:Arial,sans-serif;">' +
          esc(label) +
        '</div>' +
      '</div>',
    iconSize: [60, 36],
    iconAnchor: [30, 9],
  });
}

function initPlayerLocationSharing() {

  function pushIfOnTeam() {
    const team = getMyTeam();
    if (!team || !lastPosition) return;
    const name = teamName(gameState.data, team);
    pushPlayerLocation(team, lastPosition.lat, lastPosition.lng, name);
  }

  function clearIfNoTeam() {
    if (!getMyTeam()) removePlayerLocation();
  }

  pushIfOnTeam();
  setInterval(pushIfOnTeam, 5000);
  setInterval(clearIfNoTeam, 5000);

  window.addEventListener('beforeunload', () => {
    removePlayerLocation();
  });

  listenToPlayerLocations(function(players) {
    const now = Date.now();
    const STALE_MS = 30000;

    Object.keys(playerMarkers).forEach(id => {
      if (!players[id] || (now - players[id].ts) > STALE_MS) {
        map.removeLayer(playerMarkers[id]);
        delete playerMarkers[id];
      }
    });

    Object.entries(players).forEach(function(entry) {
      const id     = entry[0];
      const player = entry[1];
      if ((now - player.ts) > STALE_MS) return;

      const color  = (states[player.team] || states[0]).color;
      const icon   = makePlayerIcon(color, player.name);
      const latlng = L.latLng(player.lat, player.lng);

      if (playerMarkers[id]) {
        playerMarkers[id].setLatLng(latlng);
        playerMarkers[id].setIcon(icon);
      } else {
        playerMarkers[id] = L.marker(latlng, {
          icon: icon,
          zIndexOffset: 1000,
          interactive: false
        }).addTo(map);
      }
    });
  });
}
