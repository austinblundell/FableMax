import * as THREE from '../vendor/three.module.js';
import { COURT, PHYS } from './constants.js';
import { makeCanvas, canvasTexture, clamp, dribbleY } from './utils.js';

const G = PHYS.GRAVITY;
const R = COURT.BALL_R;

function makeBallTexture() {
  const { canvas, ctx } = makeCanvas(512, 256);
  // Pebbled leather base
  ctx.fillStyle = '#d4622a';
  ctx.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 512, y = Math.random() * 256;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(90,35,10,0.20)' : 'rgba(255,170,110,0.14)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  // Seams (equirect: verticals = meridians, horizontals = latitude circles)
  ctx.strokeStyle = '#26130a';
  ctx.lineWidth = 5;
  const H = 256;
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(512, H / 2); ctx.stroke();
  for (const u of [0, 128, 256, 384]) {
    ctx.beginPath(); ctx.moveTo(u, 0); ctx.lineTo(u, H); ctx.stroke();
  }
  // Curved side seams
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 4) {
      const y = H / 2 + dir * (H * 0.30 + Math.sin((x / 512) * Math.PI * 4) * H * 0.10);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return canvasTexture(canvas);
}

export class Ball {
  constructor(scene, envMap) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(R, 28, 22),
      new THREE.MeshStandardMaterial({
        map: makeBallTexture(), roughness: 0.72, metalness: 0.0,
        envMap, envMapIntensity: 0.5,
      })
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    this.pos = new THREE.Vector3(0, R, 0);
    this.vel = new THREE.Vector3();
    this.state = 'loose';   // 'held' | 'shot' | 'pass' | 'loose'
    this.holder = null;
    this.shot = null;       // { shooter, hoopIndex, is3, quality, touchedRim, blocked }
    this.pass = null;       // { passer, receiver, t, T }
    this.lastToucher = null;
    this.grounded = false;
    this.scoreCooldown = 0;
    this._prevY = this.pos.y;
    this._spinAxis = new THREE.Vector3(1, 0, 0);
    this._spinRate = 0;

