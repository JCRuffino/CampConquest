// ── AREA EDITOR (admin tool) ──────────────────────────────────────
// Adjust an existing zone: tap it, drag its corner handles (drag an
// edge's dashed midpoint circle to add a corner there), then copy the
// snippet(s) into areas.js. No new zones are created here.

import { getMap, getAreaLayers } from './map.js';
import { showInfo } from './modal.js';
import { esc } from './shared.js';

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
      '<button id="editor-copy" class="btn btn-success btn-sm" disabled>📋 Copy Zone</button>' +
      '<button id="editor-copy-all" class="btn btn-primary btn-sm">📋 Copy ALL Zones</button>' +
    '</div>';
  document.getElementById('screen-map').appendChild(editorControl);

  editorControl.querySelector('#editor-copy').addEventListener('click', copyEditorSnippet);
  editorControl.querySelector('#editor-copy-all').addEventListener('click', copyAllZones);
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
  const map = getMap();
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

// Ghost handles sit at each edge's midpoint — drag one to bend the
// line there (it becomes a real corner)
const ghostIcon = L.divIcon({
  className: '',
  html: '<div style="width:12px;height:12px;background:rgba(255,255,255,0.75);' +
        'border:2px dashed #f59e0b;border-radius:50%;"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

export function selectEditorZone(key) {
  const layer = getAreaLayers()[key];
  if (!layer) return;
  editorKey = key;

  const hint = editorControl && editorControl.querySelector('#editor-hint');
  if (hint) hint.textContent = '✏️ ' + layer.area.name + ' — drag corners; drag a small circle to add a corner';
  const copyBtn = editorControl && editorControl.querySelector('#editor-copy');
  if (copyBtn) copyBtn.disabled = false;

  buildEditorHandles(layer);
}

function buildEditorHandles(layer) {
  clearEditorHandles();
  const map  = getMap();
  const ring = layer.polygon.getLatLngs()[0];

  ring.forEach((latlng, i) => {
    const handle = L.marker(latlng, { icon: handleIcon, draggable: true, zIndexOffset: 2000 }).addTo(map);
    handle.on('drag', () => {
      ring[i] = handle.getLatLng();
      layer.polygon.setLatLngs([ring]);
    });
    handle.on('dragend', () => {
      layer.label.setLatLng(layer.polygon.getBounds().getCenter());
      buildEditorHandles(layer); // refresh midpoints
    });
    editorHandles.push(handle);
  });

  // midpoint ghosts — dragging one inserts a new corner on that edge
  ring.forEach((latlng, i) => {
    const next = ring[(i + 1) % ring.length];
    const mid  = L.latLng((latlng.lat + next.lat) / 2, (latlng.lng + next.lng) / 2);
    const ghost = L.marker(mid, { icon: ghostIcon, draggable: true, zIndexOffset: 1900 }).addTo(map);
    let insertAt = null;
    ghost.on('dragstart', () => {
      insertAt = i + 1;
      ring.splice(insertAt, 0, ghost.getLatLng());
    });
    ghost.on('drag', () => {
      ring[insertAt] = ghost.getLatLng();
      layer.polygon.setLatLngs([ring]);
    });
    ghost.on('dragend', () => {
      layer.label.setLatLng(layer.polygon.getBounds().getCenter());
      buildEditorHandles(layer); // the new corner gets a full handle
    });
    editorHandles.push(ghost);
  });
}

function zoneSnippet(layer) {
  const ring = layer.polygon.getLatLngs()[0];
  return (
    '  {\n' +
    '    name: "' + layer.area.name.replace(/"/g, '\\"') + '",\n' +
    '    polygon: [\n' +
    ring.map(p => '      [' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + '],').join('\n') + '\n' +
    '    ],\n' +
    '  },\n'
  );
}

function sendToOutput(snippet) {
  const out = document.getElementById('editor-output');
  if (out) {
    out.value += snippet;
    out.parentElement.style.display = 'block';
  }
  if (navigator.clipboard) navigator.clipboard.writeText(snippet).catch(() => {});
  console.log('✏️ Area snippet:\n' + snippet);
}

function copyEditorSnippet() {
  if (!editorKey) return;
  const layer = getAreaLayers()[editorKey];
  sendToOutput(zoneSnippet(layer));
  showInfo('✅ Copied', '"<strong>' + esc(layer.area.name) + '</strong>" copied to the clipboard (and to the box in Settings).<br><br>Paste it over that area\'s entry in areas.js — the change is only on this device until areas.js is updated.');
}

// Every zone's CURRENT shape (including local edits) in one go
function copyAllZones() {
  const layers  = getAreaLayers();
  const snippet = Object.values(layers).map(zoneSnippet).join('');
  sendToOutput(snippet);
  showInfo('✅ Copied', 'All <strong>' + Object.keys(layers).length + '</strong> zones copied to the clipboard (and to the box in Settings).<br><br>Paste over the entries in areas.js.');
}
