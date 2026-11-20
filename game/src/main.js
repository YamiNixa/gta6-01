// Porto Verde — main.js: bootstrap and game loop.
// Wires world, player, vehicles and traffic together, owns the shared state
// object and the input, and leaves stub hooks for the slices that follow
// (police, missions, HUD, audio). Nothing here plays a mission or a siren.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { createPlayer, updatePlayer, updateCamera } from './player.js';
import { createVehicleSystem, updateDrive } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createPolice } from './police.js';
import { createMissions } from './missions.js';
import { createCombat } from './combat.js';
import { createSave } from './save.js';
import { createHUD } from './hud.js';
import { createAudio } from './audio.js';

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
  paused: false,
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

// Slice 2 systems: police, missions, combat, save. They share the state
// object and the player's live position (on foot or in the car).
const livePos = () => (state.inCar && vehicles.current ? vehicles.current.pos : player.pos);
function handleBusted() {
  if (vehicles.current) {
    vehicles.exit();
    state.inCar = false;
    state.carName = null;
    player.mesh.visible = true;
  }
  state.money = Math.max(0, state.money - 150);
  state.health = Math.max(state.health, 50);
  player.pos.set(world.playerSpawn.x, 0, world.playerSpawn.z);
  if (hud) { hud.showBanner('BUSTED', 1800); }
  if (audio) audio.play('fail');
  hooks.updateHUD();
}
function handleDeath() {
  if (vehicles.current) {
    vehicles.exit();
    state.inCar = false;
    state.carName = null;
    player.mesh.visible = true;
  }
  state.money = Math.max(0, state.money - 100);
  state.health = 100;
  player.pos.set(world.playerSpawn.x, 0, world.playerSpawn.z);
  toast('You were taken out — $100 hospital bill. Back at the Marina.');
  if (hud) hud.showBanner('WASTED', 1800);
  if (audio) audio.play('fail');
  hooks.updateHUD();
}
const police = createPolice(scene, world, {
  state,
  getPlayerPos: livePos,
  isInCar: () => state.inCar,
  getPlayerSpeed: () => (vehicles.current ? vehicles.current.speed : player.speed),
  toast,
  onWantedChange: (level) => hooks.onWantedChange(level),
  onBusted: handleBusted,
});
const combat = createCombat(scene, world, {
  state,
  getPlayerPos: livePos,
  getAimYaw: () => camYaw,
  isInCar: () => state.inCar,
  getPeds: () => traffic.peds,
  toast,
  addCrime: (stars, label) => police.addCrime(stars, label),
  onPlayerDeath: handleDeath,
  onEnemyKilled: (enemy) => hooks.onMissionEvent('enemy-down', { name: enemy.name }),
  onShoot: () => { muzzleFlash(); audio && audio.play('shot'); },
  onPunch: () => { audio && audio.play('punch'); },
});
const missions = createMissions(scene, world, {
  state,
  getPlayerPos: livePos,
  isInCar: () => state.inCar,
  toast,
  onMissionEvent: (name, data) => hooks.onMissionEvent(name, data),
  saveGame: () => saveSys.autoSave(),
  spawnEnemy: (x, z, opts) => combat.spawnEnemy(x, z, { ...opts, mission: true }),
  missionEnemiesAlive: () => combat.enemies.filter((e) => e.mission).length,
});
const saveSys = createSave({
  state,
  getPlayerPos: () => player.pos,
  setPlayerPos: (x, z) => player.pos.set(x, 0, z),
  getMissionProgress: () => missions.getProgress(),
  setMissionProgress: (p) => missions.setProgress(p),
  getAmmo: () => combat.ammo,
  getReserve: () => combat.reserve,
  setAmmo: (a, r) => combat.setAmmo(a, r),
  getCarState: () => {
    if (!vehicles.current) return null;
    const car = vehicles.current;
    return { index: vehicles.cars.indexOf(car), x: car.pos.x, z: car.pos.z, heading: car.heading };
  },
  setCarState: (c) => {
    const car = vehicles.cars[c.index];
    if (!car) return;
    car.pos.set(c.x, 0, c.z);
    car.heading = c.heading;
    car.mesh.rotation.y = c.heading;
    vehicles.enter(car);
    state.inCar = true;
    state.carName = car.name;
    player.mesh.visible = false;
  },
  toast,
});

