// Porto Verde — main.js: bootstrap and game loop.
// Wires world, player, vehicles and traffic together, owns the shared state
// object and the input, and leaves stub hooks for the slices that follow
// (police, missions, HUD, audio). Nothing here plays a mission or a siren.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { createPlayer, updatePlayer, updateCamera } from './player.js';
import { createVehicleSystem, updateDrive } from './vehicles.js';
import { createTraffic } from './traffic.js';

// ---------------------------------------------------------------- state
// The one shared state object. Later slices read and write these fields;
// this slice only owns phase, inCar and the player's money/health basics.
export const state = {
  phase: 'menu',        // 'menu' | 'playing'
  wanted: 0,            // 0–5, owned by the police slice
  money: 250,           // dollars, owned by the mission slice
  health: 100,
  mission: null,        // owned by the mission slice; a stub object in ?shot=mission
  inCar: false,
  timeMinutes: 16 * 60 + 20, // late afternoon
  carName: null,
};

// ---------------------------------------------------------------- hooks
// Extension points for slices 2 and 3. Each is a no-op until its slice
// replaces it; the world/driving slice never calls into police or missions
// beyond these names.
export const hooks = {
  onWantedChange(_level) {},          // slice 2: police response
  onMissionEvent(_name, _data) {},    // slice 2: mission progress
  onEnterCar(_car) {},                // slice 2: HUD + audio cue
  onExitCar(_car) {},                 // slice 2: HUD + audio cue
  updateHUD() {},                     // slice 2: HUD refresh
  playSound(_name) {},                // slice 3: synthesised audio
};

// ---------------------------------------------------------------- setup
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 12, -20);

const world = buildWorld(scene);
const player = createPlayer(scene, world);
const vehicles = createVehicleSystem(scene, world);
const traffic = createTraffic(scene, world, vehicles);

// Mission marker stub: a glowing ring at the meeting point. Slice 2 turns
// it into a real objective; slice 1 only shows where to stand.
const marker = new THREE.Mesh(
  new THREE.TorusGeometry(1.4, 0.12, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0xffd166 }),
);
marker.rotation.x = Math.PI / 2;
marker.position.set(world.missionPoint.x, 0.6, world.missionPoint.z);
marker.visible = false;
scene.add(marker);

// ---------------------------------------------------------------- input
const keys = new Set();
let camYaw = Math.PI; // behind the player at spawn (player faces +z at start)
let camPitch = 0.22;
let pointerLocked = false;

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyS' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveGame(); return; }
  keys.add(e.code);
  if (e.code === 'KeyE' && state.phase === 'playing') toggleCar();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function lockPointer() {
  try {
    const p = renderer.domElement.requestPointerLock?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* pointer lock unavailable (e.g. headless) — mouse-look just stays off */ }
}

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || state.phase !== 'playing') return;
  camYaw -= e.movementX * 0.0028;
  camPitch = Math.max(-0.15, Math.min(0.7, camPitch + e.movementY * 0.0022));
});
renderer.domElement.addEventListener('click', () => {
  if (state.phase === 'playing' && !pointerLocked) lockPointer();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});
// Arrow keys turn the camera when the pointer is not locked (also how the
// headless play-test steers the view).
function arrowCamera(dt) {
  if (keys.has('ArrowLeft')) camYaw += 1.8 * dt;
  if (keys.has('ArrowRight')) camYaw -= 1.8 * dt;
}

function toggleCar() {
  if (vehicles.current) {
    const car = vehicles.exit();
    state.inCar = false;
    state.carName = null;
    // Step out beside the car.
    player.pos.set(car.pos.x + Math.cos(car.heading) * 2.2, 0, car.pos.z - Math.sin(car.heading) * 2.2);
    player.mesh.visible = true;
    hooks.onExitCar(car);
  } else {
    const car = vehicles.nearestCar(player.pos);
    if (!car) { toast('No car close enough — walk up to one and press E'); return; }
    vehicles.enter(car);
    state.inCar = true;
    state.carName = car.name;
    player.mesh.visible = false;
    hooks.onEnterCar(car);
    toast(`You took the ${car.name}. Drive with W A S D — E to get out.`);
  }
  hooks.updateHUD();
}

let toastTimer = 0;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

