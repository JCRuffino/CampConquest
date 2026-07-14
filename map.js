import { pushPlayerLocation, removePlayerLocation, listenToPlayerLocations } from './firebase.js';
import { states, gameState, toKey, getMyTeam, esc, teamName,
         isVisited, pointInPolygon } from './shared.js';
import { claimArea, scoutArea, adminResetArea } from './actions.js';
import { siteBoundary, winLines } from './areas.js';

let map;
let userMarker   = null;
let userCircle   = null;
let lastPosition = null;

// key → { area, polygon, label }
const areaLayers    = {};
const playerMarkers = {};

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
    autoScout(e.latlng);
  });

  map.on('click', handleEditorClick);

  initPlayerLocationSharing();
}

export function getMap() {
  return map;
}

// Walking into an area reveals its challenge to your team
function autoScout(latlng) {
  const gs     = gameState.data;
  const myTeam = getMyTeam();
  if (!gs || !myTeam) return;
  Object.entries(areaLayers).forEach(([key, layer]) => {
    if (isVisited(gs, myTeam, key)) return;
    if (pointInPolygon(latlng.lat, latlng.lng, layer.area.polygon)) {
      scoutArea(key, myTeam, true);
    }
  });
}

// ── AREA POLYGONS ─────────────────────────────────────────────────
export function addAreas(areas) {
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
      .setContent(esc(area.name))
      .addTo(map);

    polygon.on('click', e => {
      if (editorActive) return; // editor mode captures map clicks instead
      handleAreaClick(area, e.latlng);
    });

    areaLayers[key] = { area, polygon, label };
  });

  drawWinLines();

  // Frame the whole site on first load
  const all = Object.values(areaLayers).map(l => l.polygon.getBounds());
  if (all.length) {
    map.fitBounds(all.reduce((acc, b) => acc.extend(b), all[0]), { padding: [30, 30] });
  }
}

// The win lines from areas.js, drawn zone-centre to zone-centre so
// players can see exactly which runs of 4 win the game
function drawWinLines() {
  winLines.forEach(line => {
    const pts = line
      .map(name => areaLayers[toKey(name)])
      .filter(Boolean)
      .map(l => l.polygon.getBounds().getCenter());
    if (pts.length < 2) return;
    // white casing under a dark dotted line keeps it readable on any fill
    L.polyline(pts, { color: 'white',   weight: 6, opacity: 0.75, interactive: false }).addTo(map);
    L.polyline(pts, { color: '#111827', weight: 2.5, opacity: 0.8, dashArray: '1,8', lineCap: 'round', interactive: false }).addTo(map);
    pts.forEach(p => {
      L.circleMarker(p, {
        radius: 4, color: 'white', weight: 2, fillColor: '#111827',
        fillOpacity: 0.9, interactive: false,
      }).addTo(map);
    });
  });
}

function styleFor(owner, locked) {
  const color = states[owner].color;
  return {
    color:       owner === 0 ? '#9ca3af' : color,
    weight:      locked ? 4 : (owner === 0 ? 1.5 : 2.5),
    fillColor:   color,
    fillOpacity: owner === 0 ? 0.04 : (locked ? 0.55 : 0.3),
  };
}

