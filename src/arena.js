import * as THREE from '../vendor/three.module.js';
import { COURT, CORNER_BREAK_X } from './constants.js';
import { makeCanvas, canvasTexture, cssColor, clamp, clamp01, rand, pick, damp } from './utils.js';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Minimal merge of indexed BufferGeometries (position + normal only). */
function mergeGeometries(geoms) {
  let vCount = 0, iCount = 0;
  for (const g of geoms) {
    vCount += g.attributes.position.count;
    iCount += g.index.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ---------------------------------------------------------------------------
// Court floor texture
// ---------------------------------------------------------------------------

const FLOOR_W = COURT.LEN + COURT.APRON * 2;   // 33.45
const FLOOR_D = COURT.WID + COURT.APRON * 2;   // 20.04

function paintCourt() {
  const W = 2560;
  const H = Math.round(W * FLOOR_D / FLOOR_W); // ~1534
  const { canvas, ctx } = makeCanvas(W, H);
  const ppm = W / FLOOR_W;
  const cx = W / 2, cy = H / 2;
  const X = (m) => cx + m * ppm;   // court meters -> px
  const Y = (m) => cy + m * ppm;

  // Apron stain (dark walnut)
  ctx.fillStyle = '#4a2e1c';
  ctx.fillRect(0, 0, W, H);

  // Wood planks
  const paintPlanks = (x0, y0, x1, y1, base, vary) => {
    const plankH = 0.11 * ppm;
    const rows = Math.ceil((y1 - y0) / plankH);
    for (let r = 0; r < rows; r++) {
      const y = y0 + r * plankH;
      let x = x0 - rand(0, 2.2) * ppm;
      while (x < x1) {
        const len = rand(1.0, 2.4) * ppm;
        const l = base + rand(-vary, vary);
        ctx.fillStyle = `hsl(28, ${42 + rand(-5, 5)}%, ${l}%)`;
        ctx.fillRect(x, y, len - 1.2, plankH - 1.0);
        x += len;
      }
    }
  };
  // Apron planks (darker) then court planks (lighter maple)
  paintPlanks(0, 0, W, H, 24, 3);
  const cL = X(-COURT.HALF_LEN), cR = X(COURT.HALF_LEN);
  const cT = Y(-COURT.HALF_WID), cB = Y(COURT.HALF_WID);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cL, cT, cR - cL, cB - cT);
  ctx.clip();
  paintPlanks(cL, cT, cR, cB, 58, 4);
  // Grain streaks
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#7a4a24' : '#ffe0b0';
    ctx.fillRect(rand(cL, cR), rand(cT, cB), rand(8, 90), 1.2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  const LINE = '#f4f1ea';
  const lw = Math.max(2, 0.05 * ppm);
  ctx.lineWidth = lw;
  ctx.strokeStyle = LINE;
  ctx.fillStyle = LINE;
  ctx.lineCap = 'butt';

  // Painted key areas + center circle fill
  const keyPaint = '#1e2f52';
  for (const s of [-1, 1]) {
    const x0 = X(s * COURT.HALF_LEN), x1 = X(s * (COURT.HALF_LEN - 5.79));
    ctx.fillStyle = keyPaint;
    ctx.fillRect(Math.min(x0, x1), Y(-COURT.KEY_W / 2), Math.abs(x1 - x0), COURT.KEY_W * ppm);
  }
  ctx.fillStyle = keyPaint;
  ctx.beginPath();
  ctx.arc(cx, cy, COURT.CENTER_R * ppm, 0, Math.PI * 2);
  ctx.fill();

  // Boundary + halfcourt
  ctx.strokeStyle = LINE;
  ctx.strokeRect(cL, cT, cR - cL, cB - cT);
  ctx.beginPath(); ctx.moveTo(cx, cT); ctx.lineTo(cx, cB); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, COURT.CENTER_R * ppm, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 0.61 * ppm, 0, Math.PI * 2); ctx.stroke();

  for (const s of [-1, 1]) {
    const rimPx = X(s * COURT.RIM_X);
    const ftx = X(s * COURT.FT_X);
    // Key rectangle
    const x0 = X(s * COURT.HALF_LEN);
    ctx.strokeRect(Math.min(x0, ftx), Y(-COURT.KEY_W / 2), Math.abs(ftx - x0), COURT.KEY_W * ppm);
    // FT circle
    ctx.beginPath(); ctx.arc(ftx, cy, COURT.FT_CIRCLE_R * ppm, 0, Math.PI * 2); ctx.stroke();
    // Restricted arc
    ctx.beginPath();
    const a0 = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    ctx.arc(rimPx, cy, COURT.RESTRICTED_R * ppm, a0, a0 + Math.PI * (s > 0 ? 1 : 1), s > 0);
    ctx.stroke();
    // Three-point line: corner segments + arc
    const cbx = X(s * CORNER_BREAK_X);
    for (const zs of [-1, 1]) {
      const zc = Y(zs * COURT.THREE_CORNER_Z);
      ctx.beginPath(); ctx.moveTo(x0, zc); ctx.lineTo(cbx, zc); ctx.stroke();
    }
    const aCorner = Math.asin(COURT.THREE_CORNER_Z / COURT.THREE_R);
    ctx.beginPath();
    if (s > 0) ctx.arc(rimPx, cy, COURT.THREE_R * ppm, Math.PI - aCorner, Math.PI + aCorner);
    else ctx.arc(rimPx, cy, COURT.THREE_R * ppm, -aCorner, aCorner);
    ctx.stroke();
    // Lane hash marks
    for (const zs of [-1, 1]) {
      for (let i = 1; i <= 4; i++) {
        const hx = X(s * (COURT.HALF_LEN - 2.1 - i * 0.9));
        ctx.beginPath();
        ctx.moveTo(hx, Y(zs * COURT.KEY_W / 2));
        ctx.lineTo(hx, Y(zs * (COURT.KEY_W / 2 + 0.15)));
        ctx.stroke();
      }
    }
  }

  // Center logo
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#e8862a';
  ctx.beginPath(); ctx.arc(0, 0, 0.62 * ppm, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1a0f08'; ctx.lineWidth = lw * 0.8;
  ctx.beginPath(); ctx.arc(0, 0, 0.62 * ppm, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-0.62 * ppm, 0); ctx.lineTo(0.62 * ppm, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -0.62 * ppm); ctx.lineTo(0, 0.62 * ppm); ctx.stroke();
  ctx.beginPath(); ctx.arc(-0.62 * ppm, 0, 0.62 * ppm, -Math.PI / 3, Math.PI / 3); ctx.stroke();
  ctx.beginPath(); ctx.arc(0.62 * ppm, 0, 0.62 * ppm, Math.PI - Math.PI / 3, Math.PI + Math.PI / 3); ctx.stroke();
  ctx.fillStyle = '#f4f1ea';
  ctx.font = `900 ${0.42 * ppm}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#101725'; ctx.lineWidth = lw * 1.6;
  ctx.strokeText('FABLEMAX', 0, 1.22 * ppm);
  ctx.fillText('FABLEMAX', 0, 1.22 * ppm);
  ctx.restore();

  // Apron wordmarks
  ctx.fillStyle = '#d8c9a8';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${0.85 * ppm}px system-ui, sans-serif`;
  ctx.fillText('F A B L E M A X   A R E N A', cx, Y(COURT.HALF_WID + COURT.APRON / 2));
  ctx.save();
  ctx.translate(cx, Y(-COURT.HALF_WID - COURT.APRON / 2));
  ctx.rotate(Math.PI);
  ctx.fillText('F A B L E M A X   A R E N A', 0, 0);
  ctx.restore();

  return canvas;
}

// ---------------------------------------------------------------------------
// Net (verlet cloth cylinder hanging from the rim)
// ---------------------------------------------------------------------------

const NET_STRANDS = 12;
const NET_RINGS = 7;
const NET_LEN = 0.42;

export class Net {
  constructor(scene, hoop) {
    this.hoop = hoop;
    const N = NET_STRANDS * NET_RINGS;
    this.pos = new Float32Array(N * 3);
    this.prev = new Float32Array(N * 3);
    this.rest = [];

    // Init points in world space around the rim
    for (let j = 0; j < NET_RINGS; j++) {
      const t = j / (NET_RINGS - 1);
      const r = (COURT.RIM_R - 0.004) * (1 - t) + 0.125 * t;
      const y = hoop.rimCenter.y - t * NET_LEN;
      for (let i = 0; i < NET_STRANDS; i++) {
        const a = (i / NET_STRANDS) * Math.PI * 2;
        const k = (j * NET_STRANDS + i) * 3;
        this.pos[k] = hoop.rimCenter.x + Math.cos(a) * r;
        this.pos[k + 1] = y;
        this.pos[k + 2] = hoop.rimCenter.z + Math.sin(a) * r;
      }
    }
    this.prev.set(this.pos);

    // Diamond lattice constraints
    const id = (i, j) => j * NET_STRANDS + ((i + NET_STRANDS) % NET_STRANDS);
    const addC = (a, b) => {
      const dx = this.pos[a * 3] - this.pos[b * 3];
      const dy = this.pos[a * 3 + 1] - this.pos[b * 3 + 1];
      const dz = this.pos[a * 3 + 2] - this.pos[b * 3 + 2];
      this.rest.push([a, b, Math.hypot(dx, dy, dz)]);
    };
    const segs = [];
    for (let j = 0; j < NET_RINGS - 1; j++) {
      for (let i = 0; i < NET_STRANDS; i++) {
        addC(id(i, j), id(i + 1, j + 1)); segs.push(id(i, j), id(i + 1, j + 1));
        addC(id(i + 1, j), id(i, j + 1)); segs.push(id(i + 1, j), id(i, j + 1));
      }
    }
    // Bottom ring keeps its shape
    for (let i = 0; i < NET_STRANDS; i++) addC(id(i, NET_RINGS - 1), id(i + 1, NET_RINGS - 1));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setIndex(segs);
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xf5f5f5, transparent: true, opacity: 0.9 }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  splash(strength = 1) {
    // Kick the lower rings outward/down for a satisfying swish
    for (let j = 2; j < NET_RINGS; j++) {
      for (let i = 0; i < NET_STRANDS; i++) {
        const k = (j * NET_STRANDS + i) * 3;
        const a = (i / NET_STRANDS) * Math.PI * 2;
        this.prev[k] -= Math.cos(a) * 0.010 * strength * j;
        this.prev[k + 1] += 0.012 * strength * j;
        this.prev[k + 2] -= Math.sin(a) * 0.010 * strength * j;
      }
    }
  }

  update(dt, ballPos, ballR) {
    const p = this.pos, pr = this.prev;
    const damping = 0.965;
    const g = 2.6 * dt * dt;
    const N = NET_STRANDS * NET_RINGS;

    // Verlet integrate (skip pinned top ring)
    for (let n = NET_STRANDS; n < N; n++) {
      const k = n * 3;
      const x = p[k], y = p[k + 1], z = p[k + 2];
      p[k] += (x - pr[k]) * damping;
      p[k + 1] += (y - pr[k + 1]) * damping - g;
      p[k + 2] += (z - pr[k + 2]) * damping;
      pr[k] = x; pr[k + 1] = y; pr[k + 2] = z;
    }

    // Pin top ring to (possibly shaking) rim
    const rc = this.hoop.rimWorld;
    for (let i = 0; i < NET_STRANDS; i++) {
      const a = (i / NET_STRANDS) * Math.PI * 2;
      const k = i * 3;
      p[k] = rc.x + Math.cos(a) * (COURT.RIM_R - 0.004);
      p[k + 1] = rc.y;
      p[k + 2] = rc.z + Math.sin(a) * (COURT.RIM_R - 0.004);
    }

    // Ball collision (push points out of the ball)
    if (ballPos) {
      const rr = ballR + 0.015;
      for (let n = NET_STRANDS; n < N; n++) {
        const k = n * 3;
        const dx = p[k] - ballPos.x, dy = p[k + 1] - ballPos.y, dz = p[k + 2] - ballPos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < rr * rr && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (rr - d) / d;
          p[k] += dx * push; p[k + 1] += dy * push; p[k + 2] += dz * push;
        }
      }
    }

    // Constraints
    for (let iter = 0; iter < 3; iter++) {
      for (const [a, b, restLen] of this.rest) {
        const ka = a * 3, kb = b * 3;
        const dx = p[kb] - p[ka], dy = p[kb + 1] - p[ka + 1], dz = p[kb + 2] - p[ka + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (d - restLen) / d * 0.5;
        const pinA = a < NET_STRANDS, pinB = b < NET_STRANDS;
        const wA = pinA ? 0 : (pinB ? 1 : 0.5);
        const wB = pinB ? 0 : (pinA ? 1 : 0.5);
        p[ka] += dx * diff * wA * 2 * 0.5; p[ka + 1] += dy * diff * wA; p[ka + 2] += dz * diff * wA;
        p[kb] -= dx * diff * wB; p[kb + 1] -= dy * diff * wB; p[kb + 2] -= dz * diff * wB;
      }
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Hoop (backboard + rim + stanchion + net + spring shake)
// ---------------------------------------------------------------------------

function buildHoop(scene, sign, envMap) {
  const group = new THREE.Group();
  const rimCenter = new THREE.Vector3(sign * COURT.RIM_X, COURT.RIM_HEIGHT, 0);
  const boardX = sign * COURT.BOARD_X;
  const boardCY = COURT.BOARD_BOTTOM + COURT.BOARD_H / 2;

  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.85, envMap });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9 });

  // Stanchion: base + angled arm + vertical pad
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.15), padMat);
  base.position.set(sign * (COURT.HALF_LEN + 1.75), 0.25, 0);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.9, 0.32), padMat);
  post.position.set(sign * (COURT.HALF_LEN + 1.75), 1.7, 0);
  const armLen = Math.abs(post.position.x - boardX) + 0.2;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.16, 0.22), metal);
  arm.position.set((post.position.x + boardX) / 2, 3.35, 0);
  arm.rotation.z = sign * 0.10;
  group.add(base, post, arm);

  // Backboard glass
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, COURT.BOARD_H, COURT.BOARD_W),
    new THREE.MeshPhysicalMaterial({
      color: 0xcfe4f0, transparent: true, opacity: 0.30, roughness: 0.06,
      metalness: 0, clearcoat: 1, envMap, envMapIntensity: 1.4, side: THREE.DoubleSide,
    })
  );
  glass.position.set(boardX + sign * 0.02, boardCY, 0);
  group.add(glass);

  // Shooting square + border decal
  const { canvas: bc, ctx: bctx } = makeCanvas(512, 300);
  bctx.clearRect(0, 0, 512, 300);
  bctx.strokeStyle = '#f2f2f2'; bctx.lineWidth = 10;
  bctx.strokeRect(8, 8, 496, 284);
  bctx.strokeStyle = '#e33'; bctx.lineWidth = 8;
  const sqW = 512 * (0.59 / COURT.BOARD_W), sqH = 300 * (0.45 / COURT.BOARD_H);
  bctx.strokeRect(256 - sqW / 2, 300 - sqH - 24, sqW, sqH);
  const decalTex = canvasTexture(bc);
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT.BOARD_W, COURT.BOARD_H),
    new THREE.MeshBasicMaterial({ map: decalTex, transparent: true })
  );
  decal.position.set(boardX - sign * 0.001, boardCY, 0);
  decal.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
  group.add(decal);

  // Frame edges
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.5, metalness: 0.6 });
  for (const yOff of [-COURT.BOARD_H / 2, COURT.BOARD_H / 2]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, COURT.BOARD_W + 0.05), frameMat);
    bar.position.set(boardX, boardCY + yOff, 0);
    group.add(bar);
  }
  for (const zOff of [-COURT.BOARD_W / 2, COURT.BOARD_W / 2]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, COURT.BOARD_H + 0.05, 0.05), frameMat);
    bar.position.set(boardX, boardCY, zOff);
    group.add(bar);
  }

  // Rim assembly (in its own group so it can shake)
  const rimGroup = new THREE.Group();
  rimGroup.position.copy(rimCenter);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(COURT.RIM_R + COURT.RIM_TUBE, COURT.RIM_TUBE, 12, 36),
    new THREE.MeshStandardMaterial({ color: 0xd8481c, roughness: 0.35, metalness: 0.7, envMap })
  );
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = true;
  const plateLen = Math.abs(boardX - rimCenter.x);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(plateLen, 0.05, 0.11),
    new THREE.MeshStandardMaterial({ color: 0xd8481c, roughness: 0.4, metalness: 0.6 }));
  plate.position.set(sign * plateLen / 2, -0.045, 0);
  rimGroup.add(rim, plate);
  group.add(rimGroup);

  group.traverse((o) => { if (o.isMesh && o !== glass && o !== decal) o.castShadow = true; });
  scene.add(group);

  const hoop = {
    sign,
    rimCenter,
    rimWorld: rimCenter.clone(),   // rim center including shake offset (used by net + physics)
    boardX,
    group,
    rimGroup,
    springV: 0, springY: 0,
    net: null,
    shake(impulse) {
      this.springV -= impulse;
    },
    update(dt, ballPos, ballR) {
      // Damped spring on the rim
      const k = 260, c = 11;
      this.springV += (-k * this.springY - c * this.springV) * dt;
      this.springY += this.springV * dt;
      this.springY = clamp(this.springY, -0.09, 0.03);
      rimGroup.position.y = rimCenter.y + this.springY;
      rimGroup.rotation.z = sign * this.springY * 1.4;
      this.rimWorld.set(rimCenter.x, rimCenter.y + this.springY, rimCenter.z);
      this.net.update(dt, ballPos, ballR);
    },
  };
  hoop.net = new Net(scene, hoop);
  return hoop;
}

