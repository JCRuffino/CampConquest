// Unit tests for the pure game logic in shared.js.
// Run with: node --test tests/   (no dependencies, no browser)

import test from 'node:test';
import assert from 'node:assert/strict';

import { toKey, formatCountdown, normalizeGameCode, fixArrays,
         getScores, largestCluster, rankTeams, playerNames,
         instantWinner, winThreshold, isGameOver } from '../shared.js';
import { areaDefinitions, connections } from '../areas.js';

// ── helpers ───────────────────────────────────────────────────────
// A full game state where every real zone exists and `owners` maps
// zone name → team (everything else unclaimed)
function makeState(owners = {}, extra = {}) {
  const areas = {};
  areaDefinitions.forEach(def => {
    areas[toKey(def.name)] = {
      owner: owners[def.name] || 0,
      locked: false,
      result: '',
      failedBy: [],
      displayName: def.name,
    };
  });
  return { areas, attempts: { 1: {}, 2: {}, 3: {} }, ...extra };
}

test('all 21 zones and 35 connections are present', () => {
  assert.equal(areaDefinitions.length, 21);
  assert.equal(connections.length, 35);
  // every connection endpoint is a real zone
  const names = new Set(areaDefinitions.map(d => d.name));
  connections.flat().forEach(n => assert.ok(names.has(n), n + ' is not a zone'));
});

test('toKey strips Firebase-illegal characters', () => {
  assert.equal(toKey('A.B#C$D/E[F]'), 'A_B_C_D_E_F_');
  assert.equal(toKey('SD Glade'), 'SD Glade');
});

test('normalizeGameCode lowercases and strips', () => {
  assert.equal(normalizeGameCode(' Bushy-Wood_X7!K2m '), 'bushy-woodx7k2m');
  assert.equal(normalizeGameCode(null), '');
});

test('formatCountdown', () => {
  assert.equal(formatCountdown(0), '0:00');
  assert.equal(formatCountdown(61000), '1:01');
  assert.equal(formatCountdown(3661000), '1:01:01');
  assert.equal(formatCountdown(-5000), '0:00');
});

test('largestCluster counts connected groups, not totals', () => {
  // Oaks 1-4 form a chain; Meadow is far away and disconnected from them
  const gs = makeState({
    'Oaks 1': 1, 'Oaks 2': 1, 'Oaks 3': 1, 'Oaks 4': 1, 'Meadow': 1,
  });
  assert.equal(largestCluster(gs, 1), 4);
  assert.equal(largestCluster(gs, 2), 0);
});

test('group bonuses: owning all Birches = +1', () => {
  const gs = makeState({ 'Birches 1': 2, 'Birches 2': 2, 'Birches 3': 2 });
  const { counts, bonuses, score } = getScores(gs);
  assert.equal(counts[2], 3);
  assert.equal(bonuses[2].length, 2); // group bonus + most connected (unique)
  assert.ok(bonuses[2].some(b => b.includes('Birches')));
  assert.equal(score[2], 5);
});

test('group bonuses: a majority (not the full group) still earns it', () => {
  const gs = makeState({ 'Birches 1': 1, 'Birches 2': 1, 'Birches 3': 2 });
  const { bonuses } = getScores(gs);
  assert.ok(bonuses[1].some(b => b.includes('Birches')));
  assert.ok(!bonuses[2].some(b => b.includes('Birches')));
});

test('group bonuses: a tie within a group awards nobody', () => {
  const gs = makeState({ 'RPG Glade': 1, 'SD Glade': 2 });
  const { bonuses } = getScores(gs);
  assert.ok(!bonuses[1].some(b => b.includes('Glades')));
  assert.ok(!bonuses[2].some(b => b.includes('Glades')));
});

test('group bonuses: a single area beats rivals holding none', () => {
  const gs = makeState({ 'Oaks 2': 3 });
  const { bonuses, score } = getScores(gs);
  assert.ok(bonuses[3].some(b => b.includes('Oaks')));
  assert.equal(score[3], 3); // 1 area + Most Oaks + most connected
});

test('group bonuses: a fully unclaimed group awards nobody', () => {
  const gs = makeState({ 'Meadow': 1 });
  const { bonuses } = getScores(gs);
  assert.ok(!bonuses[1].some(b => b.includes('Oaks')));
  assert.ok(!bonuses[1].some(b => b.includes('Birches')));
});

test('most-connected bonus is withheld on a tie', () => {
  // Two teams with equally sized (2) connected clusters
  const gs = makeState({
    'Oaks 1': 1, 'Oaks 2': 1,
    'Willows 1': 2, 'Willows 5': 2,
  });
  const { bonuses } = getScores(gs);
  assert.ok(!bonuses[1].some(b => b.includes('Most connected')));
  assert.ok(!bonuses[2].some(b => b.includes('Most connected')));
});

test('winThreshold is 11 with 21 areas', () => {
  assert.equal(winThreshold(makeState()), 11);
});

test('instantWinner fires on points including bonuses', () => {
  // 9 areas + 3 group bonuses (most Oaks, Birches, Glades) + most
  // connected = 13 ≥ 11
  const owners = {
    'Oaks 1': 1, 'Oaks 2': 1, 'Oaks 3': 1, 'Oaks 4': 1,
    'Birches 1': 1, 'Birches 2': 1, 'Birches 3': 1,
    'RPG Glade': 1, 'SD Glade': 1,
  };
  const win = instantWinner(makeState(owners));
  assert.ok(win);
  assert.equal(win.team, 1);
  assert.ok(win.score >= 11);
});

test('instantWinner stays null below the post', () => {
  const gs = makeState({ 'Oaks 1': 1, 'Oaks 2': 1, 'Oaks 3': 1 });
  assert.equal(instantWinner(gs), null);
});

test('rankTeams breaks score ties by locked areas', () => {
  // Chapel and Meadow are in no bonus group, so both teams have 1 pt
  // (clusters tie at 1 → no bonus); team 2's area is locked
  const gs = makeState({ 'Chapel': 1, 'Meadow': 2 });
  gs.areas[toKey('Meadow')].locked = true;
  const order = rankTeams(gs);
  assert.equal(order[0], 2);
});

test('fixArrays restores containers Firebase strips', () => {
  const gs = { areas: { X: { owner: 1, failedBy: { 0: 2 } } } };
  fixArrays(gs);
  assert.deepEqual(gs.areas.X.failedBy, [2]);
  assert.deepEqual(gs.attempts[1], {});
  assert.deepEqual(gs.players[3], []);
});

test('playerNames: empty-roster fallback is sized to teamSize; partial rosters are left alone', () => {
  assert.deepEqual(playerNames({ players: { 1: [] }, teamSize: 2 }, 1), ['Player 1', 'Player 2']);
  assert.deepEqual(playerNames({ players: { 1: [] }, teamSize: 3 }, 1), ['Player 1', 'Player 2', 'Player 3']);
  assert.deepEqual(playerNames({ players: { 1: ['Alice'] }, teamSize: 3 }, 1), ['Alice']);
  assert.deepEqual(playerNames({}, 1), ['Player 1', 'Player 2']); // no players/teamSize at all
});

test('isGameOver: winner or expired timer', () => {
  assert.equal(isGameOver(makeState()), false);
  assert.equal(isGameOver(makeState({}, { winner: { team: 1 } })), true);
  assert.equal(isGameOver(makeState({}, { timer: { endsAt: Date.now() - 1000 } })), true);
  assert.equal(isGameOver(makeState({}, { timer: { endsAt: Date.now() + 60000 } })), false);
});