    // Assigned by Game:
    this.events = { onRimHit: () => {}, onBoardHit: () => {}, onScore: () => {}, onBounce: () => {} };
    this.hoops = [];
  }

  // ------------------------------------------------------------------
  // Possession helpers
  // ------------------------------------------------------------------

  hold(player) {
    if (this.holder && this.holder !== player) this.holder.hasBall = false;
    this.state = 'held';
    this.holder = player;
    if (player) player.hasBall = true;
    this.lastToucher = player;
    this.shot = null;
    this.pass = null;
    this.vel.set(0, 0, 0);
    this.grounded = false;
  }

  _dropHolder() {
    if (this.holder) this.holder.hasBall = false;
    this.holder = null;
  }

  setLoose(kickVel = null) {
    this.state = 'loose';
    this._dropHolder();
    this.shot = null;
    this.pass = null;
    if (kickVel) this.vel.copy(kickVel);
  }

  /** Ballistic shot toward a target point. apex = extra rise above the start. */
  launchShot(from, target, apex, meta) {
    this.pos.copy(from);
    const dy = target.y - from.y;
    const apexAbove = Math.max(apex, dy + 0.4);
    const vy = Math.sqrt(2 * G * apexAbove);
    const T = vy / G + Math.sqrt(Math.max(0.01, 2 * (apexAbove - dy) / G));
    this.vel.set((target.x - from.x) / T, vy, (target.z - from.z) / T);
    this.state = 'shot';
    this._dropHolder();
    this.shot = { touchedRim: false, touchedBoard: false, blocked: false, T, t: 0, ...meta };
    this.pass = null;
    this.grounded = false;
    // Backspin, perpendicular to flight direction
    this._spinAxis.set(this.vel.z, 0, -this.vel.x).normalize();
    this._spinRate = 14;
    return T;
  }

  /** Flat-arc pass to a point; returns flight time. */
  launchPass(from, target, speed, meta) {
    this.pos.copy(from);
    const dx = target.x - from.x, dz = target.z - from.z;
    const horiz = Math.hypot(dx, dz);
    const T = Math.max(0.18, horiz / speed);
    const dy = target.y - from.y;
    const vy = (dy + 0.5 * G * T * T) / T;
    this.vel.set(dx / T, vy, dz / T);
    this.state = 'pass';
    this._dropHolder();
    this.pass = { t: 0, T, ...meta };
    this.shot = null;
    this.grounded = false;
    this._spinAxis.set(this.vel.z, 0, -this.vel.x).normalize();
    this._spinRate = 8;
    return T;
  }

  /** Predict where the ball (currently airborne) lands at catch height. */
  predictLanding(h = 0.9, out = new THREE.Vector3()) {
    const dy = this.pos.y - h;
    const vy = this.vel.y;
    const disc = vy * vy + 2 * G * Math.max(0, dy);
    const t = (vy + Math.sqrt(disc)) / G;
    out.set(this.pos.x + this.vel.x * t, h, this.pos.z + this.vel.z * t);
    out.x = clamp(out.x, -COURT.HALF_LEN - 1, COURT.HALF_LEN + 1);
    out.z = clamp(out.z, -COURT.HALF_WID - 1, COURT.HALF_WID + 1);
    return out;
  }

  // ------------------------------------------------------------------
  // Held-ball positioning (dribble bounce / carry in hands)
  // ------------------------------------------------------------------

  followHolder(dt) {
    const p = this.holder;
    const out = this.pos;
    if (p.rig.getBallCarryPos(out)) {
      // Rig placed the ball (windup / layup / dunk / carry)
      this.vel.set(0, 0, 0);
    } else {
      // Dribble sim: bounce beside the player, synced to their dribble phase
      const side = p.dribbleSide;
      const sx = Math.cos(p.facing) * 0.20 * side + Math.sin(p.facing) * 0.28;
      const sz = -Math.sin(p.facing) * 0.20 * side + Math.cos(p.facing) * 0.28;
      out.x = p.pos.x + sx;
      out.z = p.pos.z + sz;
      out.y = dribbleY(p.dribblePhase, 0.95 * p.heightScale, R);
    }
    this.mesh.position.copy(out);
    this.mesh.rotation.y = p.facing;
  }

  // ------------------------------------------------------------------
  // Physics
  // ------------------------------------------------------------------

  update(dt) {
    if (this.scoreCooldown > 0) this.scoreCooldown -= dt;
    if (this.state === 'held') {
      if (this.holder) this.followHolder(dt);
      return;
    }
    let remaining = dt;
    while (remaining > 0) {
      const h = Math.min(PHYS.BALL_SUBSTEP, remaining);
      this.step(h);
      remaining -= h;
    }
    if (this.pass) this.pass.t += dt;
    if (this.shot) this.shot.t += dt;
    this.mesh.position.copy(this.pos);
    if (this._spinRate > 0.05) {
      this.mesh.rotateOnWorldAxis(this._spinAxis, -this._spinRate * dt);
    }
  }

  step(h) {
    const p = this.pos, v = this.vel;
    this._prevY = p.y;

    if (this.grounded && Math.abs(v.y) < 0.4 && p.y <= R + 0.002) {
      // Rolling on the floor
      p.y = R;
      v.y = 0;
      const sp = Math.hypot(v.x, v.z);
      if (sp > 0.01) {
        const dec = Math.min(sp, 3.2 * h);
        v.x -= (v.x / sp) * dec;
        v.z -= (v.z / sp) * dec;
        this._spinAxis.set(v.z, 0, -v.x).normalize();
        this._spinRate = sp / R;
      } else {
        v.x = v.z = 0;
        this._spinRate = 0;
      }
      p.x += v.x * h;
      p.z += v.z * h;
      return;
    }

    v.y -= G * h;
    p.x += v.x * h;
    p.y += v.y * h;
    p.z += v.z * h;

    // Floor
    if (p.y < R) {
      p.y = R;
      if (v.y < 0) {
        const impact = -v.y;
        v.y = impact * PHYS.FLOOR_REST;
        v.x *= 0.985;
        v.z *= 0.985;
        if (impact > 0.6) this.events.onBounce(impact, p);
        if (v.y < 0.55) { v.y = 0; this.grounded = true; }
        if (this.state === 'shot') this._shotBecameLive('floor');
        if (this.state === 'pass') this.setLoose();
      }
    }

    // Hoop interactions
    for (let i = 0; i < this.hoops.length; i++) {
      const hoop = this.hoops[i];
      const rc = hoop.rimWorld;
      // Quick reject
      if (Math.abs(p.x - rc.x) > 2.2 || Math.abs(p.z - rc.z) > 2.2 || p.y < 1.6 || p.y > 4.6) continue;

      // Score detection: crossing the rim plane downward inside the ring
      if (this._prevY > rc.y && p.y <= rc.y && v.y < 0 && this.scoreCooldown <= 0) {
        const d = Math.hypot(p.x - rc.x, p.z - rc.z);
        if (d < COURT.RIM_R - R * 0.30) {
          this.scoreCooldown = 1.5;
          hoop.net.splash(clamp(-v.y * 0.4, 0.6, 2.2));
          // Net drag
          v.y *= 0.55;
          v.x *= 0.4;
          v.z *= 0.4;
          this.events.onScore(i, this.shot);
          this._shotBecameLive('score');
        }
      }

      // Rim collision (torus ring)
      const hx = p.x - rc.x, hz = p.z - rc.z;
      const hLen = Math.hypot(hx, hz) || 1e-6;
      const ringR = COURT.RIM_R + COURT.RIM_TUBE;
      const qx = rc.x + (hx / hLen) * ringR;
      const qz = rc.z + (hz / hLen) * ringR;
      const dx = p.x - qx, dy = p.y - rc.y, dz = p.z - qz;
      const dist = Math.hypot(dx, dy, dz);
      const minD = R + COURT.RIM_TUBE;
      if (dist < minD && dist > 1e-6) {
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        const push = minD - dist;
        p.x += nx * push; p.y += ny * push; p.z += nz * push;
        const vn = v.x * nx + v.y * ny + v.z * nz;
        if (vn < 0) {
          const rest = PHYS.RIM_REST;
          v.x -= (1 + rest) * vn * nx;
          v.y -= (1 + rest) * vn * ny;
          v.z -= (1 + rest) * vn * nz;
          v.multiplyScalar(0.94);
          // Slight chaos so rim rolls feel organic
          v.x += (Math.random() - 0.5) * 0.3;
          v.z += (Math.random() - 0.5) * 0.3;
          hoop.shake(Math.abs(vn) * 0.055);
          if (Math.abs(vn) > 1.2) this.events.onRimHit(i, Math.abs(vn));
          if (this.shot && !this.shot.touchedRim) this.shot.touchedRim = true;
          this._spinRate *= 0.5;
        }
      }

      // Backboard
      const bx = hoop.boardX;
      const s = hoop.sign;
      const u = (p.x - bx) * s;  // >0 means behind the glass front
      if (u > -R && u < 0.25 && v.x * s > 0 &&
          Math.abs(p.z - rc.z) < COURT.BOARD_W / 2 + R * 0.4 &&
          p.y > COURT.BOARD_BOTTOM - R && p.y < COURT.BOARD_BOTTOM + COURT.BOARD_H + R) {
        p.x = bx - s * R;
        v.x = -v.x * PHYS.BOARD_REST;
        v.y *= 0.95;
        v.z *= 0.95;
        hoop.shake(Math.abs(v.x) * 0.012);
        this.events.onBoardHit(i, Math.abs(v.x));
        if (this.shot && !this.shot.touchedBoard) this.shot.touchedBoard = true;
        this._spinRate *= 0.6;
      }
    }
  }

  /** A shot that hit floor / scored is no longer a live "shot" for block/board purposes. */
  _shotBecameLive(reason) {
    if (this.state === 'shot') {
      this.state = 'loose';
    }
  }

  /** Shots become rebounds once they've touched iron and dropped below the rim. */
  checkRebound() {
    if (this.state === 'shot' && this.shot &&
        (this.shot.touchedRim || this.shot.touchedBoard) &&
        this.pos.y < COURT.RIM_HEIGHT - 0.1 && this.vel.y < 0) {
      this.state = 'loose';
    }
    // Airball: past its expected flight time and clearly descending below rim level
    if (this.state === 'shot' && this.shot && this.shot.t > this.shot.T + 0.15 && this.pos.y < COURT.RIM_HEIGHT - 0.4) {
      this.state = 'loose';
    }
  }
}