// ---------------------------------------------------------------- hud+audio
// Slice 3: the HUD reads the shared state and the live positions; the
// audio engine synthesises every sound. Both are created here so the
// hooks above can reach them.
const audio = createAudio();
let flashLight = null;
let flashTime = 0;
function muzzleFlash() {
  if (!flashLight) {
    flashLight = new THREE.PointLight(0xffc860, 0, 14);
    scene.add(flashLight);
  }
  const p = livePos();
  flashLight.position.set(p.x, 1.6, p.z);
  flashLight.intensity = 26;
  flashTime = 0.07;
}
const hud = createHUD({
  state,
  world,
  getPlayerPos: livePos,
  getCamYaw: () => camYaw,
  getSpeed: () => (vehicles.current ? vehicles.current.speed : player.speed),
  getAmmo: () => ({ mag: combat.ammo, reserve: combat.reserve }),
  getMissionTarget: () => missions.getTarget(),
  getTrafficCars: () => traffic.cars,
  getPeds: () => traffic.peds,
  getPolice: () => police.units,
  getParkedCars: () => vehicles.cars.filter((c) => c.parked),
});
hooks.updateHUD = () => hud.refresh();
hooks.playSound = (name) => audio.play(name);
hooks.onWantedChange = (level) => { if (level > 0) hud.showBanner(`WANTED — ${level} STAR${level > 1 ? 'S' : ''}`, 1200); };
hooks.onMissionEvent = (name, data) => {
  if (name === 'complete') { audio.play('mission'); hud.showBanner('JOB DONE', 1400); }
  else if (name === 'failed') { audio.play('fail'); hud.showBanner('JOB FAILED', 1400); }
  else if (name === 'started') { audio.play('mission'); }
  hud.refresh();
};
hooks.onEnterCar = () => audio.play('enter');
hooks.onExitCar = () => audio.play('click');

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
  if ((e.code === 'KeyP' || e.code === 'Escape') && state.phase === 'playing') {
    state.paused = !state.paused;
    hud.setPaused(state.paused);
    audio.play('click');
    return;
  }
  keys.add(e.code);
  if (e.code === 'KeyE' && state.phase === 'playing') toggleCar();
  if (e.code === 'KeyM' && state.phase === 'playing') missions.startCurrent();
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
    const wasParked = car.parked;
    vehicles.enter(car);
    if (wasParked) police.addCrime(1, 'you stole a car');
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
// Save/load live in save.js; these are the thin wrappers the input and
// the start screen call (Ctrl+S saves, missions auto-save on completion).
const SAVE_KEY = 'porto-verde-save-v1';
function saveGame() { return saveSys.save(); }
function loadGame() { return saveSys.load(); }

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
    missions.startMission(0);
    marker.visible = false;
    player.pos.set(world.missionPoint.x - 6, 0, world.missionPoint.z + 4);
    camYaw = Math.PI * 0.75;
  }
  // 'start' (and anything else): on foot at the spawn, as built.
}

// ---------------------------------------------------------------- start
const startScreen = document.getElementById('start-screen');
try {
  if (localStorage.getItem(SAVE_KEY)) {
    document.getElementById('save-note').textContent = 'A saved game was found — click to continue where you left off.';
  }
} catch { /* storage unavailable — fresh start */ }
let saveLoaded = false;
function beginPlay() {
  if (state.phase === 'playing') return;
  if (!shot && !saveLoaded) { saveLoaded = true; loadGame(); }
  state.phase = 'playing';
  startScreen.style.display = 'none';
  audio.unlock();
  audio.play('click');
  hud.refresh();
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
  // Slice 2 test hooks: police, missions, combat and save.
  get wanted() { return state.wanted; },
  get policeUnits() { return police.units.length; },
  get policePos() { return police.units.map((u) => ({ x: +u.pos.x.toFixed(1), z: +u.pos.z.toFixed(1) })); },
  get missionPoint() { return { x: world.missionPoint.x, z: world.missionPoint.z }; },
  get mission() { return state.mission; },
  get enemies() { return combat.enemies.map((e) => ({ name: e.name, hp: e.hp, x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1) })); },
  get ammo() { return combat.ammo; },
  get money() { return state.money; },
  get health() { return state.health; },
  addCrime(n, label) { police.addCrime(n, label); return state.wanted; },
  spawnEnemy(x, z, opts) { return combat.spawnEnemy(x, z, opts || {}); },
  startMission(i) { missions.startMission(i); return state.mission; },
  punch() { combat.punch(); return combat.enemies.map((e) => e.hp); },
  shoot() { combat.shoot(); return { ammo: combat.ammo, enemies: combat.enemies.map((e) => e.hp) }; },
  hurt(n) { combat.damagePlayer(n); return state.health; },
  saveGame() { return saveGame(); },
  loadGame() { return loadGame(); },
  // Test-only helpers: move the player (on foot) and read traffic state.
  teleport(x, z) { if (!state.inCar) player.pos.set(x, 0, z); return { x: player.pos.x, z: player.pos.z }; },
  get trafficState() {
    return {
      cars: traffic.cars.map((c) => ({ x: +c.pos.x.toFixed(1), z: +c.pos.z.toFixed(1), stopped: c.stopped })),
      peds: traffic.peds.map((p) => ({ x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1) })),
    };
  },
  // Slice 3 test hooks: HUD and audio.
  get hudReady() { return !!document.getElementById('minimap'); },
  get audioRunning() { return audio.running; },
  get paused() { return state.paused; },
  togglePause() { state.paused = !state.paused; hud.setPaused(state.paused); return state.paused; },
  showBanner(t) { hud.showBanner(t); return true; },
  shot: shot || 'start',
};
window.addEventListener('error', (e) => window.__game.errors.push(String(e.message)));

// ---------------------------------------------------------------- loop
// Delta time from performance.now() (THREE.Clock is deprecated in the
// vendored build and logs a warning on every call).
let lastT = performance.now();
let frames = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  if (state.phase === 'playing' && !state.paused) {
    arrowCamera(dt);
    traffic.update(dt);
    police.update(dt);
    missions.update(dt);
    combat.update(dt);
    if (vehicles.current) {
      updateDrive(vehicles, world, keys, dt);
      updateCamera(camera, vehicles.current.pos, camYaw, camPitch, 9);
    } else {
      updatePlayer(player, world, keys, camYaw, dt);
      updateCamera(camera, player.pos, camYaw, camPitch, 7);
    }
    marker.rotation.z += dt * 0.8;
  }
  if (flashTime > 0) {
    flashTime -= dt;
    if (flashTime <= 0 && flashLight) flashLight.intensity = 0;
  }
  if (state.phase === 'playing') {
    hud.refresh();
    audio.update(dt, {
      wanted: state.wanted,
      inCar: state.inCar,
      speed: vehicles.current ? vehicles.current.speed : player.speed,
    });
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
