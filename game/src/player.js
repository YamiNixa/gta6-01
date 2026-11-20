// Porto Verde — player.js: the on-foot hero.
// WASD movement relative to the camera, mouse-look third-person camera,
// walk/run, and building collision. Knows nothing about missions or police.
import * as THREE from 'three';
import { collideCircle } from './world.js';

const WALK_SPEED = 5.5;
const RUN_SPEED = 9.5;
const RADIUS = 0.55;

export function createPlayer(scene, world) {
  const group = new THREE.Group();

  const jacket = new THREE.MeshLambertMaterial({ color: 0x2e86ab });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2b2b33 });
  const hair = new THREE.MeshLambertMaterial({ color: 0x1c1410 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.4), jacket);
  torso.position.y = 1.15;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skin);
  head.position.y = 1.85;
  group.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.46), hair);
  cap.position.y = 2.08;
  group.add(cap);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.8, 0.3), pants);
  legL.position.set(-0.19, 0.4, 0);
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.19;
  group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.24), jacket);
  armL.position.set(-0.48, 1.15, 0);
  group.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.48;
  group.add(armR);

  group.position.set(world.playerSpawn.x, 0, world.playerSpawn.z);
  scene.add(group);

  const player = {
    mesh: group,
    pos: group.position,
    heading: 0,
    speed: 0,
    moving: false,
    legL, legR, armL, armR,
    walkPhase: 0,
  };
  return player;
}

// keys: Set of e.code values. camYaw: camera heading in radians.
export function updatePlayer(player, world, keys, camYaw, dt) {
  let fx = 0, fz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fz += 1;
  if (keys.has('KeyA')) fx -= 1;
  if (keys.has('KeyD')) fx += 1;
  const len = Math.hypot(fx, fz);
  player.moving = len > 0;
  if (!player.moving) {
    player.speed = 0;
    return;
  }
  fx /= len; fz /= len;
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = run ? RUN_SPEED : WALK_SPEED;
  player.speed = speed;
  // Move relative to the camera yaw: forward is (sin yaw, cos yaw),
  // screen-right is (-cos yaw, sin yaw).
  const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
  const mx = (-fx * cos - fz * sin) * speed * dt;
  const mz = (fx * sin - fz * cos) * speed * dt;
  player.pos.x += mx;
  player.pos.z += mz;
  collideCircle(world, player.pos, RADIUS);
  // Face the direction of travel.
  const target = Math.atan2(mx, mz);
  let d = target - player.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  player.heading += d * Math.min(1, dt * 12);
  player.mesh.rotation.y = player.heading;
  // Walk-cycle swing.
  player.walkPhase += dt * speed * 1.6;
  const swing = Math.sin(player.walkPhase) * 0.5;
  player.legL.rotation.x = swing;
  player.legR.rotation.x = -swing;
  player.armL.rotation.x = -swing * 0.8;
  player.armR.rotation.x = swing * 0.8;
}

// Third-person camera: orbits the target at yaw/pitch, looking at its head.
export function updateCamera(camera, targetPos, yaw, pitch, distance = 7) {
  const cx = targetPos.x - Math.sin(yaw) * Math.cos(pitch) * distance;
  const cz = targetPos.z - Math.cos(yaw) * Math.cos(pitch) * distance;
  const cy = targetPos.y + 1.6 + Math.sin(pitch) * distance;
  camera.position.set(cx, Math.max(0.6, cy), cz);
  camera.lookAt(targetPos.x, targetPos.y + 1.5, targetPos.z);
}
