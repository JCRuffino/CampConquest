// ── MAP ───────────────────────────────────────────────────────────
// Leaflet init, area polygons + styling, attempt badges, and live
// player locations. The popup lives in popup.js; the admin shape
// editor in editor.js.

import { pushPlayerLocation, removePlayerLocation, listenToPlayerLocations } from './firebase.js';
import { states, gameState, toKey, getMyTeam, esc, teamName, pointInPolygon } from './shared.js';
import { openAreaPopup, popupSync } from './popup.js';
import { isEditorActive, selectEditorZone } from './editor.js';
import { siteBoundary } from './areas.js';

export { toggleAreaEditor } from './editor.js';

let map;
let userMarker   = null;
let userCircle   = null;
let lastPosition = null;

// key → { area, polygon, label }
const areaLayers    = {};
const playerMarkers = {};
// key → pulsing badge marker shown while a team is attempting there
const attemptBadges = {};

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

export function getAreaLayers() {
  return areaLayers;
}

// ── AREA POLYGONS ─────────────────────────────────────────────────
// Visual centre of a zone: the area-weighted centroid (shoelace), not
// the bounding-box centre, which drifts badly for irregular shapes.
// Falls back to the bounds centre if a concave shape puts the
// centroid outside the polygon.
function polygonCentre(coords, leafletPolygon) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const [y1, x1] = coords[j];
    const [y2, x2] = coords[i];
    const f = x1 * y2 - x2 * y1;
    a  += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (a) {
    const lat = cy / (3 * a), lng = cx / (3 * a);
    if (pointInPolygon(lat, lng, coords)) return L.latLng(lat, lng);
  }
  return leafletPolygon.getBounds().getCenter();
}

export function addAreas(areas) {
  // Ground that belongs to no zone (gaps between unlinked zones, the
  // southern woodland) renders as light grey hatching: the site polygon
  // with every zone cut out as a hole, drawn under the zones
  const noMansLand = L.polygon(
    [siteBoundary].concat(areas.map(a => a.polygon)),
    { stroke: false, fillColor: '#9ca3af', fillOpacity: 0.45, interactive: false }
  ).addTo(map);
  ensureHatchPatterns();
  setPatternFill(noMansLand, 'url(#hatch-0)', 0.12);

  areas.forEach(area => {
    const key = toKey(area.name);

    const polygon = L.polygon(area.polygon, styleFor(0, false)).addTo(map);
    const centre  = polygonCentre(area.polygon, polygon);

    // Permanent name label at the polygon's centre
    const label = L.tooltip({
      permanent:   true,
      direction:   'center',
      className:   'area-label',
      interactive: false,
    })
      .setLatLng(centre)
      .setContent(labelHTML(area.name, false))
      .addTo(map);

    polygon.on('click', e => {
      if (isEditorActive()) {
        selectEditorZone(key);
        return;
      }
      openAreaPopup(area, e.latlng);
    });

    areaLayers[key] = { area, polygon, label, centre };
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

// Pattern fills need the polygon's SVG path element — a private
// Leaflet API (`_path`, present with the default SVG renderer, pinned
// at leaflet@1.9.4). If it's ever missing (e.g. canvas renderer), fall
// back to a lighter solid fill so claimed-vs-locked stays readable.
function setPatternFill(layer, patternUrl, fallbackOpacity) {
  const path = layer._path;
  if (path) path.setAttribute('fill', patternUrl);
  else layer.setStyle({ fillOpacity: fallbackOpacity });
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

// A pulsing badge above the zone name while a team is attempting its
// challenge: ⏳ for an initial attempt, ⚔️ for a steal duel, tinted
// with the attempting team's colour
function updateAttemptBadge(key, layer, a) {
  const active = a.attemptingBy && !a.locked;
  const sig    = active ? a.attemptingBy + '|' + (a.owner !== 0 ? 1 : 0) : '';

  const existing = attemptBadges[key];
  if (!active) {
    if (existing) {
      map.removeLayer(existing);
      delete attemptBadges[key];
    }
    return;
  }
  if (existing && existing._sig === sig) return;
  if (existing) map.removeLayer(existing);

  const color  = states[a.attemptingBy].color;
  const symbol = a.owner !== 0 ? '⚔️' : '⏳';
  const icon = L.divIcon({
    className: '',
    html:
      '<div class="player-dot" style="' +
        '--pc:' + color + ';' +
        'width:26px;height:26px;border-radius:50%;' +
        'background:' + color + ';' +
        'border:2px solid white;' +
        'box-shadow:0 2px 6px rgba(0,0,0,0.4);' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:14px;">' + symbol + '</div>',
    iconSize:   [26, 26],
    iconAnchor: [13, 40], // floats above the zone name
  });

  const badge = L.marker(layer.centre, {
    icon, zIndexOffset: 1500, interactive: false,
  }).addTo(map);
  badge._sig = sig;
  attemptBadges[key] = badge;
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
    if (a.owner !== 0 && !a.locked) {
      // setStyle just wrote a solid fill attribute; swap it for the hatch
      setPatternFill(layer.polygon, 'url(#hatch-' + a.owner + ')', 0.3);
    }
    layer.label.setContent(labelHTML(layer.area.name, a.locked));
    updateAttemptBadge(key, layer, a);
  });
  popupSync(gs);
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
