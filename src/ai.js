import { COURT, TUNE, OFFENSE_SPOTS, CUT_SPOTS, isThreePoint } from './constants.js';
import { clamp, clamp01, lerp, rand, chance, dist2D } from './utils.js';

/**
 * Fills each AI player's intent (movement) and triggers actions through the
 * game API (aiShoot / aiFinish / tryPass / trySteal / startJump).
 */
export function updateAI(game, dt) {
  const ball = game.ball;
  const holder = ball.holder;

  for (const p of game.players) {
    if (p === game.controlled && game.userTeam === p.team) continue;  // user drives this one
    if (p.state !== 'normal' && p.state !== 'celebrate') { p.intent.x = 0; p.intent.z = 0; continue; }

    if (holder) {
      if (holder.team === p.team) {
        if (p === holder) handlerAI(game, p);
        else offBallAI(game, p);
      } else {
        defenseAI(game, p);
      }
    } else {
      looseBallAI(game, p);
    }
  }
}

// ---------------------------------------------------------------------------

function steerTo(p, x, z, sprint = false, arrive = 0.35) {
  const dx = x - p.pos.x, dz = z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < arrive) {
    p.intent.x = 0; p.intent.z = 0; p.intent.sprint = false;
    return true;
  }
  const slow = clamp01(d / 1.6);
  p.intent.x = (dx / d) * slow;
  p.intent.z = (dz / d) * slow;
  p.intent.sprint = sprint && d > 2.5;
  return false;
}

/** Distance from p to the nearest opponent (defenders in the air count as closer). */
export function contestDistance(game, p) {
  let best = 99;
  for (const o of game.players) {
    if (o.team === p.team) continue;
    let d = dist2D(o.pos.x, o.pos.z, p.pos.x, p.pos.z);
    if (o.jumpY > 0.05) d -= 0.5;
    if (d < best) best = d;
  }
  return best;
}

/** Rough make-probability estimate the AI uses to judge shots (mirrors game.shotProbability). */
export function shotQuality(game, p) {
  const hoop = game.attackedHoop(p.team);
  const d = dist2D(p.pos.x, p.pos.z, hoop.rimCenter.x, hoop.rimCenter.z);
  const open = contestDistance(game, p);
  return game.shotProbability(p, d, isThreePoint(p.pos, hoop.rimCenter.x), 1.0) * game.contestFactor(open);
}

function laneOpenness(game, p, rim) {
  // How clear is the straight line to the rim?
  const dx = rim.x - p.pos.x, dz = rim.z - p.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  let openness = 1;
  for (const o of game.players) {
    if (o.team === p.team) continue;
    const t = clamp(((o.pos.x - p.pos.x) * dx + (o.pos.z - p.pos.z) * dz) / (len * len), 0, 1);
    const cx = p.pos.x + dx * t, cz = p.pos.z + dz * t;
    const d = dist2D(o.pos.x, o.pos.z, cx, cz);
    if (d < 1.15) openness = Math.min(openness, d / 1.15);
  }
  return openness;
}