// ---------------------------------------------------------------------------
// Crowd
// ---------------------------------------------------------------------------

const CROWD_PALETTE = [0x30364a, 0x59616e, 0x8d5524, 0xb9b6ad, 0x24476b, 0x6e3140, 0x3c5b3f, 0xd9d4c8, 0x1f2430, 0x7d6f5a];

class Crowd {
  constructor(scene, quality, teamColors) {
    const seats = [];
    const ROWS = quality === 'low' ? 10 : 15;
    const stepD = 0.9, stepH = 0.46;

    // Stand structure (concrete steps) — merged look via few big boxes per side
    const standMat = new THREE.MeshStandardMaterial({ color: 0x191b22, roughness: 0.95 });
    const addStandSteps = (side) => {
      // side: 0=+z, 1=-z sidelines; 2=+x, 3=-x baselines
      for (let r = 0; r < ROWS; r++) {
        const y = r * stepH;
        const off = r * stepD;
        let geoW, geoD, px = 0, pz = 0;
        if (side < 2) {
          geoW = COURT.LEN + 6 + off * 1.6; geoD = stepD;
          pz = (COURT.HALF_WID + COURT.APRON + 1.6 + off + stepD / 2) * (side === 0 ? 1 : -1);
        } else {
          geoW = stepD; geoD = COURT.WID + 5 + off * 1.6;
          px = (COURT.HALF_LEN + COURT.APRON + 1.9 + off + stepD / 2) * (side === 2 ? 1 : -1);
        }
        const m = new THREE.Mesh(new THREE.BoxGeometry(side < 2 ? geoW : stepD, stepH + r * 0.0, side < 2 ? stepD : geoD), standMat);
        m.position.set(px, y + stepH / 2, pz);
        scene.add(m);
        // Seat positions on this step
        const along = side < 2 ? geoW - 3 : geoD - 3;
        const n = Math.floor(along / 0.58);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n - 0.5;
          let sx, sz, rotY;
          if (side < 2) {
            sx = t * along; sz = pz; rotY = side === 0 ? Math.PI : 0;
          } else {
            sx = px; sz = t * along; rotY = side === 2 ? -Math.PI / 2 : Math.PI / 2;
          }
          seats.push({ x: sx, y: y + stepH, z: sz, rotY });
        }
      }
    };
    addStandSteps(0); addStandSteps(1); addStandSteps(2); addStandSteps(3);

