import * as THREE from '../vendor/three.module.js';
import { COURT, TUNE, TEAMS, OFFENSE_SPOTS, isThreePoint } from './constants.js';
import { clamp, clamp01, lerp, rand, randn, chance, dist2D } from './utils.js';
import { Player, separatePlayers } from './player.js';
import { updateAI } from './ai.js';

export class Game {
  constructor({ scene, arena, ball, audio, hud, matCache }) {
    this.scene = scene;
    this.arena = arena;
    this.ball = ball;
    this.audio = audio;
    this.hud = hud;
    this.matCache = matCache;

    this.players = [];
    this.teamData = [TEAMS[0], TEAMS[1]];
    this.userTeam = -1;               // -1 = demo (AI vs AI)
    this.score = [0, 0];
    this.state = 'idle';              // intro | play | celebrate | dead | break | end
    this.stateT = 0;
    this.period = 1;
    this.quarterSeconds = TUNE.QUARTER_MINUTES * 60;
    this.gameClock = this.quarterSeconds;
    this.shotClock = TUNE.SHOT_CLOCK;
    this.possession = 0;
    this.time = 0;
    this.paused = false;
    this.controlled = null;
    this.buzzerFired = false;
    this.pendingInboundTeam = 0;
    this.firstPossession = 0;
    this.looseLanding = null;
    this._landingAt = -1;
    this._rebRanks = new Map();
    this.reboundLive = false;
    this._prevBallState = 'held';
    this._manualControlUntil = 0;
    this._afterCelebrate = 'inbound'; // or 'break'
    this.lastEvent = '';

    // Selection ring + loose-ball marker
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    scene.add(this.ring);
    this.landingMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.26, 20),
      new THREE.MeshBasicMaterial({ color: 0xffb225, transparent: true, opacity: 0.65, depthWrite: false })
    );
    this.landingMarker.rotation.x = -Math.PI / 2;
    this.landingMarker.position.y = 0.021;
    this.landingMarker.visible = false;
    scene.add(this.landingMarker);

    ball.events = {
      onScore: (hoopIndex, shot) => this.onBasket(hoopIndex, shot),
      onRimHit: (i, v) => { this.audio.rim(v); this.audio.excite(0.06); },
      onBoardHit: () => this.audio.board(),
      onBounce: (v) => this.audio.bounce(v),
    };
    ball.hoops = arena.hoops;
  }

  // ------------------------------------------------------------------
  // Match setup
  // ------------------------------------------------------------------

  setupMatch({ teamA = 0, teamB = 1, userTeam = 0, quarterMinutes = TUNE.QUARTER_MINUTES } = {}) {
    for (const p of this.players) this.scene.remove(p.rig.group);
    this.players = [];
    this.teamData = [TEAMS[teamA], TEAMS[teamB]];
    this.userTeam = userTeam;
    this.score = [0, 0];
    this.period = 1;
    this.quarterSeconds = quarterMinutes * 60;
    this.gameClock = this.quarterSeconds;
    this.shotClock = TUNE.SHOT_CLOCK;
    this.time = 0;
    this.paused = false;
    this.buzzerFired = false;
    this.reboundLive = false;
    this.looseLanding = null;
    this.lastEvent = '';

    for (let t = 0; t < 2; t++) {
      const td = this.teamData[t];
      for (let r = 0; r < 5; r++) {
        const p = new Player({
          team: t, index: t * 5 + r, role: r, spec: td.roster[r],
          teamData: td, home: t === 0, matCache: this.matCache, scene: this.scene,
        });
        this.players.push(p);
      }
    }
    this.ring.material.color.setHex(userTeam >= 0 ? this.teamData[userTeam].secondary : 0xffffff);

    this.firstPossession = Math.floor(rand(0, 2));
    this.startPeriod(true);
  }

  startPeriod(first = false) {
    if (!first) this.period++;
    const secs = this.period > 4 ? TUNE.OVERTIME_MINUTES * 60 : this.quarterSeconds;
    this.gameClock = secs;
    this.shotClock = TUNE.SHOT_CLOCK;
    this.buzzerFired = false;
    const poss = (this.firstPossession + this.period + 1) % 2;
    this.formationReset(poss);
    this.state = 'intro';
    this.stateT = 0;
    const label = this.periodLabel();
    this.hud.showOverlay(label, `${this.teamData[poss].city.toUpperCase()} BALL`, 1.9);
  }

  periodLabel() {
    return this.period > 4 ? `OT${this.period - 4}` : `QUARTER ${this.period}`;
  }

  formationReset(possTeam) {
    const as = this.attackSign(possTeam);
    const off = this.players.filter((p) => p.team === possTeam);
    const def = this.players.filter((p) => p.team !== possTeam);
    const spots = [
      [-9.0, 0], [-6.0, -4.2], [-6.0, 4.2], [-2.2, -2.6], [-2.2, 2.6],
    ];
    for (let i = 0; i < 5; i++) {
      const [sx, sz] = spots[off[i].role];
      off[i].teleport(as * sx, sz, Math.atan2(as, 0));
    }
    for (const d of def) {
      const man = off.find((o) => o.role === d.role);
      d.teleport(man.pos.x + as * 2.4, man.pos.z * 0.85, Math.atan2(man.pos.x - (man.pos.x + as * 2.4), man.pos.z * 0.15) || 0);
    }
    this.possession = possTeam;
    const pg = off[0].role === 0 ? off[0] : off.find((p) => p.role === 0);
    this.giveBall(pg, { silent: true });
    this.refreshControl(true);
  }

  // ------------------------------------------------------------------
  // Geometry helpers
  // ------------------------------------------------------------------

  attackSign(team) { return team === 0 ? 1 : -1; }
  attackedHoop(team) { return this.arena.hoops[team === 0 ? 1 : 0]; }
  defendedHoop(team) { return this.arena.hoops[team === 0 ? 0 : 1]; }
  hoopTeam(hoopIndex) { return hoopIndex === 1 ? 0 : 1; }  // team scoring into that hoop
  matchupFor(p) {
    for (const o of this.players) {
      if (o.team !== p.team && o.role === p.role) return o;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Shot math
  // ------------------------------------------------------------------

  shotProbability(p, dist, is3, timingFactor) {
    let base;
    if (dist < 1.6) base = 0.92;
    else if (dist < 3.0) base = 0.80 - (dist - 1.6) * 0.05;
    else if (dist < 6.75) base = 0.64 - (dist - 3) * 0.028;
    else if (dist < 9.0) base = 0.51 - (dist - 6.75) * 0.055;
    else base = Math.max(0.04, 0.38 - (dist - 9) * 0.06);
    const attr = dist < 3.0 ? p.attrs.close : (is3 || dist > 6.5 ? p.attrs.three : p.attrs.mid);
    base *= lerp(0.72, 1.18, attr);
    base *= timingFactor;
    return clamp(base, 0.02, 0.97);
  }

  contestFactor(openDist) {
    return clamp((openDist - 0.40) / 1.75, 0.20, 1.0);
  }

  contestDistanceFor(p) {
    let best = 99;
    for (const o of this.players) {
      if (o.team === p.team) continue;
      let d = dist2D(o.pos.x, o.pos.z, p.pos.x, p.pos.z);
      if (o.jumpY > 0.05) d -= 0.5;
      if (d < best) best = d;
    }
    return best;
  }

  // ------------------------------------------------------------------
  // Actions: shooting
  // ------------------------------------------------------------------

  /** Space pressed by user (or AI finishing decision) with the ball. */
  startShot(p) {
    if (!p.hasBall || p.state !== 'normal' || !p.grounded) return;
    const rim = this.attackedHoop(p.team).rimCenter;
    const rimD = dist2D(p.pos.x, p.pos.z, rim.x, rim.z);
    const inFrontcourt = p.pos.x * this.attackSign(p.team) > 0;
    if (rimD < 2.45 && inFrontcourt) {
      this.startFinish(p);
    } else {
      p.setState('windup');
      p.aiShot = null;
    }
  }

  aiShoot(p) {
    if (!p.hasBall || p.state !== 'normal') return;
    const attr = Math.max(p.attrs.three, p.attrs.mid);
    const q = clamp(0.62 + randn() * 0.24 + attr * 0.3, 0.3, 1.15);
    p.aiShot = { timing: q };
    p.setState('windup');
  }

  aiFinish(p) { this.startFinish(p); }

  startFinish(p) {
    const hoop = this.attackedHoop(p.team);
    const rim = hoop.rimCenter;
    const as = this.attackSign(p.team);
    const open = this.contestDistanceFor(p);
    const rimD = dist2D(p.pos.x, p.pos.z, rim.x, rim.z);
    const canDunk = p.attrs.dunk > 0.58 && open > 0.85 && (p.speed2D > 3.2 || rimD < 1.6);
    if (canDunk) {
      const to = new THREE.Vector3(rim.x - as * 0.40, 0, rim.z + rand(-0.15, 0.15));
      p.startAir('dunk', to, 0.72, 0.85);
      p.pendingShot = { type: 'dunk' };
    } else {
      const to = new THREE.Vector3(rim.x - as * 0.8, 0, rim.z + rand(-0.6, 0.6));
      const dur = clamp(rimD / 3.8, 0.55, 0.85);
      p.startAir('layup', to, dur, 0.6);
      p.pendingShot = { type: 'layup', timing: 1.0 };
    }
    this.audio.excite(0.05);
  }

  meterTiming(charge) {
    if (charge < 0.35) return { factor: 0.25, grade: 'WEAK' };
    const diff = charge - TUNE.METER_PERFECT;
    if (Math.abs(diff) <= TUNE.METER_WINDOW) return { factor: 1.15, grade: 'PERFECT!' };
    if (Math.abs(diff) <= TUNE.METER_WINDOW * 2.6) return { factor: 1.0, grade: 'GOOD' };
    return { factor: 0.55, grade: diff < 0 ? 'EARLY' : 'LATE' };
  }

  /** Transition windup -> release; ball launches a beat later at the hands' apex. */
  releaseShot(p, timingFactor, grade = null) {
    if (p.state !== 'windup') return;
    p.pendingShot = { type: 'jumper', timing: timingFactor, grade };
    p.setState('release', 0.34);
    p.ballReleased = false;
    p.jumpVy = 2.6;
    p.jumpY = Math.max(p.jumpY, 0.001);
    if (grade && this.userTeam === p.team) this.hud.showGrade(grade);
  }

  launchPendingShot(p) {
    const shot = p.pendingShot;
    if (!shot) return;
    p.pendingShot = null;
    p.ballReleased = true;

    const hoop = this.attackedHoop(p.team);
    const hoopIndex = this.arena.hoops.indexOf(hoop);
    const rim = hoop.rimCenter;

    if (shot.type === 'dunk') {
      // Slam it through
      this.ball.pos.set(rim.x, rim.y + 0.18, rim.z);
      this.ball.vel.set(rand(-0.4, 0.4), -5.5, rand(-0.4, 0.4));
      this.ball.state = 'shot';
      this.ball._dropHolder();
      this.ball.shot = { shooter: p, hoopIndex, is3: false, type: 'dunk', touchedRim: true, touchedBoard: false, blocked: false, T: 0.3, t: 0 };
      p.stats.fga++;
      hoop.shake(0.5);
      this.audio.dunk();
      this.audio.excite(0.5);
      this.arena.crowd.excite(0.6);
      return;
    }

    const from = this.ball.pos.clone();
    const is3 = isThreePoint(p.pos, rim.x);
    const dist = dist2D(p.pos.x, p.pos.z, rim.x, rim.z);
    const open = this.contestDistanceFor(p);
    let prob = this.shotProbability(p, dist, is3, shot.timing) * this.contestFactor(open);
    if (shot.type === 'jumper' && p.speed2D > 2.6) prob *= 0.8;
    if (shot.type === 'layup') prob = clamp(0.74 * lerp(0.8, 1.2, p.attrs.close) * this.contestFactor(open + 0.6), 0.15, 0.95);
    const make = Math.random() < prob;

    const target = new THREE.Vector3(rim.x, rim.y, rim.z);
    if (make) {
      target.x += randn() * 0.03;
      target.z += randn() * 0.03;
    } else {
      // Miss: mostly short/long along the shot line, some sideways
      const dirX = (rim.x - from.x), dirZ = (rim.z - from.z);
      const dl = Math.hypot(dirX, dirZ) || 1;
      let along = randn() * 0.20;
      if (shot.timing < 0.6) along += (shot.grade === 'EARLY' ? -0.22 : 0.20);
      if (shot.timing <= 0.3) along -= 0.3;   // weak = short brick
      const lat = randn() * 0.15;
      let ox = (dirX / dl) * along + (-dirZ / dl) * lat;
      let oz = (dirZ / dl) * along + (dirX / dl) * lat;
      const mag = Math.hypot(ox, oz);
      const m = clamp(mag, 0.13, 0.55) / (mag || 1);
      target.x += ox * m;
      target.z += oz * m;
    }
    const apex = shot.type === 'layup'
      ? clamp(0.5 + dist * 0.06, 0.5, 0.9)
      : clamp(0.9 + dist * 0.13, 1.2, 2.6);
    this.ball.launchShot(from, target, apex, { shooter: p, hoopIndex, is3, type: shot.type, prob });
    p.stats.fga++;
    if (is3) p.stats.tpa++;
    this.audio.excite(0.10);
    this.lastEvent = `${p.name} ${is3 ? '3PT ' : ''}shot`;
  }

  // ------------------------------------------------------------------
  // Actions: passing / stealing
  // ------------------------------------------------------------------

  bestPassTarget(passer) {
    let best = null, bestScore = -99;
    const hoop = this.attackedHoop(passer.team);
    for (const mate of this.players) {
      if (mate.team !== passer.team || mate === passer) continue;
      const d = dist2D(passer.pos.x, passer.pos.z, mate.pos.x, mate.pos.z);
      if (d < 1.2) continue;
      const open = this.contestDistanceFor(mate);
      const rimD = dist2D(mate.pos.x, mate.pos.z, hoop.rimCenter.x, hoop.rimCenter.z);
      const score = open * 0.6 + clamp01((11 - rimD) / 11) * 0.9 - d * 0.03;
      if (score > bestScore) { bestScore = score; best = mate; }
    }
    return best;
  }

  tryPass(passer, mate = null) {
    if (!passer.hasBall || passer.state !== 'normal') return false;
    mate = mate || this.bestPassTarget(passer);
    if (!mate) return false;
    const d = dist2D(passer.pos.x, passer.pos.z, mate.pos.x, mate.pos.z);
    const speed = TUNE.PASS_SPEED + d * 0.35;
    const T = d / speed;
    const tx = clamp(mate.pos.x + mate.vel.x * T * 0.9, -COURT.HALF_LEN + 0.4, COURT.HALF_LEN - 0.4);
    const tz = clamp(mate.pos.z + mate.vel.z * T * 0.9, -COURT.HALF_WID + 0.4, COURT.HALF_WID - 0.4);
    const from = this.ball.pos.clone();
    from.y = Math.max(from.y, 1.15 * passer.heightScale);
    this.ball.launchPass(from, new THREE.Vector3(tx, 1.15 * mate.heightScale, tz), speed, {
      passer, receiver: mate, targetX: tx, targetZ: tz, tried: new Set(),
    });
    passer.dribblePhase = 0.25;
    this.lastEvent = `${passer.name} pass`;
    return true;
  }

  trySteal(defender) {
    const holder = this.ball.holder;
    if (!holder || holder.team === defender.team) return false;
    if (defender.stealCooldown > 0 || !defender.grounded) return false;
    if (holder.state !== 'normal') return false;
    const d = dist2D(defender.pos.x, defender.pos.z, holder.pos.x, holder.pos.z);
    if (d > TUNE.STEAL_RANGE) return false;
    defender.stealCooldown = TUNE.STEAL_COOLDOWN;
    const prob = clamp(0.20 + defender.attrs.steal * 0.34 - holder.attrs.pass * 0.22, 0.08, 0.45);
    if (Math.random() < prob) {
      const dx = defender.pos.x - holder.pos.x, dz = defender.pos.z - holder.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      this.ball.setLoose(new THREE.Vector3(dx / dl * 3.2 + defender.vel.x * 0.4, 1.6, dz / dl * 3.2 + defender.vel.z * 0.4));
      this.ball.pos.y = Math.max(this.ball.pos.y, 0.7);
      this.ball.lastToucher = defender;
      this.reboundLive = false;
      holder.setState('stumble', 0.55);
      defender.stats.stl++;
      this.hud.toast(`${defender.name} STEAL!`, this.teamData[defender.team].primary);
      this.audio.excite(0.2);
      this.arena.crowd.excite(0.25);
      return true;
    }
    defender.setState('stumble', 0.85);
    return false;
  }

  // ------------------------------------------------------------------
  // Possession bookkeeping
  // ------------------------------------------------------------------

  giveBall(p, { silent = false } = {}) {
    const fromPass = this.ball.pass;
    const wasRebound = this.reboundLive && this.state === 'play';
    this.ball.hold(p);
    this.reboundLive = false;
    this.looseLanding = null;

    if (p.team !== this.possession) {
      this.possession = p.team;
      this.shotClock = TUNE.SHOT_CLOCK;
    } else if (wasRebound) {
      this.shotClock = Math.max(this.shotClock, 14);
    }
    if (wasRebound) p.stats.reb++;
    if (fromPass && fromPass.passer.team === p.team && fromPass.passer !== p) {
      this._assist = { passer: fromPass.passer, to: p, at: this.time };
    } else if (!fromPass) {
      this._assist = null;
    }
    this.refreshControl();
  }

  onBasket(hoopIndex, shot) {
    if (this.state !== 'play' && this.state !== 'celebrate') return;
    if (this.state === 'celebrate') return;
    const scoringTeam = this.hoopTeam(hoopIndex);
    let scorer = null;
    let pts = 2;
    if (shot && shot.shooter && shot.shooter.team === scoringTeam) {
      scorer = shot.shooter;
      pts = shot.is3 ? 3 : 2;
    } else if (this.ball.lastToucher && this.ball.lastToucher.team === scoringTeam) {
      scorer = this.ball.lastToucher;   // tip-in
    }
    this.score[scoringTeam] += pts;
    if (scorer) {
      scorer.stats.pts += pts;
      scorer.stats.fgm++;
      if (pts === 3) scorer.stats.tpm++;
      if (this._assist && this._assist.to === scorer && this.time - this._assist.at < 3.0 && this._assist.passer.team === scoringTeam) {
        this._assist.passer.stats.ast++;
      }
      scorer.setState('celebrate', 1.25);
    }
    this._assist = null;

    const swish = shot && !shot.touchedRim && !shot.touchedBoard && shot.type !== 'dunk';
    if (swish) this.audio.swish();
    const big = pts === 3 || (shot && shot.type === 'dunk');
    this.audio.excite(big ? 0.55 : 0.35);
    this.arena.crowd.excite(big ? 0.7 : 0.45);
    if (shot && shot.type === 'dunk') this.arena.jumbo.showFlash('SLAM DUNK!');
    else if (pts === 3) this.arena.jumbo.showFlash('3-POINTER!');
    const td = this.teamData[scoringTeam];
    this.hud.toast(`${scorer ? scorer.name + '  ' : ''}+${pts}  ${td.city}`, td.primary);

    this.possession = 1 - scoringTeam;
    this.shotClock = TUNE.SHOT_CLOCK;
    this.pendingInboundTeam = 1 - scoringTeam;
    this.reboundLive = false;
    this.state = 'celebrate';
    this.stateT = 0;
    this._afterCelebrate = this.buzzerFired ? 'break' : 'inbound';
    this.lastEvent = `${td.city} scores ${pts}`;
  }

  deadBall(reason, toTeam) {
    this.audio.whistle();
    this.hud.toast(`${reason} — ${this.teamData[toTeam].city} ball`, this.teamData[toTeam].primary);
    this.pendingInboundTeam = toTeam;
    this.possession = toTeam;
    this.shotClock = TUNE.SHOT_CLOCK;
    this.ball.state = 'held';
    this.ball._dropHolder();   // frozen mid-air until inbound
    this.ball.vel.set(0, 0, 0);
    this.reboundLive = false;
    this.looseLanding = null;
    this.state = 'dead';
    this.stateT = 0;
    this._afterCelebrate = this.buzzerFired ? 'break' : 'inbound';
  }

  doInbound() {
    const team = this.pendingInboundTeam;
    const pg = this.players.find((p) => p.team === team && p.role === 0) || this.players.find((p) => p.team === team);
    this.giveBall(pg, { silent: true });
    this.state = 'play';
    this.stateT = 0;
    this.refreshControl(true);
  }

  endPeriod() {
    this.audio.buzzer();
    const isGameOver = this.period >= 4 && this.score[0] !== this.score[1];
    if (isGameOver) {
      this.state = 'end';
      this.stateT = 0;
      const w = this.score[0] > this.score[1] ? 0 : 1;
      this.hud.showOverlay('FINAL', `${this.teamData[w].city.toUpperCase()} WINS ${Math.max(...this.score)}–${Math.min(...this.score)}`, 3.4);
      setTimeout(() => this.onGameEnd && this.onGameEnd(), 2600);
      this.arena.crowd.excite(1);
      this.audio.excite(0.9);
    } else {
      const label = this.period === 2 ? 'HALFTIME' : `END OF ${this.periodLabel()}`;
      this.hud.showOverlay(label, `${this.teamData[0].id} ${this.score[0]} — ${this.score[1]} ${this.teamData[1].id}`, 2.6);
      this.state = 'break';
      this.stateT = 0;
    }
  }

  refreshControl(force = false) {
    if (this.userTeam < 0) { this.controlled = null; this.ring.visible = false; return; }
    const ball = this.ball;
    let next = this.controlled;

    if (ball.holder && ball.holder.team === this.userTeam) {
      next = ball.holder;
    } else if (ball.pass && ball.pass.receiver && ball.pass.receiver.team === this.userTeam) {
      next = ball.pass.receiver;
    } else if (this.time > this._manualControlUntil || force) {
      // Defense / loose ball: control the nearest to the ball (with hysteresis)
      const focus = ball.holder ? ball.holder.pos : (this.looseLanding || ball.pos);
      let best = null, bestD = 1e9;
      for (const p of this.players) {
        if (p.team !== this.userTeam) continue;
        const d = dist2D(p.pos.x, p.pos.z, focus.x, focus.z);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best && (force || !next || next.team !== this.userTeam ||
          bestD + 0.6 < dist2D(next.pos.x, next.pos.z, focus.x, focus.z))) {
        next = best;
      }
    }
    this.controlled = next;
  }

  manualSwitch() {
    if (this.userTeam < 0) return;
    const mates = this.players.filter((p) => p.team === this.userTeam && p !== this.controlled);
    const focus = this.ball.pos;
    mates.sort((a, b) => dist2D(a.pos.x, a.pos.z, focus.x, focus.z) - dist2D(b.pos.x, b.pos.z, focus.x, focus.z));
    if (mates[0]) {
      this.controlled = mates[0];
      this._manualControlUntil = this.time + 1.4;
    }
  }

  // ------------------------------------------------------------------
  // Frame update
  // ------------------------------------------------------------------

  update(dt, input) {
    if (this.paused || this.state === 'idle') return;
    this.stateT += dt;

    switch (this.state) {
      case 'intro':
        this.updateActorsIdle(dt);
        if (this.stateT >= 1.9) { this.state = 'play'; this.stateT = 0; }
        break;
      case 'play':
        this.updatePlay(dt, input);
        break;
      case 'celebrate':
        this.transitionIntents();
        this.updateActors(dt);
        this.ball.update(dt);
        if (this.stateT >= 1.35) {
          if (this._afterCelebrate === 'break') this.endPeriod();
          else this.doInbound();
        }
        break;
      case 'dead':
        this.transitionIntents();
        this.updateActors(dt);
        if (this.stateT >= 1.1) {
          if (this._afterCelebrate === 'break') this.endPeriod();
          else this.doInbound();
        }
        break;
      case 'break':
        this.updateActorsIdle(dt);
        if (this.stateT >= 2.7) this.startPeriod();
        break;
      case 'end':
        this.updateActorsIdle(dt);
        break;
    }

    // Selection ring + landing marker
    const c = this.controlled;
    if (c && this.userTeam >= 0) {
      this.ring.visible = true;
      this.ring.position.set(c.pos.x, 0.02, c.pos.z);
      const s = 1 + Math.sin(this.time * 6) * 0.05;
      this.ring.scale.set(s, s, s);
    } else {
      this.ring.visible = false;
    }
    if (this.looseLanding && this.ball.state === 'loose' && this.ball.pos.y > 1.2) {
      this.landingMarker.visible = true;
      this.landingMarker.position.set(this.looseLanding.x, 0.021, this.looseLanding.z);
    } else {
      this.landingMarker.visible = false;
    }
  }

  updateActorsIdle(dt) {
    for (const p of this.players) {
      p.intent.x = 0; p.intent.z = 0; p.intent.sprint = false;
      p.controlled = p === this.controlled;
      p.defending = false;
      p.hasBall = this.ball.holder === p;
      p.update(dt, this);
    }
    separatePlayers(this.players, dt);
    this.ball.update(dt);
  }

  updateActors(dt) {
    for (const p of this.players) {
      p.controlled = p === this.controlled;
      p.defending = this.ball.holder ? this.ball.holder.team !== p.team : false;
      p.hasBall = this.ball.holder === p;
      p.update(dt, this);
    }
    separatePlayers(this.players, dt);
  }

  transitionIntents() {
    // After a whistle/basket everyone flows toward their next assignment
    for (const p of this.players) {
      if (p.state !== 'normal') {
        if (p.state === 'celebrate') { p.intent.x = 0; p.intent.z = 0; }
        continue;
      }
      const as = this.attackSign(p.team);
      const spot = OFFENSE_SPOTS[p.role];
      let tx, tz;
      if (p.team === this.pendingInboundTeam) {
        tx = p.role === 0 ? -as * 8.5 : as * spot.x * 0.25;
        tz = p.role === 0 ? 0.8 : spot.z * 0.8;
      } else {
        tx = -as * Math.abs(spot.x) * 0.85;   // drop back to defend
        tz = spot.z * 0.75;
      }
      const dx = tx - p.pos.x, dz = tz - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.5) {
        p.intent.x = dx / d; p.intent.z = dz / d;
        p.intent.sprint = d > 6;
      } else {
        p.intent.x = 0; p.intent.z = 0;
      }
    }
  }

  updatePlay(dt, input) {
    this.time += dt;

    // Clocks
    if (!this.buzzerFired) {
      this.gameClock -= dt;
      if (this.ball.state !== 'shot') this.shotClock -= dt;
      if (this.gameClock <= 0) {
        this.gameClock = 0;
        this.buzzerFired = true;
        this.audio.buzzer();
      }
    }
    if (this.buzzerFired) {
      const holder = this.ball.holder;
      const liveShot = this.ball.state === 'shot' ||
        (holder && (holder.state === 'windup' || holder.state === 'release' || holder.inScriptedAir));
      if (!liveShot) { this.endPeriod(); return; }
    }
    if (this.shotClock <= 0) {
      const holder = this.ball.holder;
      if (holder && holder.team === this.possession) {
        this.deadBall('SHOT CLOCK VIOLATION', 1 - this.possession);
        return;
      }
      this.shotClock = 0.01; // waiting on a live ball to resolve
    }

    // User + AI intents
    if (input) this.handleUserInput(input, dt);
    updateAI(this, dt);

    // Windup / release / finish timing
    for (const p of this.players) {
      if (p.state === 'windup') {
        if (p === this.controlled && this.userTeam === p.team && !p.aiShot) {
          p.meterCharge = clamp01(p.stateT / TUNE.METER_TIME);
          if (p.meterCharge >= 1) {
            const t = this.meterTiming(1);
            this.releaseShot(p, t.factor, 'LATE');
          }
        } else {
          p.meterCharge = clamp01(p.stateT / 0.42);
          if (p.aiShot && p.stateT >= 0.42) this.releaseShot(p, p.aiShot.timing);
        }
      }
      if (p.state === 'release' && !p.ballReleased && p.stateT >= 0.12) this.launchPendingShot(p);
      if (p.state === 'layup' && !p.ballReleased && p.stateT >= p.stateDur * 0.55) this.launchPendingShot(p);
      if (p.state === 'dunk' && !p.ballReleased && p.stateT >= p.stateDur * 0.60) this.launchPendingShot(p);
    }

    this.updateActors(dt);
    this.ball.update(dt);
    this.ball.checkRebound();

    // Ball-state transitions
    if (this._prevBallState === 'shot' && this.ball.state === 'loose') {
      this.reboundLive = true;
    }
    this._prevBallState = this.ball.state;

    if (this.ball.state === 'loose') {
      if (this.time - this._landingAt > 0.2) {
        this.looseLanding = this.ball.predictLanding(0.9, this.looseLanding || new THREE.Vector3());
        this._landingAt = this.time;
        this.computeReboundRanks();
      }
    } else {
      this.looseLanding = null;
    }

    if (this.ball.state === 'pass') this.handlePassCatch();
    else if (this.ball.state === 'loose') this.handlePickup();
    else if (this.ball.state === 'shot') this.handleBlocks();

    this.checkOOB();
    this.refreshControl();

    // Ambient squeaks scale with how hard everyone is cutting
    let fast = 0;
    for (const p of this.players) if (p.speed2D > 4.5) fast++;
    this.audio.maybeSqueak(dt, 0.01 + fast * 0.012);
  }

  handleUserInput(input, dt) {
    const c = this.controlled;
    if (!c || this.userTeam < 0) return;
    const mv = input.worldMove;
    c.intent.x = mv.x;
    c.intent.z = mv.z;
    c.intent.sprint = input.sprint;

    const onOffense = this.ball.holder && this.ball.holder.team === this.userTeam;

    if (c.hasBall) {
      if (input.justPressed('shoot')) this.startShot(c);
      if (input.justReleased('shoot') && c.state === 'windup') {
        const t = this.meterTiming(c.meterCharge);
        this.releaseShot(c, t.factor, t.grade);
      }
      if (input.justPressed('pass')) this.tryPass(c);
    } else if (onOffense) {
      if (input.justPressed('shoot')) c.startJump(0.9);
    } else {
      if (input.justPressed('shoot')) c.startJump(1.0);
      if (input.justPressed('pass')) this.trySteal(c);
      if (input.justPressed('switch')) this.manualSwitch();
    }
  }

  computeReboundRanks() {
    this._rebRanks.clear();
    if (!this.looseLanding) return;
    for (const t of [0, 1]) {
      const mates = this.players
        .filter((p) => p.team === t)
        .sort((a, b) =>
          dist2D(a.pos.x, a.pos.z, this.looseLanding.x, this.looseLanding.z) -
          dist2D(b.pos.x, b.pos.z, this.looseLanding.x, this.looseLanding.z));
      mates.forEach((p, i) => this._rebRanks.set(p, i));
    }
  }

  reboundRank(p) {
    return this._rebRanks.has(p) ? this._rebRanks.get(p) : 9;
  }

  handlePassCatch() {
    const ps = this.ball.pass;
    if (!ps) return;
    const bp = this.ball.pos;
    for (const p of this.players) {
      if (p === ps.passer) continue;
      const chestY = 1.2 * p.heightScale + p.jumpY;
      const dx = bp.x - p.pos.x, dz = bp.z - p.pos.z;
      const dy = bp.y - chestY;
      const d = Math.hypot(dx, dz);
      const reach3 = Math.hypot(d, dy * 0.8);
      if (p.team === ps.passer.team) {
        if (reach3 < TUNE.CATCH_RANGE && p.grounded && p.state === 'normal') {
          this.giveBall(p);
          return;
        }
      } else {
        if (reach3 < TUNE.INTERCEPT_RANGE && !ps.tried.has(p)) {
          ps.tried.add(p);
          if (Math.random() < 0.20 + p.attrs.steal * 0.32) {
            p.stats.stl++;
            this.hud.toast(`${p.name} INTERCEPTS!`, this.teamData[p.team].primary);
            this.audio.excite(0.2);
            this.giveBall(p);
            return;
          }
        }
      }
    }
    // Nobody home: sail past and go loose
    if (ps.t > ps.T + 0.45) this.ball.setLoose();
  }

  handlePickup() {
    const bp = this.ball.pos;
    if (bp.y > 2.6) return;
    let best = null, bestD = 1e9;
    for (const p of this.players) {
      if (p.state === 'stumble' || p.state === 'windup' || p.state === 'release' || p.inScriptedAir) continue;
      const reachY = 1.0 * p.heightScale + p.jumpY + (p.state === 'jump' ? 1.15 : 0.8);
      if (bp.y > reachY + 0.6) continue;
      const d = dist2D(p.pos.x, p.pos.z, bp.x, bp.z);
      const range = TUNE.PICKUP_RANGE + (p.state === 'jump' ? 0.25 : 0) + p.attrs.reb * 0.1;
      if (d < range && d < bestD) { best = p; bestD = d; }
    }
    if (best) this.giveBall(best);
  }

  handleBlocks() {
    const shot = this.ball.shot;
    if (!shot || shot.type === 'dunk' || shot.blocked) return;
    if (shot.t > shot.T * 0.5) return;   // only on the rise
    if (!shot.tried) shot.tried = new Set();
    const bp = this.ball.pos;
    for (const p of this.players) {
      if (p.team === shot.shooter.team || p.jumpY < 0.12 || shot.tried.has(p)) continue;
      const reach = p.attrs.h * 1.30 + p.jumpY;
      const dx = bp.x - p.pos.x, dz = bp.z - p.pos.z, dy = bp.y - reach;
      if (Math.hypot(dx, dz) < TUNE.BLOCK_RANGE && dy < 0.18 && dy > -0.75) {
        shot.tried.add(p);
        if (Math.random() < 0.20 + p.attrs.block * 0.30) {
          shot.blocked = true;
          const hoop = this.arena.hoops[shot.hoopIndex];
          const awayX = bp.x - hoop.rimCenter.x, awayZ = bp.z - hoop.rimCenter.z;
          const al = Math.hypot(awayX, awayZ) || 1;
          this.ball.vel.set(awayX / al * 4.5 + randn(), Math.min(this.ball.vel.y * -0.1, -0.5), awayZ / al * 4.5 + randn());
          this.ball.setLoose();
          this.ball.lastToucher = p;
          this.reboundLive = true;
          p.stats.blk++;
          this.hud.toast(`${p.name} BLOCKS IT!`, this.teamData[p.team].primary);
          this.audio.block();
          this.audio.excite(0.35);
          this.arena.crowd.excite(0.5);
          return;
        }
      }
    }
  }

  checkOOB() {
    const bp = this.ball.pos;
    const st = this.ball.state;
    if (st !== 'loose' && st !== 'pass') return;
    if (Math.abs(bp.x) > COURT.HALF_LEN + 0.4 || Math.abs(bp.z) > COURT.HALF_WID + 0.4) {
      const lastTeam = this.ball.lastToucher ? this.ball.lastToucher.team : this.possession;
      this.deadBall('OUT OF BOUNDS', 1 - lastTeam);
    }
  }

  // For HUD/jumbotron
  hudState() {
    const a = this.teamData[0], b = this.teamData[1];
    return {
      scoreA: this.score[0], scoreB: this.score[1],
      abbrA: a.id, abbrB: b.id,
      colA: '#' + a.primary.toString(16).padStart(6, '0'),
      colB: '#' + b.primary.toString(16).padStart(6, '0'),
      period: this.period,
      periodLabel: this.period > 4 ? `OT${this.period - 4}` : `Q${this.period}`,
      clock: Math.max(0, this.gameClock),
      shot: Math.max(0, this.shotClock),
      possession: this.possession,
    };
  }
}
