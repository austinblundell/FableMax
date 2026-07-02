import * as THREE from '../vendor/three.module.js';
import { COURT, TUNE } from './constants.js';
import { buildArena } from './arena.js';
import { Ball } from './ball.js';
import { Game } from './game.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { CameraRig } from './cameras.js';
import { AudioEngine } from './audio.js';
import { MaterialCache } from './playerModel.js';
import { TEAMS } from './constants.js';

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 220);
camera.position.set(0, 12, 24);

const arena = buildArena(scene, renderer, 'high', [TEAMS[0], TEAMS[1]]);
const matCache = new MaterialCache(arena.envMap);
const ball = new Ball(scene, arena.envMap);
const audio = new AudioEngine();
const hud = new HUD(document.getElementById('hud'));
const input = new Input(window);
const cameraRig = new CameraRig(camera);

const game = new Game({ scene, arena, ball, audio, hud, matCache });

// ---------------------------------------------------------------------------
// Menu wiring / match lifecycle
// ---------------------------------------------------------------------------

let inMenu = true;

function applyQuality(q) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
  renderer.shadowMap.enabled = q !== 'low';
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
}

function startDemo() {
  inMenu = true;
  input.enabled = false;
  cameraRig.cinematic = true;
  game.setupMatch({ teamA: 0, teamB: 1, userTeam: -1, quarterMinutes: 5 });
  hud.showMenu();
}

function quitToMenu() {
  hud.hideModal();
  game.paused = false;
  startDemo();
}

hud.onStart = (sel) => {
  audio.init();
  audio.uiClick();
  applyQuality(sel.quality);
  inMenu = false;
  input.enabled = true;
  cameraRig.cinematic = false;
  cameraRig.modeIdx = 0;
  hud.hideMenu();
  game.setupMatch({ teamA: sel.user, teamB: sel.opp, userTeam: 0, quarterMinutes: sel.quarters });
};

game.onGameEnd = () => {
  hud.showEnd(game, { onAgain: quitToMenu });
};

function togglePause() {
  if (inMenu || game.state === 'end') return;
  game.paused = !game.paused;
  if (game.paused) {
    hud.showPause(game, {
      onResume: () => { game.paused = false; hud.hideModal(); },
      onRestart: quitToMenu,
      onMute: () => { audio.setMuted(!audio.muted); return audio.muted; },
      muted: audio.muted,
    });
  } else {
    hud.hideModal();
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
let timeScale = 1;   // debug/testing hook

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Global keys work even in demo
  if (input.justPressed('pause')) togglePause();
  if (input.justPressed('camera') && !inMenu) cameraRig.cycle();
  if (input.justPressed('mute')) audio.setMuted(!audio.muted);
  if (input.justPressed('help')) hud.toggleHint();

  if (!game.paused) {
    input.computeWorldMove(cameraRig.yawForward);
    const steps = Math.max(1, Math.round(timeScale));
    for (let i = 0; i < steps; i++) game.update(dt, inMenu ? null : input);
    arena.update(dt, game.hudState(), ball.pos, COURT.BALL_R);
    audio.update(dt);
  }

  cameraRig.update(dt, game);
  if (!inMenu) hud.perFrame(game);
  input.endFrame();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Unlock audio on any first interaction (some browsers require a gesture)
window.addEventListener('pointerdown', () => audio.init(), { once: true });

startDemo();
frame();

// Debug / test hooks
function step(seconds, dtStep = 1 / 60) {
  // Deterministic render-independent simulation (headless tests, slow machines)
  const n = Math.round(seconds / dtStep);
  for (let i = 0; i < n; i++) {
    input.computeWorldMove(cameraRig.yawForward);
    if (input.justPressed('pause')) togglePause();
    if (!game.paused) game.update(dtStep, inMenu ? null : input);
    input.endFrame();
  }
}

window.__fable = {
  game, ball, arena, renderer, scene, camera, cameraRig, audio, input, hud,
  setTimeScale: (v) => { timeScale = v; },
  step,
  version: 1,
};
