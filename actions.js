// ── GAME ACTIONS ──────────────────────────────────────────────────
// The state changes a team can make, used by both the map popups and
// the Areas screen. Each runs inside a Firebase transaction with a
// snapshot check: `expected` is the {owner, locked} the UI was built
// from, so if another team acted first the action aborts instead of
// silently overwriting.

import { mutateState, pushLog } from './firebase.js';
import { gameState, teamName, gameOverGuard, largestCluster } from './shared.js';

// Complete the challenge → claim an unclaimed area, recording the result
// other teams will have to beat. Stealing (owner !== 0) locks the area.
export async function claimArea(key, team, expected, result) {
  if (gameOverGuard(gameState.data)) return { ok: false };

  let failReason = '';
  let wasSteal   = false;
  let prevOwner  = 0;
  let prevResult = '';

  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    if (a.owner !== expected.owner || !!a.locked !== !!expected.locked) {
      failReason = 'This area just changed — reopen it to see the latest state.';
      return;
    }
    if (a.locked) {
      failReason = 'This area is locked and cannot be taken.';
      return;
    }
    if (a.owner === team) {
      failReason = 'Your team already controls this area.';
      return;
    }
    if ((a.failedBy || []).includes(team)) {
      failReason = 'Your team failed this challenge — you can\'t attempt it again until another team passes it.';
      return;
    }
    wasSteal   = a.owner !== 0;
    prevOwner  = a.owner;
    prevResult = a.result || '';
    a.owner    = team;
    a.result   = result;
    a.locked   = wasSteal; // a stolen area locks permanently
    a.failedBy = [];       // a pass clears everyone's lockouts
    return gs;
  });

  if (!committed) return { ok: false, reason: failReason || 'Could not claim — please try again.' };

  const gs = gameState.data;
  const name = (gs.areas[key] && gs.areas[key].displayName) || key;
  if (wasSteal) {
    pushLog({
      timestamp: Date.now(),
      team,
      type: 'steal',
      big:  true,
      message: '😈 ' + teamName(gs, team) + ' stole ' + name + ' from ' + teamName(gs, prevOwner) +
               ' — beat "' + prevResult + '" with "' + result + '". It is now locked! 🔒',
    });
  } else {
    pushLog({
      timestamp: Date.now(),
      team,
      type: 'claim',
      big:  true,
      message: '⛺ ' + teamName(gs, team) + ' claimed ' + name + ' with a result of "' + result + '"',
    });
  }
  // A claim/steal that grows a team's biggest connected group is worth
  // shouting about
  const cluster = largestCluster(gs, team);
  if (cluster >= 3) {
    pushLog({
      timestamp: Date.now(),
      team,
      type: 'claim',
      big:  true,
      message: '🔗 ' + teamName(gs, team) + '\'s largest connected group is now ' +
               cluster + ' zones!',
    });
  }
  return { ok: true };
}

// Record a failed challenge attempt: the team is locked out of this
// area's challenge until another team passes it (claim or steal, which
// clears failedBy)
export async function failChallenge(key, team, expected) {
  if (gameOverGuard(gameState.data)) return { ok: false };

  let failReason = '';

  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    if (a.owner !== expected.owner || !!a.locked !== !!expected.locked) {
      failReason = 'This area just changed — reopen it to see the latest state.';
      return;
    }
    if (a.locked || a.owner === team) {
      failReason = 'Nothing to fail here.';
      return;
    }
    if (!Array.isArray(a.failedBy)) a.failedBy = [];
    if (a.failedBy.includes(team)) {
      failReason = 'Already recorded as failed.';
      return;
    }
    a.failedBy.push(team);
    return gs;
  });

  if (!committed) return { ok: false, reason: failReason || 'Could not record — please try again.' };

  const gs = gameState.data;
  const name = (gs.areas[key] && gs.areas[key].displayName) || key;
  pushLog({
    timestamp: Date.now(),
    team,
    type: 'claim',
    message: '❌ ' + teamName(gs, team) + ' failed the challenge at ' + name +
             ' — locked out until another team passes it',
  });
  return { ok: true };
}

// Mark an area as visited by a team, revealing its challenge to them.
// Fired automatically when a player's GPS enters the area, or manually
// (honour system) from the popup.
export async function scoutArea(key, team, auto) {
  const committed = await mutateState(gs => {
    if (!gs.visited) gs.visited = {};
    if (!gs.visited[team]) gs.visited[team] = {};
    if (gs.visited[team][key]) return; // already scouted
    gs.visited[team][key] = true;
    return gs;
  });

  if (!committed) return { ok: false };

  const gs = gameState.data;
  const name = (gs.areas[key] && gs.areas[key].displayName) || key;
  pushLog({
    timestamp: Date.now(),
    team,
    type: 'scout',
    message: '🔍 ' + teamName(gs, team) + ' scouted ' + name +
             (auto ? '' : ' (manual reveal)'),
  });
  return { ok: true };
}

// Admin: set an area to any state
export async function adminResetArea(key, owner, locked) {
  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    a.owner    = owner;
    a.locked   = owner === 0 ? false : !!locked;
    a.failedBy = [];
    if (owner === 0) a.result = '';
    return gs;
  });

  if (!committed) return { ok: false };

  const gs = gameState.data;
  const name = (gs.areas[key] && gs.areas[key].displayName) || key;
  pushLog({
    timestamp: Date.now(),
    team: 0,
    type: 'claim',
    message: '⚙️ Admin reset ' + name + ' → ' + teamName(gs, owner) +
             (owner !== 0 && locked ? ' (locked)' : ''),
  });
  return { ok: true };
}
