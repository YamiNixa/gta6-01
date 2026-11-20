// Porto Verde — police.js: the wanted level and the law.
// Wanted runs 0–5. Crime raises it, officers and patrol cars spawn and
// chase the player, getting caught means a bust (fine + trip back to the
// Marina), and lying low out of sight lets the heat cool off star by star.
import * as THREE from 'three';
import { collideCircle } from './world.js';
import { makeCarMesh } from './vehicles.js';

const MAX_WANTED = 5;
const BUST_DIST_CAR = 4.5;
const BUST_DIST_FOOT = 3.0;
const BUST_HOLD = 0.9;      // seconds a unit must stay on the player to bust
const HIDE_RANGE = 32;      // no unit this close counts as "out of sight"
const HIDE_TIME = 10;       // seconds hidden before one star cools off
const SPAWN_DIST = 48;

function officerMesh() {
  const g = new THREE.Group();
  const navy = new THREE.MeshLambertMaterial({ color: 0x1d3557 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.36), navy);
  body.position.y = 1.12;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), skin);
  head.position.y = 1.78;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.42), new THREE.MeshLambertMaterial({ color: 0x0d1b2a }));
  cap.position.y = 2.0;
  g.add(cap);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.26), new THREE.MeshLambertMaterial({ color: 0x14181f }));
  legL.position.set(-0.16, 0.36, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.16;
  g.add(legR);
  g.userData.legL = legL;
  g.userData.legR = legR;
  return g;
}

function patrolCarMesh() {
  const mesh = makeCarMesh(0xe8e8e8);
  const bar = new THREE.Group();
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  red.position.set(-0.3, 0, 0);
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
  blue.position.set(0.3, 0, 0);
  bar.add(red, blue);
  bar.position.y = 1.42;
  mesh.add(bar);
  mesh.userData.lightBar = bar;
  return mesh;
}

