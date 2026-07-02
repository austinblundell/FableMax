import * as THREE from '../vendor/three.module.js';
import { clamp, dampV3 } from './utils.js';

const MODES = ['broadcast', 'player', 'baseline'];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.modeIdx = 0;
    this.cinematic = true;
    this.pos = new THREE.Vector3(0, 12, 24);
    this.look = new THREE.Vector3(0, 1, 0);
    this._wantPos = new THREE.Vector3();
    this._wantLook = new THREE.Vector3();
    this._cineT = 0;
  }

  get mode() { return MODES[this.modeIdx]; }

  cycle() { this.modeIdx = (this.modeIdx + 1) % MODES.length; }

  /** Yaw of the camera's flattened forward (for input mapping). */
  get yawForward() {
    const f = this.look.clone().sub(this.pos);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    return f;
  }

  update(dt, game) {
    const ball = game.ball;
    const wp = this._wantPos, wl = this._wantLook;
    let lambda = 3.2;

    if (this.cinematic) {
      this._cineT += dt * 0.09;
      const a = this._cineT;
      const r = 24 + Math.sin(a * 0.7) * 4;
      wp.set(Math.cos(a) * r, 8.5 + Math.sin(a * 0.43) * 3.2, Math.sin(a) * r);
      wl.set(0, 2.2, 0);
      lambda = 1.6;
    } else if (this.mode === 'broadcast' || (!game.controlled && this.mode === 'player')) {
      const bx = clamp(ball.pos.x, -13, 13);
      wp.set(clamp(bx * 0.62, -8.6, 8.6), 9.6, 20.4);
      wl.set(bx * 0.82, 1.4, clamp(ball.pos.z * 0.28, -2.2, 2.2));
      lambda = 3.4;
    } else if (this.mode === 'player') {
      const c = game.controlled;
      const hoop = game.attackedHoop(game.userTeam >= 0 ? game.userTeam : 0);
      const dir = new THREE.Vector3(hoop.rimCenter.x - c.pos.x, 0, hoop.rimCenter.z - c.pos.z);
      if (dir.lengthSq() < 0.01) dir.set(game.attackSign(c.team), 0, 0);
      dir.normalize();
      wp.set(c.pos.x - dir.x * 7.6, 4.1, c.pos.z - dir.z * 7.6);
      wl.set(c.pos.x + dir.x * 5.0, 1.1, c.pos.z + dir.z * 5.0);
      lambda = 4.2;
    } else { // baseline
      const hoop = game.attackedHoop(game.possession);
      const s = hoop.sign;
      wp.set(s * 10.2, 2.6, 11.8);
      wl.set(s * 9.0, 2.2, 0);
      lambda = 2.6;
    }

    dampV3(this.pos, wp, lambda, dt);
    dampV3(this.look, wl, lambda, dt);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  snap() {
    this.pos.copy(this._wantPos.lengthSq() ? this._wantPos : this.pos);
    this.look.copy(this._wantLook.lengthSq() ? this._wantLook : this.look);
  }
}