    // Person geometry: torso capsule + head sphere merged
    const torso = new THREE.CapsuleGeometry(0.17, 0.34, 3, 8);
    torso.translate(0, 0.48, 0);
    const head = new THREE.SphereGeometry(0.105, 8, 7);
    head.translate(0, 0.87, 0);
    const person = mergeGeometries([torso, head]);

    this.count = seats.length;
    this.mesh = new THREE.InstancedMesh(person, new THREE.MeshLambertMaterial(), this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    this.base = seats;
    this.phase = new Float32Array(this.count);
    this.amp = new Float32Array(this.count);
    const color = new THREE.Color();
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.count; i++) {
      this.phase[i] = rand(0, Math.PI * 2);
      this.amp[i] = rand(0.3, 1);
      const s = seats[i];
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rotY + rand(-0.25, 0.25), 0);
      const sc = rand(0.92, 1.06);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      const c = Math.random() < 0.34 ? pick(teamColors) : pick(CROWD_PALETTE);
      color.setHex(c).offsetHSL(0, 0, rand(-0.06, 0.06));
      this.mesh.setColorAt(i, color);
    }
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);

    this.excitement = 0.15;
    this._target = 0.15;
    this._dummy = dummy;
    this._t = 0;
    this._frame = 0;
  }

  excite(amount) { this._target = Math.min(1, this._target + amount); }

  update(dt) {
    this._t += dt;
    this._target = Math.max(0.15, this._target - dt * 0.22);
    this.excitement = damp(this.excitement, this._target, 3, dt);
    // Update half the instances per frame to keep this cheap
    this._frame ^= 1;
    const e = this.excitement;
    const t = this._t;
    const d = this._dummy;
    for (let i = this._frame; i < this.count; i += 2) {
      const s = this.base[i];
      const ph = this.phase[i];
      const bob = Math.sin(t * (1.6 + this.amp[i]) + ph) * 0.028 * (0.4 + e);
      let jump = 0;
      if (e > 0.45 && this.amp[i] > 0.55) {
        jump = Math.max(0, Math.sin(t * 4.2 + ph)) * 0.16 * (e - 0.4);
      }
      d.position.set(s.x, s.y + bob + jump, s.z);
      d.rotation.set(0, s.rotY + Math.sin(t * 0.7 + ph) * 0.1, 0);
      const sc = 1 + jump * 0.3;
      d.scale.set(1, sc, 1);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Jumbotron + LED ribbons + ads
// ---------------------------------------------------------------------------

class Jumbotron {
  constructor(scene) {
    const g = new THREE.Group();
    g.position.set(0, 11.4, 0);

    const { canvas, ctx } = makeCanvas(768, 432);
    this.canvas = canvas; this.ctx = ctx;
    this.tex = canvasTexture(canvas);
    this.tex.anisotropy = 4;

    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3.3, 5.4),
      new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.7, metalness: 0.4 }));
    g.add(frame);
    const screenMat = new THREE.MeshBasicMaterial({ map: this.tex });
    screenMat.color = new THREE.Color(2.2, 2.2, 2.2); // over-bright for glow feel
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 2.65), screenMat);
      const a = (i * Math.PI) / 2;
      s.position.set(Math.sin(a) * 2.72, 0, Math.cos(a) * 2.72);
      s.rotation.y = a;
      g.add(s);
    }
    // Cables
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x15161a });
    for (const [dx, dz] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6.5), cableMat);
      c.position.set(dx, 4.9, dz);
      g.add(c);
    }
    scene.add(g);
    this.group = g;
    this._last = '';
    this.flash = 0;
    this.flashText = '';
    this.render({ scoreA: 0, scoreB: 0, abbrA: 'HOME', abbrB: 'AWAY', colA: '#888', colB: '#888', period: 1, clock: 0, shot: 24 });
  }

  showFlash(text) { this.flash = 2.2; this.flashText = text; this._last = ''; }

  render(s) {
    const key = `${s.scoreA}|${s.scoreB}|${Math.ceil(s.clock)}|${s.period}|${Math.ceil(s.shot)}|${this.flash > 0}`;
    if (key === this._last) return;
    this._last = key;
    const c = this.ctx, W = 768, H = 432;
    c.fillStyle = '#05060c';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = '#2a3040'; c.lineWidth = 6; c.strokeRect(4, 4, W - 8, H - 8);

    if (this.flash > 0) {
      c.fillStyle = Math.floor(this.flash * 6) % 2 ? '#ffb020' : '#ff5020';
      c.font = '900 92px system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(this.flashText, W / 2, H / 2 - 40);
    } else {
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = s.colA; c.fillRect(40, 60, 250, 60);
      c.fillStyle = s.colB; c.fillRect(W - 290, 60, 250, 60);
      c.fillStyle = '#fff'; c.font = '800 44px system-ui, sans-serif';
      c.fillText(s.abbrA, 165, 92); c.fillText(s.abbrB, W - 165, 92);
      c.font = '900 120px system-ui, sans-serif'; c.fillStyle = '#ffdf80';
      c.fillText(String(s.scoreA), 165, 210); c.fillText(String(s.scoreB), W - 165, 210);
      c.fillStyle = '#e33'; c.font = '900 64px system-ui, sans-serif';
      const mm = Math.floor(s.clock / 60), ss = Math.floor(s.clock % 60);
      c.fillText(`${mm}:${String(ss).padStart(2, '0')}`, W / 2, 150);
      c.fillStyle = '#9fb4d8'; c.font = '700 36px system-ui, sans-serif';
      c.fillText(s.periodLabel || `Q${s.period}`, W / 2, 210);
      c.fillStyle = s.shot <= 5 ? '#ff4040' : '#ffb020';
      c.font = '900 56px system-ui, sans-serif';
      c.fillText(String(Math.max(0, Math.ceil(s.shot))), W / 2, 280);
    }
    c.fillStyle = '#f0902a'; c.font = '800 40px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('★ FABLEMAX NBA 3D ★', W / 2, H - 52);
    this.tex.needsUpdate = true;
  }

  update(dt, state) {
    this.group.rotation.y += dt * 0.06;
    if (this.flash > 0) { this.flash -= dt; if (this.flash <= 0) this._last = ''; }
    this.render(state);
  }
}