// Restyle every polygon from the latest game state — called on each
// Firebase update so all phones recolour live
export function updateAreaLayers(gs) {
  const myTeam = getMyTeam();
  Object.entries(areaLayers).forEach(([key, layer]) => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    layer.polygon.setStyle(styleFor(a.owner, a.locked));
    const unknown = myTeam !== null && !isVisited(gs, myTeam, key);
    layer.label.setContent(
      (a.locked ? '🔒 ' : '') + (unknown ? '❓ ' : '') + esc(layer.area.name)
    );
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
  const isAdmin  = myTeam === null;
  const expected = { owner: a.owner, locked: !!a.locked };

  const isUnclaimed = a.owner === 0;
  const isMine      = myTeam !== null && a.owner === myTeam;
  // Admins see everything; teams only what they've scouted
  const revealed    = isAdmin || isVisited(gs, myTeam, key);

  const statusText = a.locked
    ? '🔒 Locked by ' + esc(teamName(gs, a.owner)) + ' — cannot be taken'
    : isUnclaimed
      ? 'Unclaimed'
      : 'Claimed by ' + esc(teamName(gs, a.owner)) + ' — can be stolen';

  let body = '';
  let actionsHTML = '';

  if (!revealed) {
    body =
      '<div style="font-size:12px;color:#6b7280;margin-top:8px;line-height:1.5;">' +
        '❓ Your team hasn\'t scouted this area yet — the challenge is revealed ' +
        'automatically when you walk into it.' +
      '</div>';
    if (myTeam !== null) {
      actionsHTML =
        '<button id="scout-btn" class="btn btn-amber btn-full" style="margin-top:10px;">' +
        '📍 We\'re Here — Reveal Challenge</button>';
    }
  } else {
    body =
      '<div style="margin-top:8px;">' +
        '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;' +
          'font-weight:700;color:white;background:#f4a300;">⚡ Challenge</span>' +
        '<div style="font-size:12px;color:#374151;margin-top:4px;line-height:1.5;">' +
          esc(area.challenge || 'No challenge set') + '</div>' +
      '</div>';

    if (!isUnclaimed) {
      body +=
        '<div style="font-size:12px;color:#374151;margin-top:8px;">' +
          '<span style="font-weight:700;">🎯 Result to beat:</span> ' +
          esc(a.result || '—') +
          ' <span style="color:#9ca3af;">(' + esc(teamName(gs, a.owner)) + ')</span>' +
        '</div>';
    }

    if (a.locked) {
      body += '<div style="font-size:12px;color:#6b7280;margin-top:8px;">' +
        'This area was stolen and is locked in for the rest of the game.</div>';
    } else if (isMine) {
      body += '<div style="font-size:12px;color:#6b7280;margin-top:8px;">' +
        'Your area — another team can steal it (and lock it) by beating your result.</div>';
    } else if (myTeam !== null) {
      const verb  = isUnclaimed ? '⛺ We Did It — Claim!' : '😈 We Beat It — Steal &amp; Lock!';
      actionsHTML =
        '<button id="claim-btn" class="btn btn-full" style="margin-top:10px;background:' +
        states[myTeam].color + ';">' + verb + '</button>';
    } else if (isUnclaimed) {
      body += '<div style="font-size:12px;color:#9ca3af;margin-top:8px;">Join a team in Settings to claim areas.</div>';
    }
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

  const scoutBtn = content.querySelector('#scout-btn');
  if (scoutBtn) scoutBtn.addEventListener('click', async () => {
    const ok = window.confirm(
      '📍 Reveal the challenge at ' + area.name + '?\n\n' +
      'Honour system: only do this if your team is genuinely AT this area.\n' +
      '(It normally reveals itself via GPS when you walk in.)'
    );
    if (!ok) return;
    await scoutArea(key, myTeam, false);
    map.closePopup();
  });

  const claimBtn = content.querySelector('#claim-btn');
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
    if (!res.ok) { showError(res.reason || ''); return; }
    map.closePopup();
  });

  // ── Admin: reset area ──────────────────────────────────────────
  if (isAdmin) {
    const adminDiv = document.createElement('div');
    adminDiv.innerHTML =
      '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;">' +
        '<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:6px;">⚙️ Admin: Reset Area</div>' +
        '<select id="admin-owner-select" style="width:100%;margin-bottom:6px;">' +
          [0, 1, 2, 3].map(i =>
            '<option value="' + i + '"' + (i === a.owner ? ' selected' : '') + '>' +
            esc(teamName(gs, i)) + '</option>'
          ).join('') +
        '</select>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#374151;' +
          'text-transform:none;letter-spacing:0;font-weight:600;margin:0 0 8px;">' +
          '<input type="checkbox" id="admin-locked-check"' + (a.locked ? ' checked' : '') + ' ' +
            'style="width:auto;margin:0;" /> Locked' +
        '</label>' +
        '<button id="admin-reset-btn" class="btn btn-amber btn-full btn-sm">🔄 Apply</button>' +
      '</div>';
    content.appendChild(adminDiv);

    adminDiv.querySelector('#admin-reset-btn').addEventListener('click', async () => {
      const owner  = parseInt(adminDiv.querySelector('#admin-owner-select').value);
      const locked = adminDiv.querySelector('#admin-locked-check').checked;
      await adminResetArea(key, owner, locked);
      map.closePopup();
    });
  }

  L.popup({ maxWidth: 280 })
    .setLatLng(latlng)
    .setContent(content)
    .openOn(map);
}

