// Content/data integrity checks that need Node's filesystem access —
// NOT importable from tests/browser-harness.html (it has no node:fs
// shim), so these do not run in that browser fallback. Run with:
//   node --test tests/*.test.js
// This dev machine has no Node; run on one that does before trusting
// these results.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { areaDefinitions } from '../areas.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const popupSrc = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const csvText  = fs.readFileSync(path.join(root, 'challenges.csv'), 'utf8');

// Mirrors the tab-separated parsing in main.js: Area, Challenge, Pass
// Mark, Timer, Info, Answer, Challenge (2p), Pass Mark (2p)
const csvRows = csvText.trim().split(/\r?\n/).slice(1).map(line => {
  const cols = line.split('\t').map(c => (c || '').replace(/\r$/, ''));
  return { name: (cols[0] || '').trim(), answer: (cols[5] || '').trim() };
}).filter(r => r.name);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('no challenges.csv Answer value leaks into popup.js as a guess example', () => {
  const answers = [...new Set(csvRows.map(r => r.answer).filter(Boolean))];
  assert.ok(answers.length > 0, 'expected at least one guess-type Answer in challenges.csv');

  answers.forEach(value => {
    // Decimal answers (contain '.') are checked as a plain substring —
    // a coincidental decimal collision is vanishingly unlikely and
    // would still be a genuine hit worth failing on. Pure integers use
    // a word-boundary regex so the check doesn't false-positive on an
    // unrelated multi-digit token that merely contains these digits
    // (e.g. a hex colour or a pixel size elsewhere in the file).
    const found = value.includes('.')
      ? popupSrc.includes(value)
      : new RegExp('\\b' + escapeRegExp(value) + '\\b').test(popupSrc);
    assert.equal(found, false,
      'popup.js contains the literal answer "' + value + '" — this leaks a guess answer to players');
  });
});

test('every area in areas.js has exactly one matching challenges.csv row', () => {
  const csvNameCounts = new Map();
  csvRows.forEach(r => csvNameCounts.set(r.name, (csvNameCounts.get(r.name) || 0) + 1));

  areaDefinitions.forEach(def => {
    const count = csvNameCounts.get(def.name) || 0;
    assert.equal(count, 1,
      'area "' + def.name + '" has ' + count + ' matching challenges.csv row(s), expected exactly 1');
  });

  // The reverse direction: a CSV row that doesn't match any real area
  // is a silent typo (main.js only warns to the console for the
  // opposite case — an area with no row — so this is the other half)
  const areaNames = new Set(areaDefinitions.map(d => d.name));
  csvRows.forEach(r => {
    assert.ok(areaNames.has(r.name), 'challenges.csv row "' + r.name + '" matches no area in areas.js');
  });
});
