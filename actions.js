// ── GAME ACTIONS ──────────────────────────────────────────────────
// The state changes a team can make, used by both the map popups and
// the Areas screen. Each runs inside a Firebase transaction with a
// snapshot check: `expected` is the {owner, locked} the UI was built
// from, so if another team acted first the action aborts instead of
// silently overwriting.

import { mutateState, pushLog } from './firebase.js';
import { gameState, teamName, gameOverGuard, findWinningLine, findAnyWinner,
         WIN_LENGTH } from './shared.js';

// Complete the challenge → claim an unclaimed area, recording the result
// other teams will have to beat. Stealing (owner !== 0) locks the area.
export async function claimArea(key, team, expected, result) {
  if (gameOverGuard(gameState.data)) return { ok: false };

  let failReason = '';
  let wasSteal   = false;
  let prevOwner  = 0;
  let prevResult = '';
  let winningLine = null;

  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    if (gs.winner) {
      failReason = 'The game is already won!';
      return;
    }
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
    wasSteal   = a.owner !== 0;
    prevOwner  = a.owner;
    prevResult = a.result || '';
    a.owner    = team;
    a.result   = result;
    a.locked   = wasSteal; // a stolen area locks permanently

    winningLine = findWinningLine(gs, team);
    if (winningLine) gs.winner = { team, line: winningLine, at: Date.now() };
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
  if (winningLine) {
    pushLog({
      timestamp: Date.now(),
      team,
      type: 'timer',
      big:  true,
      message: '🏆 ' + teamName(gs, team) + ' got ' + WIN_LENGTH + ' areas in a row — ' +
               'THEY WIN THE GAME!',
    });
  }
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

// Admin: set an area to any state (also recomputes the winner, so a
// mistaken claim that "won" the game can be undone)
export async function adminResetArea(key, owner, locked) {
  let winnerChange = null;

  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    a.owner  = owner;
    a.locked = owner === 0 ? false : !!locked;
    if (owner === 0) a.result = '';

    const hadWinner = gs.winner ? gs.winner.team : null;
    const now       = findAnyWinner(gs);
    if (now) gs.winner = { team: now.team, line: now.line, at: (gs.winner && gs.winner.at) || Date.now() };
    else if (gs.winner) delete gs.winner;
    const hasWinner = now ? now.team : null;
    if (hadWinner !== hasWinner) winnerChange = { from: hadWinner, to: hasWinner };
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
  if (winnerChange) {
    pushLog({
      timestamp: Date.now(),
      team: 0,
      type: 'timer',
      big:  true,
      message: winnerChange.to
        ? '🏆 After the admin correction, ' + teamName(gs, winnerChange.to) + ' has ' + WIN_LENGTH + ' in a row and WINS!'
        : '⚙️ Admin correction: the previous win no longer stands — the game is back on!',
    });
  }
  return { ok: true };
}
