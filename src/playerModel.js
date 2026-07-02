import * as THREE from '../vendor/three.module.js';
import { SKIN_TONES } from './constants.js';
import { makeCanvas, canvasTexture, clamp, clamp01, lerp, damp } from './utils.js';

// Base skeleton proportions for a 1.95 m player; the whole rig is scaled by height.
const BASE_H = 1.95;
const HIP_Y = 1.06;
const THIGH = 0.50, SHIN = 0.48;
const TORSO = 0.50;
const SHOULDER_X = 0.235, SHOULDER_Y = 0.45;
const UPPER_ARM = 0.31, FOREARM = 0.29;

// Rotation conventions (limbs hang -Y in rest pose, character faces +Z):
//   forward swing a>0 (thigh/shoulder)  -> rotation.x = -a
//   knee bend b>0                       -> rotation.x = +b
//   elbow bend b>0                      -> rotation.x = -b
//   spread v>0 pushes the +X limb out   -> rotation.z = +v (mirror for -X limb)

function limbCapsule(radius, len, material) {
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.02, len - radius * 1.2), 3, 10);
  geo.translate(0, -len / 2, 0);
  return new THREE.Mesh(geo, material);
}

function numberTexture(num, color) {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = color;
  ctx.font = '900 86px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 64, 70);
  return canvasTexture(canvas);
}

export class MaterialCache {
  constructor(envMap) {
    this.envMap = envMap;
    this.map = new Map();
  }
  std(color, roughness = 0.8, metalness = 0) {
    const k = `${color}|${roughness}|${metalness}`;
    if (!this.map.has(k)) {
      this.map.set(k, new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: this.envMap, envMapIntensity: 0.35 }));
    }
    return this.map.get(k);
  }
}

