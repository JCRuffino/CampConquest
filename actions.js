// ── GAME ACTIONS ──────────────────────────────────────────────────
// The state changes a team can make, used by both the map popups and
// the Areas screen. Each runs inside a Firebase transaction with a
// snapshot check: `expected` is the {owner, locked} the UI was built
// from, so if another team acted first the action aborts instead of
// silently overwriting.

import { mutateState, pushLog } from './firebase.js';
import { gameState, teamName, gameOverGuard, largestCluster, majorityWinner } from './shared.js';

// Complete the challenge → claim an unclaimed area, recording the result
// other teams will have to beat. Stealing (owner !== 0) locks the area.
export async function claimArea(key, team, expected, result) {
  if (gameOverGuard(gameState.data)) return { ok: false };

  let failReason = '';
  let wasSteal   = false;
  let prevOwner  = 0;
  let prevResult = '';
  let winInfo    = null;

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
    delete a.contestedBy;

    // Controlling more than half the areas wins immediately
    winInfo = majorityWinner(gs);
    if (winInfo) gs.winner = { team: winInfo.team, at: Date.now() };
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
  if (winInfo) {
    pushLog({
      timestamp: Date.now(),
      team,
      type: 'timer',
      big:  true,
      message: '🏆 ' + teamName(gs, team) + ' controls ' + winInfo.count + ' of ' +
               winInfo.total + ' areas — a MAJORITY. THEY WIN THE GAME!',
    });
    return { ok: true };
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

// Record a failed challenge attempt.
// On an UNCLAIMED area: the team is locked out until another team
// passes the challenge (claim/steal clears failedBy).
// On a CLAIMED area (a steal attempt): the duel is over — the area
// LOCKS for the original owner.
export async function failChallenge(key, team, expected) {
  if (gameOverGuard(gameState.data)) return { ok: false };

  let failReason = '';
  let lockedForOwner = 0;

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
    if (a.owner !== 0) {
      // failed steal → the owner keeps the area permanently
      a.locked = true;
      delete a.contestedBy;
      lockedForOwner = a.owner;
      return gs;
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
  if (lockedForOwner) {
    pushLog({
      timestamp: Date.now(),
      team,
      type: 'attempt',
      big:  true,
      message: '🛡️ ' + teamName(gs, team) + ' failed to steal ' + name + ' — it is now LOCKED for ' +
               teamName(gs, lockedForOwner) + '!',
    });
  } else {
    pushLog({
      timestamp: Date.now(),
      team,
      type: 'attempt',
      message: '❌ ' + teamName(gs, team) + ' failed the challenge at ' + name +
               ' — locked out until another team passes it',
    });
  }
  return { ok: true };
}

// Start a challenge attempt: reveals the challenge text to the team
// (permanently) and starts any timer. Starting commits the team to
// recording a pass or a fail.
export async function startAttempt(key, team, expected) {
  if (gameOverGuard(gameState.data)) return { ok: false };

  let failReason = '';

  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    if (a.owner !== expected.owner || !!a.locked !== !!expected.locked) {
      failReason = 'This area just changed — reopen it to see the latest state.';
      return;
    }
    if (a.locked) {
      failReason = 'This area is locked.';
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
    // A claimed area can only be contested by ONE rival team: the first
    // to start a steal attempt shuts the third team out, and the duel
    // ends with the area locked either way
    if (a.owner !== 0) {
      if (a.contestedBy && a.contestedBy !== team) {
        failReason = 'Too late — another team is already contesting this area.';
        return;
      }
      a.contestedBy = team;
    }
    if (!gs.attempts) gs.attempts = {};
    if (!gs.attempts[team]) gs.attempts[team] = {};
    gs.attempts[team][key] = { startedAt: Date.now() };
    return gs;
  });

  if (!committed) return { ok: false, reason: failReason || 'Could not start — please try again.' };

  const gs = gameState.data;
  const a  = gs.areas[key] || {};
  const name = a.displayName || key;
  const isContest = expected.owner !== 0;
  pushLog({
    timestamp: Date.now(),
    team,
    type: 'attempt',
    big:  isContest,
    message: isContest
      ? '⚔️ ' + teamName(gs, team) + ' is trying to STEAL ' + name + ' from ' +
        teamName(gs, expected.owner) + ' — win or lose, it locks!'
      : '▶️ ' + teamName(gs, team) + ' started the challenge at ' + name,
  });
  return { ok: true };
}

// Admin: set an area to any state — ownership, lock, the current result
// to beat, and a pass-mark override (replaces the challenges.csv value)
export async function adminSetArea(key, fields) {
  let winnerChange = null;

  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a) return;
    const clearFails = a.owner !== fields.owner; // ownership change reopens the area
    a.owner    = fields.owner;
    a.locked   = fields.owner === 0 ? false : !!fields.locked;
    a.result   = fields.owner === 0 ? '' : (fields.result || '');
    a.passMark = fields.passMark || '';
    if (clearFails) {
      a.failedBy = [];
      delete a.contestedBy;
    }

    // Recompute the majority win, so a mistaken claim that "won" the
    // game can be undone (or a correction can trigger the win)
    const hadWinner = gs.winner ? gs.winner.team : null;
    const now       = majorityWinner(gs);
    if (now) gs.winner = { team: now.team, at: (gs.winner && gs.winner.at) || Date.now() };
    else if (gs.winner) delete gs.winner;
    const hasWinner = now ? now.team : null;
    if (hadWinner !== hasWinner) winnerChange = { to: hasWinner };
    return gs;
  });

  if (!committed) return { ok: false };

  const gs = gameState.data;
  const name = (gs.areas[key] && gs.areas[key].displayName) || key;
  pushLog({
    timestamp: Date.now(),
    team: 0,
    type: 'claim',
    message: '⚙️ Admin set ' + name + ' → ' + teamName(gs, fields.owner) +
             (fields.owner !== 0 && fields.locked ? ' (locked)' : ''),
  });
  if (winnerChange) {
    pushLog({
      timestamp: Date.now(),
      team: 0,
      type: 'timer',
      big:  true,
      message: winnerChange.to
        ? '🏆 After the admin correction, ' + teamName(gs, winnerChange.to) + ' holds a majority and WINS!'
        : '⚙️ Admin correction: the previous win no longer stands — the game is back on!',
    });
  }
  return { ok: true };
}
