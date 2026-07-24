// ── GAME ACTIONS ──────────────────────────────────────────────────
// The state changes a team can make, used by both the map popups and
// the Areas screen. Each runs inside a Firebase transaction with a
// snapshot check: `expected` is the {owner, locked} the UI was built
// from, so if another team acted first the action aborts instead of
// silently overwriting.

import { mutateState, pushLog, getUid } from './firebase.js';
import { gameState, teamName, gameOverGuard, largestCluster, instantWinner,
         playerNames, isAdminMode } from './shared.js';

// Complete the challenge → claim an unclaimed area, recording the result
// other teams will have to beat. Stealing (owner !== 0) locks the area.
export async function claimArea(key, team, expected, result) {
  if (gameOverGuard(gameState.data)) return { ok: false, reason: null };

  let failReason = '';
  let wasSteal   = false;
  let prevOwner  = 0;
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
  // Results are deliberately NOT logged — a team should only learn the
  // score to beat from the area popup, after starting the challenge
  if (wasSteal) {
    pushLog({
      timestamp: Date.now(),
      team,
      type: 'steal',
      big:  true,
      message: '😈 ' + teamName(gs, team) + ' stole ' + name + ' from ' + teamName(gs, prevOwner) +
               ' — it is now locked! 🔒',
    });
  } else {
    pushLog({
      timestamp: Date.now(),
      team,
      type: 'claim',
      big:  true,
      message: '⛺ ' + teamName(gs, team) + ' claimed ' + name,
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
  if (gameOverGuard(gameState.data)) return { ok: false, reason: null };

  let failReason = '';
  let lockedForOwner = 0;

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
  if (gameOverGuard(gameState.data)) return { ok: false, reason: null };

  let failReason = '';

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
    if (!gs.attempts) gs.attempts = {};
    if (!gs.attempts[team]) gs.attempts[team] = {};
    gs.attempts[team][key] = { startedAt: Date.now(), era: a.era || 0 };
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

// ── TEAM CLAIMING ─────────────────────────────────────────────────
// The admin sets teams up (Settings → Game Setup); each player phone
// then claims one team. A claim ties the team to this device's auth
// uid, so later phones are only offered the teams still free.
export async function claimTeam(team) {
  const uid = await getUid();
  let failReason = '';

  const committed = await mutateState(gs => {
    if (!gs.teamClaims) gs.teamClaims = {};
    const current = gs.teamClaims[team];
    if (current && current !== uid) {
      failReason = 'That team was just taken by another phone.';
      return;
    }
    gs.teamClaims[team] = uid;
    return gs;
  });

  if (!committed) return { ok: false, reason: failReason || 'Could not join — please try again.' };

  const gs = gameState.data;
  pushLog({
    timestamp: Date.now(),
    team,
    type: 'timer',
    message: '📱 A phone connected as ' + teamName(gs, team) +
      ' (' + playerNames(gs, team).join(' & ') + ')',
  });
  return { ok: true };
}

// A phone can release its own team; an admin can release any team's
// (e.g. a dead phone). RTDB deletes keys set to null.
export async function releaseTeam(team) {
  const uid = await getUid();

  // Nothing to do if the state hasn't loaded, or the team was never
  // claimed (or was already released) — the desired end state already
  // holds, so that's a success, not a failure with an empty reason
  if (!gameState.data) return { ok: false, reason: 'Not connected — try again.' };
  if (!gameState.data.teamClaims || !gameState.data.teamClaims[team]) return { ok: true };

  let failReason = '';
  const committed = await mutateState(gs => {
    // Already gone by the time the transaction runs (e.g. raced by
    // another release) — commit the no-op so this still reports ok:true
    if (!gs.teamClaims || !gs.teamClaims[team]) return gs;
    if (gs.teamClaims[team] !== uid && !isAdminMode()) {
      failReason = 'Another phone holds this team.';
      return;
    }
    gs.teamClaims[team] = null;
    return gs;
  });

  if (committed) return { ok: true };
  return { ok: false, reason: failReason || 'Could not release — please try again.' };
}

// Admin: free an abandoned attempt — the area reopens to everyone
// eligible; the attempting team's record is invalidated via the era
// bump (they keep having seen the challenge text)
export async function adminClearAttempt(key) {
  let clearedTeam = 0;

  const committed = await mutateState(gs => {
    const a = gs.areas && gs.areas[key];
    if (!a || !a.attemptingBy) return;
    clearedTeam = a.attemptingBy;
    delete a.attemptingBy;
    a.era = (a.era || 0) + 1;
    return gs;
  });

  if (!committed) return { ok: false, reason: 'No attempt to clear — reopen the area.' };

  const gs = gameState.data;
  const name = (gs.areas[key] && gs.areas[key].displayName) || key;
  pushLog({
    timestamp: Date.now(),
    team: 0,
    type: 'attempt',
    message: '⚙️ Admin cleared ' + teamName(gs, clearedTeam) + '\'s stuck attempt at ' + name +
             ' — the area is open again',
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

  if (!committed) return { ok: false, reason: 'Could not update — please try again.' };

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
