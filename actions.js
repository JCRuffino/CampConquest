// ── GAME ACTIONS ──────────────────────────────────────────────────
// The three state changes a team can make to an area, used by both the
// map popups and the Areas screen. Each runs inside a Firebase
// transaction with a snapshot check: `expected` is the {owner, locked}
// the UI was built from, so if another team acted first the action
// aborts instead of silently overwriting.

import { mutateState, pushLog } from './firebase.js';
import { gameState, teamName, gameOverGuard } from './shared.js';

// Complete the initial challenge → claim (or steal) the area
export async function claimArea(key, team, expected) {
  if (gameOverGuard(gameState.data)) return { ok: false };

  let failReason = '';
  let wasSteal   = false;
  let prevOwner  = 0;

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
    wasSteal  = a.owner !== 0;
    prevOwner = a.owner;
    a.owner   = team;
    return gs;
  });

  if (!committed) return { ok: false, reason: failReason || 'Could not claim — please try again.' };

  const gs = gameState.data;
  const name = (gs.areas[key] && gs.areas[key].displayName) || key;
  pushLog({
    timestamp: Date.now(),
    team,
    type: 'area',
    big:  true,
    message: wasSteal
      ? '😈 ' + teamName(gs, team) + ' stole ' + name + ' from ' + teamName(gs, prevOwner) + '!'
      : '⛺ ' + teamName(gs, team) + ' claimed ' + name,
  });
  return { ok: true };
}

// Complete the control challenge → lock the area permanently
export async function lockArea(key, team, expected) {
  if (gameOverGuard(gameState.data)) return { ok: false };

  let failReason = '';

  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    if (a.owner !== expected.owner || !!a.locked !== !!expected.locked) {
      failReason = 'This area just changed — reopen it to see the latest state.';
      return;
    }
    if (a.owner !== team) {
      failReason = 'Your team no longer controls this area.';
      return;
    }
    if (a.locked) {
      failReason = 'This area is already locked.';
      return;
    }
    if ((a.failedControl || []).includes(team)) {
      failReason = 'Your team already failed this control challenge.';
      return;
    }
    a.locked = true;
    return gs;
  });

  if (!committed) return { ok: false, reason: failReason || 'Could not lock — please try again.' };

  const gs = gameState.data;
  const name = (gs.areas[key] && gs.areas[key].displayName) || key;
  pushLog({
    timestamp: Date.now(),
    team,
    type: 'lock',
    big:  true,
    message: '🔒 ' + teamName(gs, team) + ' locked ' + name + ' — it can no longer be stolen!',
  });
  return { ok: true };
}

// Fail the control challenge — recorded so the team can never attempt
// this area's control challenge again; the area stays claimed but stealable
export async function failControl(key, team, expected) {
  if (gameOverGuard(gameState.data)) return { ok: false };

  let failReason = '';

  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    if (a.owner !== expected.owner || !!a.locked !== !!expected.locked) {
      failReason = 'This area just changed — reopen it to see the latest state.';
      return;
    }
    if (a.owner !== team || a.locked) {
      failReason = 'This area can no longer be failed.';
      return;
    }
    if (!Array.isArray(a.failedControl)) a.failedControl = [];
    if (a.failedControl.includes(team)) {
      failReason = 'Already recorded as failed.';
      return;
    }
    a.failedControl.push(team);
    return gs;
  });

  if (!committed) return { ok: false, reason: failReason || 'Could not record — please try again.' };

  const gs = gameState.data;
  const name = (gs.areas[key] && gs.areas[key].displayName) || key;
  pushLog({
    timestamp: Date.now(),
    team,
    type: 'lock',
    message: '❌ ' + teamName(gs, team) + ' failed the control challenge at ' + name + ' — it stays claimed but can be stolen',
  });
  return { ok: true };
}

// Admin: set an area to any state
export async function adminResetArea(key, owner, locked) {
  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    a.owner         = owner;
    a.locked        = owner === 0 ? false : !!locked;
    a.failedControl = [];
    return gs;
  });

  if (!committed) return { ok: false };

  const gs = gameState.data;
  const name = (gs.areas[key] && gs.areas[key].displayName) || key;
  pushLog({
    timestamp: Date.now(),
    team: 0,
    type: 'area',
    message: '⚙️ Admin reset ' + name + ' → ' + teamName(gs, owner) +
             (owner !== 0 && locked ? ' (locked)' : ''),
  });
  return { ok: true };
}