function buildRibbons(scene) {
  const { canvas, ctx } = makeCanvas(1024, 64);
  ctx.fillStyle = '#0a0c18'; ctx.fillRect(0, 0, 1024, 64);
  ctx.font = '900 40px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffb225';
  ctx.fillText('FABLEMAX NBA 3D', 20, 34);
  ctx.fillStyle = '#4488ff';
  ctx.fillText('★ DEE-FENSE ★', 420, 34);
  ctx.fillStyle = '#ff5533';
  ctx.fillText('MAKE SOME NOISE!', 700, 34);
  const tex = canvasTexture(canvas, { wrap: true });
  tex.repeat.set(4, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  mat.color = new THREE.Color(1.8, 1.8, 1.8);

  const y = 7.6, meshes = [];
  const mkRibbon = (w, x, z, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.72), mat);
    m.position.set(x, y, z); m.rotation.y = rotY;
    scene.add(m); meshes.push(m);
  };
  const sideDist = COURT.HALF_WID + COURT.APRON + 1.6 + 15 * 0.9 + 0.4;
  const baseDist = COURT.HALF_LEN + COURT.APRON + 1.9 + 15 * 0.9 + 0.4;
  mkRibbon(58, 0, sideDist, Math.PI);
  mkRibbon(58, 0, -sideDist, 0);
  mkRibbon(46, baseDist, 0, -Math.PI / 2);
  mkRibbon(46, -baseDist, 0, Math.PI / 2);
  return { update(dt) { tex.offset.x += dt * 0.06; } };
}