// ── AREA EDITOR (admin tool) ──────────────────────────────────────
// Trace a new area by tapping its corners on the map; the finished
// polygon is output as a snippet ready to paste into areas.js
let editorActive  = false;
let editorPoints  = [];
let editorMarkers = [];
let editorLine    = null;
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
    '<div style="font-size:12px;font-weight:700;margin-bottom:6px;">✏️ Tap the map to trace an area</div>' +
    '<div style="display:flex;gap:6px;">' +
      '<button id="editor-undo" class="btn btn-ghost btn-sm">↩ Undo</button>' +
      '<button id="editor-finish" class="btn btn-success btn-sm">✅ Finish Area</button>' +
    '</div>';
  document.getElementById('screen-map').appendChild(editorControl);

  editorControl.querySelector('#editor-undo').addEventListener('click', () => {
    editorPoints.pop();
    const m = editorMarkers.pop();
    if (m) map.removeLayer(m);
    redrawEditorLine();
  });

  editorControl.querySelector('#editor-finish').addEventListener('click', finishEditorArea);
}

function stopEditor() {
  clearEditorDrawing();
  if (editorControl) {
    editorControl.remove();
    editorControl = null;
  }
}

function clearEditorDrawing() {
  editorPoints = [];
  editorMarkers.forEach(m => map.removeLayer(m));
  editorMarkers = [];
  if (editorLine) {
    map.removeLayer(editorLine);
    editorLine = null;
  }
}

function handleEditorClick(e) {
  if (!editorActive) return;
  editorPoints.push([
    parseFloat(e.latlng.lat.toFixed(6)),
    parseFloat(e.latlng.lng.toFixed(6)),
  ]);
  const m = L.circleMarker(e.latlng, {
    radius: 5, color: 'white', fillColor: '#f59e0b', fillOpacity: 1, weight: 2
  }).addTo(map);
  editorMarkers.push(m);
  redrawEditorLine();
}

function redrawEditorLine() {
  if (editorLine) map.removeLayer(editorLine);
  editorLine = editorPoints.length > 1
    ? L.polyline(editorPoints, { color: '#f59e0b', weight: 3, dashArray: '6,6' }).addTo(map)
    : null;
}

function finishEditorArea() {
  if (editorPoints.length < 3) {
    window.alert('Tap at least 3 corners first.');
    return;
  }
  const name = window.prompt('Name for this area?');
  if (!name) return;

  const snippet =
    '  {\n' +
    '    name: "' + name.replace(/"/g, '\\"') + '",\n' +
    '    polygon: [\n' +
    editorPoints.map(p => '      [' + p[0] + ', ' + p[1] + '],').join('\n') + '\n' +
    '    ],\n' +
    '  },\n';

  const out = document.getElementById('editor-output');
  if (out) {
    out.value += snippet;
    out.parentElement.style.display = 'block';
  }
  if (navigator.clipboard) navigator.clipboard.writeText(snippet).catch(() => {});
  console.log('✏️ New area snippet:\n' + snippet);
  window.alert('✅ "' + name + '" captured!\n\nThe snippet was added to the box in Settings (and copied to the clipboard). Paste it into areas.js.');

  clearEditorDrawing();
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