export function createPolice(scene, world, api) {
  const units = []; // {kind:'car'|'officer', mesh, pos, heading, speed, bustTimer, phase}
  let hiddenTime = 0;
  let spawnTimer = 0;
  let crimeCooldown = 0;
  let speedCooldown = 0;
  let elapsed = 0;

  function desiredCounts(w) {
    if (w <= 0) return { cars: 0, officers: 0 };
    return {
      cars: w >= 4 ? 3 : w >= 3 ? 2 : 1,
      officers: w >= 5 ? 3 : w >= 3 ? 2 : w >= 2 ? 1 : 0,
    };
  }

  function spawnUnit(kind) {
    const p = api.getPlayerPos();
    const a = Math.random() * Math.PI * 2;
    const mesh = kind === 'car' ? patrolCarMesh() : officerMesh();
    mesh.position.set(p.x + Math.sin(a) * SPAWN_DIST, 0, p.z + Math.cos(a) * SPAWN_DIST);
    collideCircle(world, mesh.position, 2);
    scene.add(mesh);
    const unit = {
      kind, mesh, pos: mesh.position,
      heading: Math.atan2(p.x - mesh.position.x, p.z - mesh.position.z),
      speed: 0, bustTimer: 0, phase: Math.random() * 6,
    };
    units.push(unit);
    return unit;
  }

  function removeUnit(unit) {
    scene.remove(unit.mesh);
    const i = units.indexOf(unit);
    if (i >= 0) units.splice(i, 1);
  }

  function setWanted(level, silent) {
    const next = Math.max(0, Math.min(MAX_WANTED, Math.round(level)));
    if (next === api.state.wanted) return;
    api.state.wanted = next;
    hiddenTime = 0;
    if (next === 0) {
      for (const u of [...units]) removeUnit(u);
      if (!silent) api.toast('You lost the heat — wanted level clear.');
    }
    api.onWantedChange(next);
  }

  function addCrime(stars, label) {
    if (crimeCooldown > 0 || api.state.wanted >= MAX_WANTED) return;
    crimeCooldown = 1.5;
    setWanted(api.state.wanted + stars);
    if (label) api.toast(`Wanted level ${api.state.wanted} — ${label}`);
  }

  function bust() {
    for (const u of [...units]) removeUnit(u);
    setWanted(0, true);
    api.toast('BUSTED! The Verde PD took you in — $150 fine.');
    api.onBusted();
  }

  function update(dt) {
    elapsed += dt;
    crimeCooldown = Math.max(0, crimeCooldown - dt);
    speedCooldown = Math.max(0, speedCooldown - dt);
    const w = api.state.wanted;
    if (w <= 0) return;

    // Speeding past the law draws attention.
    if (api.isInCar() && api.getPlayerSpeed() > 19 && speedCooldown <= 0) {
      const p = api.getPlayerPos();
      const near = units.some((u) => Math.hypot(u.pos.x - p.x, u.pos.z - p.z) < 45);
      if (near) { speedCooldown = 6; addCrime(1, 'speeding past a patrol car'); }
    }

    // Keep the pursuit at the right strength, trickling units in.
    const want = desiredCounts(w);
    const haveCars = units.filter((u) => u.kind === 'car').length;
    const haveOfficers = units.filter((u) => u.kind === 'officer').length;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      if (haveCars < want.cars) spawnUnit('car');
      else if (haveOfficers < want.officers) spawnUnit('officer');
      spawnTimer = 0.8;
    }

    const p = api.getPlayerPos();
    const inCar = api.isInCar();
    let nearest = Infinity;
    let bustRange = inCar ? BUST_DIST_CAR : BUST_DIST_FOOT;

    for (const u of [...units]) {
      const dx = p.x - u.pos.x;
      const dz = p.z - u.pos.z;
      const dist = Math.hypot(dx, dz);
      nearest = Math.min(nearest, dist);
      const target = Math.atan2(dx, dz);
      let turn = target - u.heading;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      const topSpeed = u.kind === 'car' ? Math.min(11 + w * 1.8, 22) : 4.6 + w * 0.3;
      // Close in: crawl once on top of the player so the bust can land
      // instead of overshooting past them at full speed.
      const holdRange = inCar ? BUST_DIST_CAR : BUST_DIST_FOOT;
      const cappedTop = dist < holdRange + 2 ? 1.5 : topSpeed;
      u.heading += Math.max(-2.4 * dt, Math.min(2.4 * dt, turn));
      // Stuck on a building? Slide around it instead of pushing into it:
      // keep turning one way while blocked, for a second after clearing.
      if (u.blocked) {
        if (!u.avoidDir) u.avoidDir = Math.random() < 0.5 ? -1 : 1;
        u.heading += u.avoidDir * 2.0 * dt;
        u.clearT = 0;
      } else {
        u.clearT = (u.clearT || 0) + dt;
        if (u.clearT > 1) u.avoidDir = 0;
      }
      u.speed = Math.min(cappedTop, u.speed + 8 * dt);
      u.pos.x += Math.sin(u.heading) * u.speed * dt;
      u.pos.z += Math.cos(u.heading) * u.speed * dt;
      u.blocked = collideCircle(world, u.pos, 2);
      u.mesh.rotation.y = u.heading;
      if (u.kind === 'car') {
        for (const wheel of u.mesh.userData.wheels) wheel.rotation.x += u.speed * dt * 2;
        u.mesh.userData.lightBar.visible = Math.floor(elapsed * 6) % 2 === 0;
      } else {
        u.phase += dt * u.speed * 2.2;
        u.mesh.userData.legL.rotation.x = Math.sin(u.phase) * 0.6;
        u.mesh.userData.legR.rotation.x = -Math.sin(u.phase) * 0.6;
      }
      // Caught: a unit stays on the player long enough to bust them.
      if (dist < bustRange) {
        u.bustTimer += dt;
        if (u.bustTimer >= BUST_HOLD) { bust(); return; }
      } else {
        u.bustTimer = 0;
      }
    }

    // Out of sight long enough: one star cools off.
    if (nearest > HIDE_RANGE) {
      hiddenTime += dt;
      if (hiddenTime >= HIDE_TIME) {
        hiddenTime = 0;
        setWanted(w - 1);
        if (api.state.wanted > 0) api.toast('Heat cooling off — wanted level ' + api.state.wanted + '.');
      }
    } else {
      hiddenTime = 0;
    }
  }

  return { units, addCrime, setWanted, update, get wanted() { return api.state.wanted; } };
}
