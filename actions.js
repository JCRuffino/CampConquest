// ── GAME ACTIONS ──────────────────────────────────────────────────
// The state changes a team can make, used by both the map popups and
// the Areas screen. Each runs inside a Firebase transaction with a
// snapshot check: `expected` is the {owner, locked} the UI was built
// from, so if another team acted first the action aborts instead of
// silently overwriting.

import { mutateState, pushLog } from './firebase.js';
import { gameState, teamName, gameOverGuard, largestCluster, instantWinner,
         playerNames } from './shared.js';

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
      failReason = 'Your team failed this challenge — you can\'t attempt this area again.';
      return;
    }
    if (a.attemptingBy && a.attemptingBy !== team) {
      failReason = 'Another team is attempting this challenge right now.';
      return;
    }
    wasSteal   = a.owner !== 0;
    prevOwner  = a.owner;
    prevResult = a.result || '';
    a.owner    = team;
    a.result   = result;
    a.locked   = wasSteal; // a stolen area locks permanently
    // failedBy is NOT cleared — failing an area bars that team from it
    // for the rest of the game
    a.era      = (a.era || 0) + 1; // stale attempts no longer count as in-progress
    delete a.attemptingBy;

    // Hitting the winning score (bonus points included) ends the game
    winInfo = instantWinner(gs);
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
    // The winner isn't necessarily the acting team — e.g. a steal can
    // shift the most-connected bonus to a third party and push THEM
    // over the line
    pushLog({
      timestamp: Date.now(),
      team: winInfo.team,
      type: 'timer',
      big:  true,
      message: '🏆 ' + teamName(gs, winInfo.team) + ' has reached ' + winInfo.score +
               ' points — THEY WIN THE GAME!',
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
// On an UNCLAIMED area: the team is barred from this area for the rest
// of the game.
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
      delete a.attemptingBy;
      lockedForOwner = a.owner;
      return gs;
    }
    if (!Array.isArray(a.failedBy)) a.failedBy = [];
    if (a.failedBy.includes(team)) {
      failReason = 'Already recorded as failed.';
      return;
    }
    a.failedBy.push(team);
    delete a.attemptingBy; // the challenge is free for other teams again
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
               ' — they can\'t attempt this area again',
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
  let holderIdx  = 0;

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
      failReason = 'Your team failed this challenge — you can\'t attempt this area again.';
      return;
    }
    // Only one team can be attempting an area's challenge at a time —
    // this also stops a claim landing under another team's feet and
    // silently turning their initial attempt into a steal
    if (a.attemptingBy && a.attemptingBy !== team) {
      failReason = a.owner !== 0
        ? 'Too late — another team is already contesting this area.'
        : 'Another team is attempting this challenge right now — wait for their result.';
      return;
    }
    a.attemptingBy = team;
    // Phone duty alternates with each challenge the team attempts: one
    // player holds the phone and reads the challenge aloud, the other
    // one does it
    if (!gs.attemptTurn) gs.attemptTurn = {};
    const turn = gs.attemptTurn[team] || 0;
    gs.attemptTurn[team] = turn + 1;
    holderIdx = turn % 2;

    if (!gs.attempts) gs.attempts = {};
    if (!gs.attempts[team]) gs.attempts[team] = {};
    gs.attempts[team][key] = { startedAt: Date.now(), era: a.era || 0, holder: holderIdx };
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

  const players = playerNames(gs, team);
  return {
    ok: true,
    holder:    players[holderIdx],
    attempter: players[1 - holderIdx],
  };
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
      a.era      = (a.era || 0) + 1;
    }
    // Admin apply always frees a stuck attempt (e.g. a team that
    // started and wandered off without resolving)
    delete a.attemptingBy;

    // Recompute the instant win, so a mistaken claim that "won" the
    // game can be undone (or a correction can trigger the win)
    const hadWinner = gs.winner ? gs.winner.team : null;
    const now       = instantWinner(gs);
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
        ? '🏆 After the admin correction, ' + teamName(gs, winnerChange.to) + ' has the winning score and WINS!'
        : '⚙️ Admin correction: the previous win no longer stands — the game is back on!',
    });
  }
  return { ok: true };
}
