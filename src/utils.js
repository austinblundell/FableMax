import * as THREE from '../vendor/three.module.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Gaussian sample, mean 0, sd 1 (Box-Muller). */
export function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));

export function dampV3(cur, target, lambda, dt) {
  const t = 1 - Math.exp(-lambda * dt);
  cur.x += (target.x - cur.x) * t;
  cur.y += (target.y - cur.y) * t;
  cur.z += (target.z - cur.z) * t;
  return cur;
}

/** Shortest signed angular difference b-a in [-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(cur, target, lambda, dt) {
  return cur + angleDelta(cur, target) * (1 - Math.exp(-lambda * dt));
}

export const smoothstep = (t) => t * t * (3 - 2 * t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => { const c = 1.70158; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

export function dist2D(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

/** Sample a keyframe curve: keys = [[t, value], ...] sorted by t. Linear interp. */
export function sampleCurve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return lerp(v0, v1, (t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

export function canvasTexture(canvas, { srgb = true, aniso = 8, wrap = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  if (wrap) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export const cssColor = (hex) => '#' + hex.toString(16).padStart(6, '0');

/** Vertical dribble position of the ball for a given phase (cycles once per unit). */
export function dribbleY(phase, topY, ballR) {
  const u = phase % 1;
  const b = Math.abs(Math.cos(Math.PI * u));
  return ballR + (topY - ballR) * Math.pow(b, 1.4);
}

// Scratch vectors for hot paths (never store references to these).
export const V1 = new THREE.Vector3();
export const V2 = new THREE.Vector3();
export const V3 = new THREE.Vector3();