// ---------------------------------------------------------------- save
// Minimal save: position, money, health and time to localStorage. The HUD
// slice surfaces it; the shape is stable for later slices.
const SAVE_KEY = 'porto-verde-save-v1';
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      x: player.pos.x, z: player.pos.z,
      money: state.money, health: state.health, timeMinutes: state.timeMinutes,
    }));
    toast('Game saved.');
  } catch { /* storage unavailable — play on without saving */ }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    player.pos.set(s.x, 0, s.z);
    state.money = s.money ?? state.money;
    state.health = s.health ?? state.health;
    state.timeMinutes = s.timeMinutes ?? state.timeMinutes;
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- shots
// Deterministic start states for screenshots (?shot=start|drive|chase|mission).
function applyShot(shot) {
  if (shot === 'drive' || shot === 'chase') {
    const car = vehicles.cars[0];
    vehicles.enter(car);
    state.inCar = true;
    state.carName = car.name;
    player.mesh.visible = false;
    car.pos.set(world.playerSpawn.x, 0, world.playerSpawn.z);
    car.heading = Math.PI / 2;
    car.speed = shot === 'chase' ? 14 : 0;
    if (shot === 'chase') {
      state.wanted = 2; // visual only here; police arrive in slice 2
      for (let i = 0; i < 2; i++) {
        const t = traffic.cars[i];
        t.pos.set(car.pos.x - 10 - i * 8, 0, car.pos.z + (i === 0 ? 4 : -4));
        t.heading = Math.PI / 2;
      }
    }
  } else if (shot === 'mission') {
    state.mission = { id: 'meet-rio', title: 'Meet Rio at Marina Verde park', status: 'active' };
    marker.visible = true;
    player.pos.set(world.missionPoint.x - 6, 0, world.missionPoint.z + 4);
    camYaw = Math.PI * 0.75;
  }
  // 'start' (and anything else): on foot at the spawn, as built.
}

// ---------------------------------------------------------------- start
const startScreen = document.getElementById('start-screen');
function beginPlay() {
  if (state.phase === 'playing') return;
  state.phase = 'playing';
  startScreen.style.display = 'none';
  lockPointer();
}
startScreen.addEventListener('click', beginPlay);

// ?shot= states start playing at once (screenshots + headless tests).
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
if (shot) {
  loadGame();
  applyShot(shot);
  beginPlay();
}

// ---------------------------------------------------------------- debug
// Small read-only hook for headless verification. Later slices may extend
// it; they must not use it to play the game for the player.
window.__game = {
  state,
  ready: true,
  errors: [],
  get playerPos() { return { x: player.pos.x, z: player.pos.z }; },
  get speed() { return vehicles.current ? vehicles.current.speed : player.speed; },
  get inCar() { return state.inCar; },
  get trafficCars() { return traffic.cars.length; },
  get pedestrians() { return traffic.peds.length; },
  get parkedCars() { return vehicles.cars.length; },
  get buildings() { return world.buildingCount; },
  get cars() { return vehicles.cars.map((c) => ({ name: c.name, x: c.pos.x, z: c.pos.z })); },
  // Test-only helpers: move the player (on foot) and read traffic state.
  teleport(x, z) { if (!state.inCar) player.pos.set(x, 0, z); return { x: player.pos.x, z: player.pos.z }; },
  get trafficState() {
    return {
      cars: traffic.cars.map((c) => ({ x: +c.pos.x.toFixed(1), z: +c.pos.z.toFixed(1), stopped: c.stopped })),
      peds: traffic.peds.map((p) => ({ x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1) })),
    };
  },
  shot: shot || 'start',
};
window.addEventListener('error', (e) => window.__game.errors.push(String(e.message)));

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let frames = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.phase === 'playing') {
    arrowCamera(dt);
    traffic.update(dt);
    if (vehicles.current) {
      updateDrive(vehicles, world, keys, dt);
      updateCamera(camera, vehicles.current.pos, camYaw, camPitch, 9);
    } else {
      updatePlayer(player, world, keys, camYaw, dt);
      updateCamera(camera, player.pos, camYaw, camPitch, 7);
    }
    marker.rotation.z += dt * 0.8;
  }
  renderer.render(scene, camera);
  frames++;
  if (frames === 30) console.log('PORTO VERDE READY shot=' + (shot || 'start') + ' buildings=' + world.buildingCount);
}
loop();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
