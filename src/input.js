const ACTION_KEYS = {
  shoot: ['Space'],
  pass: ['KeyE'],
  switch: ['KeyQ'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  camera: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  mute: ['KeyM'],
  help: ['KeyH'],
};

const MOVE_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this.worldMove = { x: 0, z: 0 };
    this.enabled = true;

    target.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this._pressed.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      this.down.delete(e.code);
      this._released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
    });
  }

  _any(codes, set) {
    for (const c of codes) if (set.has(c)) return true;
    return false;
  }

  held(action) { return this._any(ACTION_KEYS[action] || [], this.down); }
  justPressed(action) { return this.enabled && this._any(ACTION_KEYS[action] || [], this._pressed); }
  justReleased(action) { return this.enabled && this._any(ACTION_KEYS[action] || [], this._released); }

  get sprint() { return this.enabled && this.held('sprint'); }

  /** Raw move axes: x = right on screen, y = up on screen. */
  rawMove() {
    let x = 0, y = 0;
    if (this._any(MOVE_KEYS.right, this.down)) x += 1;
    if (this._any(MOVE_KEYS.left, this.down)) x -= 1;
    if (this._any(MOVE_KEYS.up, this.down)) y += 1;
    if (this._any(MOVE_KEYS.down, this.down)) y -= 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  /** Map screen-relative movement into world space given the camera's flattened forward. */
  computeWorldMove(fwd) {
    if (!this.enabled) { this.worldMove.x = 0; this.worldMove.z = 0; return; }
    const { x, y } = this.rawMove();
    // right = forward x up (flattened)
    const rx = -fwd.z, rz = fwd.x;
    this.worldMove.x = rx * x + fwd.x * y;
    this.worldMove.z = rz * x + fwd.z * y;
  }

  endFrame() {
    this._pressed.clear();
    this._released.clear();
  }

  /** For scripted tests: simulate a key event. */
  simulate(code, isDown) {
    if (isDown) { this.down.add(code); this._pressed.add(code); }
    else { this.down.delete(code); this._released.add(code); }
  }
}