function buildCourtside(scene, teams, envMap) {
  const ads = ['FABLE AIR', 'SLAM SODA', 'HOOPNET+', 'MX MOTORS', 'CLUTCH COLA', 'BIG DUNK ENERGY'];
  const mkAdTex = (text, bg, fg) => {
    const { canvas, ctx } = makeCanvas(512, 96);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = fg; ctx.font = '900 52px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 50);
    return canvasTexture(canvas);
  };
  // Scorer's table row along -z sideline (broadcast side)
  const tableZ = COURT.HALF_WID + COURT.APRON * 0.55;
  const combos = [['#101425', '#ffb225'], ['#251010', '#ff6a3d'], ['#0e1e14', '#7dffb0'], ['#1a1030', '#c9a2ff']];
  for (let i = 0; i < 6; i++) {
    const w = 4.6;
    const x = (i - 2.5) * (w + 0.25);
    const [bg, fg] = combos[i % combos.length];
    const mat = new THREE.MeshBasicMaterial({ map: mkAdTex(ads[i % ads.length], bg, fg) });
    mat.color = new THREE.Color(1.6, 1.6, 1.6);
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, 0.78, 0.3), mat);
    box.position.set(x, 0.39, tableZ);
    scene.add(box);
  }
  // Benches on the -z far corners
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x232733, roughness: 0.8 });
  for (const [tx, team] of [[-9.5, teams[0]], [9.5, teams[1]]]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.5, 0.7), benchMat);
    bench.position.set(tx, 0.25, tableZ + 0.1);
    scene.add(bench);
    const back = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.55, 0.1),
      new THREE.MeshStandardMaterial({ color: team ? team.primary : 0x333, roughness: 0.7 }));
    back.position.set(tx, 0.75, tableZ + 0.42);
    scene.add(back);
  }
}