export class PlayerRig {
  /**
   * opts: { heightScale, skinTone, hair, jerseyColor, trimColor, shortsColor,
   *         numberColor, number, shoeColor, matCache }
   */
  constructor(opts) {
    const mc = opts.matCache;
    const skin = mc.std(opts.skinTone, 0.75);
    const jersey = mc.std(opts.jerseyColor, 0.62);
    const shorts = mc.std(opts.shortsColor, 0.62);
    const trim = mc.std(opts.trimColor, 0.55);
    const shoe = mc.std(opts.shoeColor, 0.5);
    const sole = mc.std(0xf2efe8, 0.7);

    const g = new THREE.Group();
    this.group = g;
    this.heightScale = opts.heightScale;
    g.scale.setScalar(opts.heightScale);

    // --- hips + pelvis + shorts
    const hips = new THREE.Group();
    hips.position.y = HIP_Y;
    g.add(hips);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), shorts);
    pelvis.scale.set(1.15, 0.72, 0.9);
    pelvis.position.y = 0.02;
    hips.add(pelvis);
    const shortsMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.20, 0.30, 12), shorts);
    shortsMesh.position.y = -0.13;
    hips.add(shortsMesh);
    for (const sx of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.28, 0.06), trim);
      stripe.position.set(sx * 0.185, -0.13, 0);
      hips.add(stripe);
    }

    // --- spine / torso / head
    const spine = new THREE.Group();
    spine.position.y = 0.06;
    hips.add(spine);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, TORSO - 0.18, 4, 12), jersey);
    torso.scale.set(1, 1, 0.68);
    torso.position.y = TORSO / 2 + 0.05;
    spine.add(torso);
    // Shoulder caps
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), skin);
      cap.position.set(sx * SHOULDER_X, SHOULDER_Y, 0);
      spine.add(cap);
    }
    // Number decals
    const numTexF = numberTexture(opts.number, opts.numberColor);
    for (const [z, ry] of [[0.132, 0], [-0.132, Math.PI]]) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.24, 0.24),
        new THREE.MeshBasicMaterial({ map: numTexF, transparent: true, polygonOffset: true, polygonOffsetFactor: -1 })
      );
      plane.position.set(0, 0.30, z);
      plane.rotation.y = ry;
      spine.add(plane);
    }

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.09, 8), skin);
    neck.position.y = SHOULDER_Y + 0.055;
    spine.add(neck);
    const headG = new THREE.Group();
    headG.position.y = SHOULDER_Y + 0.10;
    spine.add(headG);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.112, 14, 12), skin);
    head.scale.set(0.92, 1.08, 0.98);
    head.position.y = 0.105;
    headG.add(head);
    if (opts.hair === 'short' || opts.hair === 'buzz') {
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(opts.hair === 'short' ? 0.118 : 0.114, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
        mc.std(0x14100c, 0.9)
      );
      hair.position.y = 0.115;
      hair.scale.set(0.94, 1.02, 1.0);
      headG.add(hair);
    } else if (opts.hair === 'band') {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.045, 12, 1, true), trim);
      band.position.y = 0.15;
      headG.add(band);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.116, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), mc.std(0x14100c, 0.9));
      hair.position.y = 0.12;
      headG.add(hair);
    }

    // --- arms
    const mkArm = (sx) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * SHOULDER_X, SHOULDER_Y, 0);
      spine.add(shoulder);
      const upper = limbCapsule(0.062, UPPER_ARM, skin);
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -UPPER_ARM;
      shoulder.add(elbow);
      const fore = limbCapsule(0.052, FOREARM, skin);
      elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 7), skin);
      hand.position.y = -FOREARM - 0.03;
      elbow.add(hand);
      return { shoulder, elbow, hand };
    };
    this.armR = mkArm(-1);   // -X side
    this.armL = mkArm(1);    // +X side (dribble side when player.dribbleSide === 1)
    // Wristband on the +X arm
    const wb = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), trim);
    wb.position.y = -FOREARM + 0.06;
    this.armL.elbow.add(wb);

    // --- legs
    const mkLeg = (sx) => {
      const thighG = new THREE.Group();
      thighG.position.set(sx * 0.105, -0.03, 0);
      hips.add(thighG);
      const thigh = limbCapsule(0.088, THIGH, shorts);   // shorts cover upper leg
      thighG.add(thigh);
      const skinThigh = limbCapsule(0.075, 0.22, skin);
      skinThigh.position.y = -THIGH + 0.20;
      thighG.add(skinThigh);
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      thighG.add(knee);
      const shin = limbCapsule(0.062, SHIN, skin);
      knee.add(shin);
      const foot = new THREE.Group();
      foot.position.y = -SHIN;
      knee.add(foot);
      const shoeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.085, 0.30), shoe);
      shoeMesh.position.set(0, -0.015, 0.055);
      foot.add(shoeMesh);
      const soleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.31), sole);
      soleMesh.position.set(0, -0.065, 0.055);
      foot.add(soleMesh);
      return { thighG, knee, foot };
    };
    this.legL = mkLeg(1);
    this.legR = mkLeg(-1);

    this.hips = hips;
    this.spine = spine;
    this.headG = headG;

    // Shadow casters (skip tiny parts)
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

    // Blended pose state
    this.cur = {
      hipsY: 0, spineRX: 0.04, spineRY: 0, spineRZ: 0, headRX: 0, headRY: 0,
      shLx: 0.1, shLz: 0.10, elL: 0.3, shRx: 0.1, shRz: 0.10, elR: 0.3,
      thLx: 0, thLz: 0.03, knL: 0.1, thRx: 0, thRz: 0.03, knR: 0.1,
      ftL: 0, ftR: 0,
    };
    this._carry = null;   // set per-frame when the rig should hold the ball
    this._t = 0;
  }

  /** Where the ball sits while this rig carries it. Returns false during dribble. */
  getBallCarryPos(out) {
    if (!this._carry) return false;
    out.copy(this._carry);
    this.group.localToWorld(out);
    return true;
  }

  _setCarry(x, y, z) {
    if (!this._carry) this._carry = new THREE.Vector3();
    this._carry.set(x, y, z);
  }

  /**
   * Compute the target pose from the player entity's state and blend toward it.
   * p: player entity (reads state, stateT, stateDur, speed2D, animPhase, dribblePhase,
   *    dribbleSide, hasBall, defending, jumpY, meterCharge)
   */
  updatePose(p, dt) {
    this._t += dt;
    const T = {};   // target pose (sparse; missing keys keep current)
    let rate = 14;
    this._carry = null;

    const ph = p.animPhase * Math.PI * 2;
    const spN = clamp01(p.speed2D / 7.0);

    const setRun = () => {
      const A = 0.16 + spN * 0.62;
      T.thLx = -Math.sin(ph) * A;
      T.thRx = Math.sin(ph) * A;
      T.knL = 0.16 + Math.max(0, Math.sin(ph - 1.5)) * A * 1.35;
      T.knR = 0.16 + Math.max(0, Math.sin(ph + Math.PI - 1.5)) * A * 1.35;
      T.thLz = 0.03; T.thRz = 0.03;
      T.hipsY = -0.02 + Math.abs(Math.sin(ph)) * 0.028 * spN - 0.02 * spN;
      T.spineRX = 0.06 + spN * 0.20;
      T.spineRY = Math.sin(ph) * 0.06 * spN;
      T.spineRZ = 0;
      // Arms pump opposite to legs
      T.shLx = Math.sin(ph) * A * 0.75;
      T.shRx = -Math.sin(ph) * A * 0.75;
      T.shLz = 0.10; T.shRz = 0.10;
      T.elL = 0.55 + spN * 0.5;
      T.elR = 0.55 + spN * 0.5;
      T.ftL = 0.1; T.ftR = 0.1;
      T.headRX = -0.05;
    };

    const setDribbleArm = () => {
      // Dribbling hand pumps in sync with the ball bounce
      const pump = 0.55 + Math.cos(p.dribblePhase * Math.PI * 2) * 0.38;
      if (p.dribbleSide === 1) {
        T.shLx = -0.45; T.shLz = 0.16;
        T.elL = pump;
      } else {
        T.shRx = -0.45; T.shRz = 0.16;
        T.elR = pump;
      }
      T.spineRX = Math.max(T.spineRX ?? 0.1, 0.14 + spN * 0.14);
    };

    switch (p.state) {
      case 'normal': {
        if (p.speed2D > 0.4) {
          setRun();
          if (p.hasBall) setDribbleArm();
        } else if (p.defending) {
          // Wide defensive stance
          const sway = Math.sin(this._t * 5.2 + p.index) * 0.03;
          T.hipsY = -0.17;
          T.thLx = -0.12; T.thRx = -0.12;
          T.thLz = 0.34; T.thRz = 0.34;
          T.knL = 0.72; T.knR = 0.72;
          T.spineRX = 0.34; T.spineRZ = sway;
          T.shLx = -0.35; T.shRx = -0.35;
          T.shLz = 0.95 + sway * 2; T.shRz = 0.95 - sway * 2;
          T.elL = 0.35; T.elR = 0.35;
          T.headRX = -0.22;
        } else {
          // Idle breathing
          const b = Math.sin(this._t * 1.8 + p.index * 1.3);
          T.hipsY = -0.03 + b * 0.006;
          T.thLx = 0; T.thRx = 0; T.thLz = 0.05; T.thRz = 0.05;
          T.knL = 0.10; T.knR = 0.10;
          T.spineRX = 0.05 + b * 0.012;
          T.spineRY = 0; T.spineRZ = 0;
          T.shLx = 0.06; T.shRx = 0.06; T.shLz = 0.09; T.shRz = 0.09;
          T.elL = 0.28; T.elR = 0.28;
          T.headRX = 0; T.headRY = 0;
          if (p.hasBall) setDribbleArm();
        }
        break;
      }

      case 'windup': {
        rate = 20;
        const u = clamp01(p.stateT / 0.22);
        const crouch = 0.10 + 0.10 * p.meterCharge;
        T.hipsY = -crouch;
        T.knL = 0.45 + crouch; T.knR = 0.45 + crouch;
        T.thLx = -0.25 - crouch * 0.5; T.thRx = -0.25 - crouch * 0.5;
        T.thLz = 0.08; T.thRz = 0.08;
        T.spineRX = 0.12;
        T.shRx = lerp(-0.6, -1.9, u); T.shRz = 0.12;
        T.elR = lerp(1.3, 1.05, u);
        T.shLx = lerp(-0.5, -1.55, u); T.shLz = 0.28;
        T.elL = 1.15;
        T.headRX = -0.18;
        const hy = lerp(1.28, 1.78, u) + p.meterCharge * 0.06;
        this._setCarry(0.10, hy, 0.34);
        break;
      }

      case 'release': {
        rate = 26;
        const u = clamp01(p.stateT / 0.20);
        T.shRx = lerp(-1.9, -2.75, u); T.shRz = 0.10;
        T.elR = lerp(1.0, 0.10, u);
        T.shLx = lerp(-1.55, -0.55, u); T.elL = 0.5;
        T.knL = 0.12; T.knR = 0.12;
        T.thLx = 0.05; T.thRx = -0.15;
        T.hipsY = 0.0;
        T.spineRX = 0.06;
        T.headRX = -0.3;
        if (!p.ballReleased) {
          this._setCarry(0.10, lerp(1.78, 2.06, u), lerp(0.34, 0.30, u));
        }
        break;
      }

      case 'jump': {   // defensive jump / contest
        rate = 22;
        T.shRx = -2.9; T.shLx = -2.9;
        T.shRz = 0.18; T.shLz = 0.18;
        T.elR = 0.06; T.elL = 0.06;
        T.knL = 0.3; T.knR = 0.3;
        T.thLx = -0.15; T.thRx = -0.15;
        T.spineRX = 0.02;
        T.headRX = -0.4;
        break;
      }

      case 'layup': {
        rate = 20;
        const u = clamp01(p.stateT / p.stateDur);
        T.thLx = -1.15; T.knL = 1.25;             // drive knee
        T.thRx = 0.25; T.knR = 0.55;
        T.spineRX = 0.10;
        const ext = clamp01((u - 0.3) / 0.4);
        T.shLx = lerp(-1.2, -2.7, ext); T.elL = lerp(0.9, 0.1, ext);
        T.shRx = -0.9; T.elR = 0.8;
        T.headRX = -0.35;
        if (!p.ballReleased) this._setCarry(0.12, lerp(1.35, 2.15, ext), 0.30);
        break;
      }

      case 'dunk': {
        rate = 22;
        const u = clamp01(p.stateT / p.stateDur);
        const raise = clamp01(u / 0.55);
        const slam = clamp01((u - 0.55) / 0.2);
        T.thLx = -1.0; T.knL = 1.15;
        T.thRx = 0.15; T.knR = 0.7;
        T.shLx = lerp(-0.8, -2.55, raise) + slam * 1.1;
        T.shRx = lerp(-0.8, -2.55, raise) + slam * 1.1;
        T.elL = lerp(0.8, 0.15, raise); T.elR = lerp(0.8, 0.15, raise);
        T.spineRX = lerp(-0.12, 0.30, slam);
        T.headRX = -0.3;
        if (!p.ballReleased) {
          const hy = lerp(1.35, 2.35, raise) - slam * 0.5;
          this._setCarry(0, hy, lerp(0.30, 0.45, raise));
        }
        break;
      }

      case 'stumble': {
        rate = 16;
        const w = Math.sin(this._t * 14) * 0.2;
        T.spineRX = 0.35; T.spineRZ = w;
        T.shLz = 0.8 + w; T.shRz = 0.8 - w;
        T.shLx = 0.3; T.shRx = -0.3;
        T.elL = 0.6; T.elR = 0.6;
        T.hipsY = -0.14;
        T.knL = 0.6; T.knR = 0.6;
        break;
      }

      case 'celebrate': {
        rate = 15;
        const pump = Math.sin(this._t * 9);
        if (p.celebrateStyle === 0) {
          T.shRx = -2.8 + pump * 0.25; T.elR = 0.35 + pump * 0.2; T.shRz = 0.15;
          T.shLx = -0.3; T.elL = 0.4;
        } else {
          T.shRx = -2.75 + pump * 0.15; T.shLx = -2.75 - pump * 0.15;
          T.elR = 0.2; T.elL = 0.2; T.shLz = 0.35; T.shRz = 0.35;
        }
        T.spineRX = -0.08;
        T.headRX = -0.35;
        T.hipsY = -0.02 + Math.abs(pump) * 0.03;
        T.knL = 0.15; T.knR = 0.15;
        break;
      }

      case 'land': {
        rate = 18;
        T.hipsY = -0.16;
        T.knL = 0.7; T.knR = 0.7;
        T.spineRX = 0.25;
        T.shLx = 0.15; T.shRx = 0.15; T.elL = 0.4; T.elR = 0.4;
        break;
      }
    }

    // Blend current toward target
    const k = 1 - Math.exp(-rate * dt);
    const c = this.cur;
    for (const key in T) c[key] += (T[key] - c[key]) * k;

    // Apply to the skeleton
    this.hips.position.y = HIP_Y + c.hipsY;
    this.spine.rotation.set(c.spineRX, c.spineRY, c.spineRZ);
    this.headG.rotation.set(c.headRX, c.headRY, 0);
    this.armL.shoulder.rotation.set(c.shLx, 0, c.shLz);
    this.armR.shoulder.rotation.set(c.shRx, 0, -c.shRz);
    this.armL.elbow.rotation.x = -c.elL;
    this.armR.elbow.rotation.x = -c.elR;
    this.legL.thighG.rotation.set(c.thLx, 0, c.thLz);
    this.legR.thighG.rotation.set(c.thRx, 0, -c.thRz);
    this.legL.knee.rotation.x = c.knL;
    this.legR.knee.rotation.x = c.knR;
    this.legL.foot.rotation.x = c.ftL;
    this.legR.foot.rotation.x = c.ftR;
  }
}

export function skinToneColor(idx) {
  return SKIN_TONES[clamp(idx, 0, SKIN_TONES.length - 1)];
}
