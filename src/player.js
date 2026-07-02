import * as THREE from '../vendor/three.module.js';
import { COURT, TUNE, ROLE_ATTRS, ROLES } from './constants.js';
import { clamp, clamp01, lerp, dampAngle, rand } from './utils.js';
import { PlayerRig, skinToneColor } from './playerModel.js';

const G = 9.81;

export class Player {
  /**
   * team: 0|1, index: 0..9 global, role: 0..4, spec: roster entry,
   * teamData: TEAMS entry, home: bool (white jerseys), matCache, scene
   */
  constructor({ team, index, role, spec, teamData, home, matCache, scene }) {
    this.team = team;
    this.index = index;
    this.role = role;
    this.roleName = ROLES[role];
    this.name = spec.name;
    this.number = spec.num;

    const base = ROLE_ATTRS[this.roleName];
    this.attrs = { ...base };
    for (const k in (spec.mods || {})) this.attrs[k] = clamp01(this.attrs[k] + spec.mods[k]);
    this.heightScale = this.attrs.h / 1.95;

    const jerseyColor = home ? 0xf4f2ec : teamData.primary;
    const trimColor = home ? teamData.primary : teamData.secondary;
    const shortsColor = home ? 0xe9e6df : teamData.dark;
    const numberColor = home ? '#' + teamData.primary.toString(16).padStart(6, '0') : '#f4f2ec';

    this.rig = new PlayerRig({
      heightScale: this.heightScale,
      skinTone: skinToneColor(spec.skin),
      hair: spec.hair,
      jerseyColor, trimColor, shortsColor, numberColor,
      number: spec.num,
      shoeColor: home ? teamData.dark : 0x16161a,
      matCache,
    });
    scene.add(this.rig.group);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.targetFacing = 0;

    this.state = 'normal';
    this.stateT = 0;
    this.stateDur = 0;
    this.jumpY = 0;
    this.jumpVy = 0;
    this.air = null;          // scripted air move {from, to, dur, peak}

    this.speed2D = 0;
    this.animPhase = rand(0, 1);
    this.dribblePhase = rand(0, 1);
    this.dribbleSide = 1;
    this._sideTimer = rand(2, 5);

    this.hasBall = false;
    this.defending = false;
    this.controlled = false;
    this.meterCharge = 0;
    this.ballReleased = false;
    this.celebrateStyle = 0;

    this.stealCooldown = 0;
    this.jumpCooldown = 0;
    this.shotContext = null;   // set by game when a shot starts

    // Per-frame intent (from input or AI): move dir (unit), sprint flag
    this.intent = { x: 0, z: 0, sprint: false };
    this.aiMemory = { decideAt: 0, spot: null, cutUntil: 0, targetSpot: new THREE.Vector3() };

    this.stats = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, reb: 0, stl: 0, blk: 0, ast: 0 };
  }

  get grounded() {
    return this.jumpY <= 0.001 && !this.air;
  }

  get inScriptedAir() {
    return this.state === 'layup' || this.state === 'dunk';
  }

  maxSpeed() {
    const base = lerp(TUNE.RUN_SPEED, TUNE.SPRINT_SPEED, this.intent.sprint ? 1 : 0);
    let sp = base * lerp(0.86, 1.06, this.attrs.spd);
    if (this.hasBall) sp *= TUNE.BALL_SPEED_MULT;
    return sp;
  }

  setState(state, dur = 0) {
    this.state = state;
    this.stateT = 0;
    this.stateDur = dur;
    if (state === 'celebrate') this.celebrateStyle = Math.floor(rand(0, 2));
    if (state !== 'windup') this.meterCharge = 0;
  }

  /** Begin a vertical jump (block/contest/board). */
  startJump(power = 1) {
    if (!this.grounded || this.jumpCooldown > 0) return false;
    this.jumpVy = TUNE.JUMP_SPEED * power * lerp(0.9, 1.1, this.attrs.dunk);
    this.jumpY = 0.001;
    this.jumpCooldown = 0.9;
    this.setState('jump');
    return true;
  }

  /** Begin a scripted arc (layup/dunk) toward a landing/finish point. */
  startAir(state, to, dur, peak) {
    this.air = { from: this.pos.clone(), to: to.clone(), dur, peak };
    this.setState(state, dur);
    this.ballReleased = false;
  }

  teleport(x, z, facing = 0) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.jumpY = 0;
    this.air = null;
    this.facing = this.targetFacing = facing;
    this.setState('normal');
  }

  update(dt, game) {
    this.stateT += dt;
    this.stealCooldown = Math.max(0, this.stealCooldown - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    const s = this.state;

    // --- locomotion control (only in free states)
    const canSteer = s === 'normal' || s === 'celebrate';
    if (canSteer) {
      const ms = this.maxSpeed();
      let dx = this.intent.x, dz = this.intent.z;
      const len = Math.hypot(dx, dz);
      if (len > 1) { dx /= len; dz /= len; }
      const desX = dx * ms, desZ = dz * ms;
      const k = 1 - Math.exp(-((len > 0.05) ? TUNE.ACCEL / ms : TUNE.FRICTION / Math.max(1, ms)) * dt * 1.1);
      this.vel.x += (desX - this.vel.x) * k;
      this.vel.z += (desZ - this.vel.z) * k;
    } else if (s === 'windup' || s === 'release' || s === 'stumble' || s === 'land') {
      // Bleed off momentum quickly
      const k = 1 - Math.exp(-10 * dt);
      this.vel.x -= this.vel.x * k;
      this.vel.z -= this.vel.z * k;
    }
    // 'jump' keeps momentum; scripted air overrides position below.

    if (this.air) {
      const u = clamp01(this.stateT / this.air.dur);
      this.pos.x = lerp(this.air.from.x, this.air.to.x, u);
      this.pos.z = lerp(this.air.from.z, this.air.to.z, u);
      this.jumpY = this.air.peak * 4 * u * (1 - u);
      if (u >= 1) {
        this.air = null;
        this.jumpY = 0;
        this.setState('land', 0.16);
      }
    } else {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      // Vertical jump physics
      if (this.jumpY > 0 || this.jumpVy > 0) {
        this.jumpY += this.jumpVy * dt;
        this.jumpVy -= G * dt;
        if (this.jumpY <= 0) {
          this.jumpY = 0;
          this.jumpVy = 0;
          if (s === 'jump') this.setState('land', 0.14);
        }
      }
    }

    // Keep players on the floor area; the ball-handler must stay in bounds
    const bx = this.hasBall ? COURT.HALF_LEN - 0.25 : COURT.HALF_LEN + COURT.APRON - 0.5;
    const bz = this.hasBall ? COURT.HALF_WID - 0.25 : COURT.HALF_WID + COURT.APRON - 0.5;
    this.pos.x = clamp(this.pos.x, -bx, bx);
    this.pos.z = clamp(this.pos.z, -bz, bz);

    this.speed2D = Math.hypot(this.vel.x, this.vel.z);

    // --- state auto-transitions
    if ((s === 'land' || s === 'stumble' || s === 'release') && this.stateT >= (this.stateDur || 0.15)) {
      this.setState('normal');
    }
    if (s === 'celebrate' && this.stateT >= (this.stateDur || 1.4)) {
      this.setState('normal');
    }

    // --- animation phases
    this.animPhase += dt * (0.25 + this.speed2D * 0.30);
    if (this.hasBall && (s === 'normal')) {
      const rate = 1.15 + this.speed2D * 0.16;
      this.dribblePhase += dt * rate;
      this._sideTimer -= dt;
      if (this._sideTimer <= 0 && Math.abs((this.dribblePhase % 1) - 0.5) < 0.1) {
        this.dribbleSide *= -1;   // crossover when the ball is near the floor
        this._sideTimer = rand(1.8, 4.5);
      }
    }

    // --- facing
    if (s === 'windup' || s === 'release' || this.inScriptedAir) {
      const hoop = game.attackedHoop(this.team);
      this.targetFacing = Math.atan2(hoop.rimCenter.x - this.pos.x, hoop.rimCenter.z - this.pos.z);
    } else if (this.defending && game.ball.holder && game.ball.holder.team !== this.team && this.speed2D < 3.5) {
      const b = game.ball.pos;
      this.targetFacing = Math.atan2(b.x - this.pos.x, b.z - this.pos.z);
    } else if (this.speed2D > 0.8) {
      this.targetFacing = Math.atan2(this.vel.x, this.vel.z);
    }
    this.facing = dampAngle(this.facing, this.targetFacing, TUNE.TURN_RATE, dt);

    // --- write transform + pose
    this.rig.group.position.set(this.pos.x, this.jumpY, this.pos.z);
    this.rig.group.rotation.y = this.facing;
    this.rig.updatePose(this, dt);
    if (this.hasBall) this.rig.group.updateMatrixWorld(true);
  }
}

/** Resolve overlaps between players with a soft radial push. */
export function separatePlayers(players, dt) {
  const r2 = TUNE.PLAYER_RADIUS * 2;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      if (a.inScriptedAir || b.inScriptedAir) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < r2 && d > 1e-5) {
        const push = (r2 - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
      }
    }
  }
}
