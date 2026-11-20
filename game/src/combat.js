// Porto Verde — combat.js: fists, the Pico-9, and the people who fight back.
// F punches, click fires the pistol (R reloads), enemies close in and swing
// back, and dropping to zero health costs Luz a cut of her cash and a trip
// back to the Marina. Hitting a pedestrian counts as assault.
import * as THREE from 'three';
import { collideCircle } from './world.js';

const PUNCH_RANGE = 2.4;
const PUNCH_DMG = 26;
const PUNCH_CD = 0.45;
const PISTOL_RANGE = 70;
const PISTOL_DMG = 34;
const PISTOL_MAG = 12;
const ENEMY_HP = 60;
const ENEMY_DMG = 9;
const ENEMY_SPEED = 3.4;

function enemyMesh() {
  const g = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0x8a2f2f });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1c22 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.4), red);
  body.position.y = 1.15;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), skin);
  head.position.y = 1.82;
  g.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.75, 0.28), dark);
  legL.position.set(-0.18, 0.38, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.18;
  g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.24), red);
  armL.position.set(-0.5, 1.15, 0);
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.5;
  g.add(armR);
  // Health bar floating over the head.
  const barBg = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  barBg.position.y = 2.25;
  const barFg = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0x37d67a }));
  barFg.position.set(0, 2.25, 0.02);
  g.add(barBg, barFg);
  g.userData.barFg = barFg;
  g.userData.legL = legL;
  g.userData.legR = legR;
  return g;
}

export function createCombat(scene, world, api) {
  const enemies = [];
  let ammo = PISTOL_MAG;
  let reserve = 48;
  let punchCd = 0;

  function spawnEnemy(x, z, opts = {}) {
    const mesh = enemyMesh();
    mesh.position.set(x, 0, z);
    collideCircle(world, mesh.position, 1);
    scene.add(mesh);
    const enemy = {
      mesh, pos: mesh.position, name: opts.name || 'Street Thug',
      hp: opts.hp || ENEMY_HP, maxHp: opts.hp || ENEMY_HP,
      attackCd: 0, phase: Math.random() * 6, mission: !!opts.mission,
    };
    enemies.push(enemy);
    return enemy;
  }

  function killEnemy(enemy) {
    scene.remove(enemy.mesh);
    const i = enemies.indexOf(enemy);
    if (i >= 0) enemies.splice(i, 1);
    api.toast(`${enemy.name} is down.`);
    api.onEnemyKilled(enemy);
  }

  function damagePlayer(n) {
    api.state.health = Math.max(0, api.state.health - n);
    if (api.state.health <= 0) api.onPlayerDeath();
  }

  function angleTo(targetPos) {
    const p = api.getPlayerPos();
    return Math.atan2(targetPos.x - p.x, targetPos.z - p.z);
  }
  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }

  function punch() {
    if (punchCd > 0 || api.isInCar()) return;
    punchCd = PUNCH_CD;
    const aim = api.getAimYaw();
    const p = api.getPlayerPos();
    // Enemies first: a swing connects with any foe in reach.
    for (const e of [...enemies]) {
      const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
      if (d < PUNCH_RANGE) {
        e.hp -= PUNCH_DMG;
        e.mesh.userData.barFg.scale.x = Math.max(0, e.hp / e.maxHp);
        e.mesh.userData.barFg.position.x = -(1 - Math.max(0, e.hp / e.maxHp)) * 0.5;
        if (e.hp <= 0) killEnemy(e);
        return;
      }
    }
    // Then pedestrians — and that is assault.
    for (const ped of api.getPeds()) {
      const d = Math.hypot(ped.pos.x - p.x, ped.pos.z - p.z);
      if (d < PUNCH_RANGE && angleDiff(angleTo(ped.pos), aim) < 1.1) {
        ped.speed = 4.2;
        ped.dir = Math.sign(ped.pos.x - p.x) || 1;
        if (!ped.horiz) ped.dir = Math.sign(ped.pos.z - p.z) || 1;
        api.addCrime(1, 'assault on a pedestrian');
        return;
      }
    }
  }

  function shoot() {
    if (api.isInCar()) return;
    if (ammo <= 0) { api.toast('Out of ammo — press R to reload.'); return; }
    ammo--;
    const aim = api.getAimYaw();
    const p = api.getPlayerPos();
    let best = null, bestD = PISTOL_RANGE;
    for (const e of enemies) {
      const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
      if (d < bestD && angleDiff(angleTo(e.pos), aim) < 0.15) { best = e; bestD = d; }
    }
    if (best) {
      best.hp -= PISTOL_DMG;
      best.mesh.userData.barFg.scale.x = Math.max(0, best.hp / best.maxHp);
      best.mesh.userData.barFg.position.x = -(1 - Math.max(0, best.hp / best.maxHp)) * 0.5;
      if (best.hp <= 0) killEnemy(best);
      return;
    }
    // A stray round can still hit a pedestrian — and the law notices.
    for (const ped of api.getPeds()) {
      const d = Math.hypot(ped.pos.x - p.x, ped.pos.z - p.z);
      if (d < PISTOL_RANGE && angleDiff(angleTo(ped.pos), aim) < 0.08) {
        ped.speed = 4.5;
        api.addCrime(1, 'shooting at a pedestrian');
        return;
      }
    }
  }

  function reload() {
    if (ammo >= PISTOL_MAG || reserve <= 0) return;
    const need = PISTOL_MAG - ammo;
    const take = Math.min(need, reserve);
    ammo += take;
    reserve -= take;
    api.toast(`Reloaded — ${ammo} in the mag, ${reserve} in reserve.`);
  }

  function update(dt) {
    punchCd = Math.max(0, punchCd - dt);
    if (api.state.health <= 0) return;
    const p = api.getPlayerPos();
    for (const e of [...enemies]) {
      const dx = p.x - e.pos.x;
      const dz = p.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      e.attackCd -= dt;
      if (dist > 2.0) {
        const heading = Math.atan2(dx, dz);
        e.pos.x += Math.sin(heading) * ENEMY_SPEED * dt;
        e.pos.z += Math.cos(heading) * ENEMY_SPEED * dt;
        collideCircle(world, e.pos, 1);
        e.mesh.rotation.y = heading;
        e.phase += dt * ENEMY_SPEED * 2;
        e.mesh.userData.legL.rotation.x = Math.sin(e.phase) * 0.6;
        e.mesh.userData.legR.rotation.x = -Math.sin(e.phase) * 0.6;
      } else if (e.attackCd <= 0) {
        e.attackCd = 1.1;
        damagePlayer(ENEMY_DMG);
        api.toast(`${e.name} hit you — health ${api.state.health}.`);
      }
    }
  }

  window.addEventListener('keydown', (e) => {
    if (api.state.phase !== 'playing') return;
    if (e.code === 'KeyF') punch();
    if (e.code === 'KeyR') reload();
  });
  window.addEventListener('mousedown', (e) => {
    if (api.state.phase !== 'playing' || e.button !== 0) return;
    shoot();
  });

  return {
    enemies, update, punch, shoot, reload, spawnEnemy, damagePlayer,
    get ammo() { return ammo; },
    get reserve() { return reserve; },
    setAmmo(a, r) { ammo = a; reserve = r; },
  };
}