// ---------------------------------------------------------------------------
// Environment map (tiny synthetic "arena" for PBR reflections)
// ---------------------------------------------------------------------------

function makeEnvMap(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  const mk = (x, y, z, w, h, d, color, intensity) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
    m.position.set(x, y, z);
    scene.add(m);
  };
  mk(0, 9, 0, 6, 0.5, 6, 0xfff4e0, 14);       // overhead rig
  mk(-8, 8, -6, 3, 0.4, 3, 0xffe8c8, 9);
  mk(8, 8, 6, 3, 0.4, 3, 0xffe8c8, 9);
  mk(8, 8, -6, 3, 0.4, 3, 0xdfe8ff, 8);
  mk(-8, 8, 6, 3, 0.4, 3, 0xdfe8ff, 8);
  mk(0, 2, -14, 20, 3, 0.5, 0x2a3a5f, 1.4);   // dim stands glow
  mk(0, 2, 14, 20, 3, 0.5, 0x2a3a5f, 1.4);
  mk(0, -1, 0, 30, 0.5, 30, 0xc89050, 0.7);   // floor bounce light
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.035).texture;
  pmrem.dispose();
  return tex;
}

// ---------------------------------------------------------------------------
// Arena assembly
// ---------------------------------------------------------------------------

export function buildArena(scene, renderer, quality, teams) {
  const envMap = makeEnvMap(renderer);
  scene.environment = envMap;
  scene.background = new THREE.Color(0x030409);
  scene.fog = new THREE.FogExp2(0x05060c, 0.0075);

  // Floor
  const courtTex = canvasTexture(paintCourt(), { aniso: 16 });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_W, FLOOR_D),
    new THREE.MeshPhysicalMaterial({
      map: courtTex, roughness: 0.55, metalness: 0.0,
      clearcoat: 0.55, clearcoatRoughness: 0.32, envMap, envMapIntensity: 0.65,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Surrounding concourse floor
  const surround = new THREE.Mesh(
    new THREE.CircleGeometry(70, 48),
    new THREE.MeshStandardMaterial({ color: 0x0a0b12, roughness: 0.95 })
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.02;
  scene.add(surround);

  // Hoops
  const hoops = [buildHoop(scene, -1, envMap), buildHoop(scene, 1, envMap)];

  // Crowd + stands
  const teamColors = [teams[0].primary, teams[0].secondary, teams[1].primary, teams[1].secondary];
  const crowd = new Crowd(scene, quality, teamColors);

  // Upper bowl backdrop: dark cylinder with pinprick "distant crowd" lights
  {
    const { canvas, ctx } = makeCanvas(1024, 256);
    ctx.fillStyle = '#07080e'; ctx.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 2600; i++) {
      const a = Math.random();
      ctx.fillStyle = a < 0.12 ? '#3d4a66' : (a < 0.2 ? '#54402a' : '#181c28');
      ctx.fillRect(rand(0, 1024), rand(30, 256), 2, 2);
    }
    const tex = canvasTexture(canvas, { wrap: true });
    tex.repeat.set(6, 1);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 34, 16, 40, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })
    );
    wall.position.y = 13;
    scene.add(wall);
    // Roof
    const roof = new THREE.Mesh(new THREE.CircleGeometry(48, 40),
      new THREE.MeshBasicMaterial({ color: 0x040508 }));
    roof.rotation.x = Math.PI / 2;
    roof.position.y = 21;
    scene.add(roof);
  }

  // Lighting
  const hemi = new THREE.HemisphereLight(0x39435c, 0x1c150e, 0.75);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2df, 2.4);
  key.position.set(7, 18, 5);
  key.castShadow = quality !== 'low';
  key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  key.shadow.camera.left = -19; key.shadow.camera.right = 19;
  key.shadow.camera.top = 13; key.shadow.camera.bottom = -13;
  key.shadow.camera.near = 4; key.shadow.camera.far = 40;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  scene.add(key, key.target);

  const rig = new THREE.Group();
  for (const [x, z] of [[-10, -7], [10, -7], [-10, 7], [10, 7]]) {
    const spot = new THREE.SpotLight(0xffeed8, 2.1, 0, 0.62, 0.65, 0);
    spot.position.set(x, 14, z);
    spot.target.position.set(x * 0.25, 0, z * 0.25);
    rig.add(spot, spot.target);
    // Fixture + volumetric-ish cone
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.5, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
    fixture.position.set(x, 14, z);
    rig.add(fixture);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(4.4, 14, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0.028, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    cone.position.set(x * 0.85, 7, z * 0.85);
    rig.add(cone);
  }
  // Truss ring
  const truss = new THREE.Mesh(new THREE.TorusGeometry(13, 0.22, 6, 40),
    new THREE.MeshStandardMaterial({ color: 0x22252e, roughness: 0.6, metalness: 0.7 }));
  truss.rotation.x = Math.PI / 2;
  truss.position.y = 14.2;
  rig.add(truss);
  scene.add(rig);

  // Jumbotron / ribbons / courtside dressing
  const jumbo = new Jumbotron(scene);
  const ribbons = buildRibbons(scene);
  buildCourtside(scene, teams, envMap);

  return {
    hoops,
    crowd,
    jumbo,
    envMap,
    update(dt, jumboState, ballPos, ballR) {
      crowd.update(dt);
      ribbons.update(dt);
      jumbo.update(dt, jumboState);
      for (const h of hoops) h.update(dt, ballPos, ballR);
    },
  };
}