function bestPassOption(game, p) {
  let best = null;
  const hoop = game.attackedHoop(p.team);
  for (const mate of game.players) {
    if (mate.team !== p.team || mate === p || !mate.grounded) continue;
    const d = dist2D(p.pos.x, p.pos.z, mate.pos.x, mate.pos.z);
    if (d < 1.5 || d > 17) continue;
    const open = contestDistance(game, mate);
    const rimD = dist2D(mate.pos.x, mate.pos.z, hoop.rimCenter.x, hoop.rimCenter.z);
    // Openness + being in scoring position; slight penalty for long passes
    const score = open * 0.55 + clamp01((10 - rimD) / 10) * 0.75 - d * 0.02;
    if (!best || score > best.score) best = { mate, score, open };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ball-handler
// ---------------------------------------------------------------------------

function handlerAI(game, p) {
  const hoop = game.attackedHoop(p.team);
  const rim = hoop.rimCenter;
  const as = game.attackSign(p.team);
  const mem = p.aiMemory;
  const rimD = dist2D(p.pos.x, p.pos.z, rim.x, rim.z);
  const inFrontcourt = p.pos.x * as > 1.5;

  if (game.time >= mem.decideAt) {
    mem.decideAt = game.time + rand(0.28, 0.55);
    const open = contestDistance(game, p);
    const urgency = clamp01((9 - game.shotClock) / 9);

    // Finish at the rim
    if (rimD < 2.35 && inFrontcourt) {
      game.aiFinish(p);
      return;
    }
    if (inFrontcourt) {
      // Take a good shot (never settle for garbage unless the clock forces it)
      const q = shotQuality(game, p);
      const eagerness = q + urgency * 0.28 + rand(-0.06, 0.06);
      const behindArc = isThreePoint(p.pos, rim.x);
      const needOpen = behindArc ? 2.0 : 1.35;   // only fire threes with real space
      if (rimD < 8.8 && open > needOpen && eagerness > 0.52 && (q > 0.30 || urgency > 0.6)) {
        game.aiShoot(p);
        return;
      }
      // Move it to someone better — or just swing it to keep the offense honest
      const best = bestPassOption(game, p);
      const myScore = open * 0.55 + clamp01((10 - rimD) / 10) * 0.75;
      if (best && best.score > myScore + 0.08 && chance(0.55 + urgency * 0.3)) {
        game.tryPass(p, best.mate);
        return;
      }
      if (best && best.open > 1.5 && chance(0.28) && urgency < 0.5) {
        game.tryPass(p, best.mate);
        return;
      }
      // Drive or relocate
      const lane = laneOpenness(game, p, rim);
      if (lane > 0.55 && chance(0.35 + p.attrs.spd * 0.3 + urgency * 0.3)) {
        mem.plan = { type: 'drive' };
      } else {
        // Probe: drift to a gap on the perimeter
        const gapZ = clamp(p.pos.z + rand(-4, 4), -6.4, 6.4);
        const gapX = as * clamp(rand(4.4, 8.2), 0, COURT.HALF_LEN - 2);
        mem.plan = { type: 'move', x: gapX, z: gapZ };
      }
    } else {
      // Bring the ball up
      mem.plan = { type: 'move', x: as * 5.2, z: clamp(p.pos.z * 0.4, -3, 3) };
    }
  }

  const plan = mem.plan || { type: 'move', x: as * 5, z: 0 };
  if (plan.type === 'drive') {
    // Attack the rim, slightly curving away from the nearest defender
    let tx = rim.x - as * 0.7, tz = rim.z + (p.pos.z > 0 ? 0.4 : -0.4);
    steerTo(p, tx, tz, true, 0.2);
  } else {
    steerTo(p, plan.x, plan.z, !inFrontcourt, 0.4);
  }
}

// ---------------------------------------------------------------------------
// Off-ball offense
// ---------------------------------------------------------------------------

function offBallAI(game, p) {
  const as = game.attackSign(p.team);
  const mem = p.aiMemory;
  const spot = OFFENSE_SPOTS[p.role];
  let tx = as * spot.x, tz = spot.z;

  // Occasionally cut to an alternate spot or the rim
  if (game.time >= (mem.cutDecideAt || 0)) {
    mem.cutDecideAt = game.time + rand(1.6, 3.2);
    const guard = nearestOpponentDist(game, p);
    if (guard < 1.3 && chance(0.6)) {
      mem.cutUntil = game.time + rand(1.2, 2.0);
      const alt = CUT_SPOTS[p.role];
      mem.cutX = as * alt.x; mem.cutZ = alt.z * (chance(0.5) ? 1 : -1);
    } else if (chance(0.16)) {
      // Basket cut
      const rim = game.attackedHoop(p.team).rimCenter;
      mem.cutUntil = game.time + 1.1;
      mem.cutX = rim.x - as * 1.2; mem.cutZ = rim.z + rand(-1.2, 1.2);
    }
  }
  if (game.time < mem.cutUntil) {
    tx = mem.cutX; tz = mem.cutZ;
  }

  // Clear out if the handler is driving through my area
  const holder = game.ball.holder;
  if (holder && holder !== p && dist2D(holder.pos.x, holder.pos.z, tx, tz) < 2.4) {
    tz += (p.pos.z >= holder.pos.z ? 2.2 : -2.2);
  }

  steerTo(p, tx, tz, Math.abs(p.pos.x - tx) > 8, 0.5);
}

function nearestOpponentDist(game, p) {
  let best = 99;
  for (const o of game.players) {
    if (o.team === p.team) continue;
    const d = dist2D(o.pos.x, o.pos.z, p.pos.x, p.pos.z);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Defense
// ---------------------------------------------------------------------------

function defenseAI(game, p) {
  const holder = game.ball.holder;
  const myHoop = game.defendedHoop(p.team);
  const rim = myHoop.rimCenter;
  const man = game.matchupFor(p);
  const guardingBall = man === holder;

  p.defending = true;

  const target = { x: 0, z: 0 };
  if (guardingBall) {
    // Stay between the handler and the rim, gap by quickness
    const gap = lerp(1.7, 1.05, p.attrs.spd);
    const dx = rim.x - holder.pos.x, dz = rim.z - holder.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    target.x = holder.pos.x + (dx / d) * gap;
    target.z = holder.pos.z + (dz / d) * gap;
  } else if (man) {
    // Sag toward the rim + shade toward the ball
    const sag = clamp(dist2D(man.pos.x, man.pos.z, rim.x, rim.z) * 0.22, 1.0, 2.6);
    const dx = rim.x - man.pos.x, dz = rim.z - man.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    target.x = man.pos.x + (dx / d) * sag + (game.ball.pos.x - man.pos.x) * 0.12;
    target.z = man.pos.z + (dz / d) * sag + (game.ball.pos.z - man.pos.z) * 0.12;
  }

  steerTo(p, target.x, target.z, dist2D(p.pos.x, p.pos.z, target.x, target.z) > 4.5, 0.25);

  // Contest a shot in progress (after a beat of reaction time)
  if (guardingBall && (holder.state === 'windup' || holder.state === 'release') && holder.stateT > 0.15) {
    const d = dist2D(p.pos.x, p.pos.z, holder.pos.x, holder.pos.z);
    if (d < 1.8 && p.grounded && chance(0.30 + p.attrs.block * 0.30)) {
      p.startJump(1.0);
    }
  }

  // Poke at the ball (rare — a missed poke leaves the defender stumbling)
  if (guardingBall && p.stealCooldown <= 0 && holder.state === 'normal') {
    const d = dist2D(p.pos.x, p.pos.z, holder.pos.x, holder.pos.z);
    if (d < TUNE.STEAL_RANGE && chance(0.05 + p.attrs.steal * 0.08)) {
      game.trySteal(p);
    } else if (d < TUNE.STEAL_RANGE) {
      p.stealCooldown = 0.55;   // don't roll the dice every frame
    }
  }
}

// ---------------------------------------------------------------------------
// Loose ball / ball in flight
// ---------------------------------------------------------------------------

function looseBallAI(game, p) {
  const ball = game.ball;

  // Pass receiver runs to the catch point
  if (ball.state === 'pass' && ball.pass && ball.pass.receiver === p) {
    steerTo(p, ball.pass.targetX, ball.pass.targetZ, true, 0.15);
    return;
  }

  // Shot in the air: crash the boards if I'm one of the designated chasers
  const landing = game.looseLanding;
  if (landing) {
    const myRank = game.reboundRank(p);
    if (myRank < 2 || dist2D(p.pos.x, p.pos.z, landing.x, landing.z) < 3.2) {
      steerTo(p, landing.x, landing.z, true, 0.25);
      // Leap for it when it's overhead
      const bd = dist2D(ball.pos.x, ball.pos.z, p.pos.x, p.pos.z);
      if (ball.state === 'loose' && bd < 1.1 && ball.pos.y > 1.9 && ball.pos.y < 2.9 && ball.vel.y < 0.5) {
        if (p.grounded && chance(0.3 + p.attrs.reb * 0.5)) p.startJump(1.0);
      }
      return;
    }
  }

  // Everyone else balances the floor while the ball is live
  const as = game.attackSign(p.team);
  const spot = OFFENSE_SPOTS[p.role];
  const dropX = -as * Math.abs(spot.x) * 0.55;
  steerTo(p, dropX, spot.z * 0.7, false, 0.6);
}
