// Porto Verde — vehicles.js: cars you can steal and drive.
// Parked cars around the city, E to enter/exit, arcade driving physics
// (accel, brake, reverse, steering that bites with speed) and building
// collision. Knows nothing about police or missions.
import * as THREE from 'three';
import { collideCircle, mulberry32 } from './world.js';

const CAR_COLORS = [0xc23b2e, 0x2e6fc2, 0xe0b93c, 0x3aa655, 0xd8d8d8, 0x232323, 0x7a4a9e, 0xe07b39];
const CAR_NAMES = ['Vento', 'Brisa', 'Touro', 'Maré', 'Falcão', 'Litoral', 'Cacau', 'Nuvem'];
const RADIUS = 1.7;
const TOP_SPEED = 34;
const REVERSE_MAX = 9;

export function makeCarMesh(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x18242e });
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat);
  body.position.y = 0.55;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), glassMat);
  cabin.position.set(0, 1.1, -0.2);
  g.add(cabin);
  const lightMat = new THREE.MeshLambertMaterial({ color: 0xfff6c0, emissive: 0x776600 });
  for (const x of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), lightMat);
    lamp.position.set(x, 0.62, 2.22);
    g.add(lamp);
  }
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.38, z);
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  return g;
}

export function createVehicleSystem(scene, world) {
  const rng = mulberry32(777);
  const cars = [];
  // Parked cars along street edges, deterministic spots.
  const spots = [];
  for (const s of world.streets) {
    for (let v = -world.half + 20; v < world.half - 10; v += 46) {
      spots.push({ x: s + 4.6, z: v, heading: 0 });
      spots.push({ x: v, z: s - 4.6, heading: Math.PI / 2 });
    }
  }
  for (let i = 0; i < 10; i++) {
    const spot = spots[Math.floor(rng() * spots.length)];
    const color = CAR_COLORS[i % CAR_COLORS.length];
    const mesh = makeCarMesh(color);
    mesh.position.set(spot.x, 0, spot.z);
    mesh.rotation.y = spot.heading;
    scene.add(mesh);
    cars.push({
      mesh, name: CAR_NAMES[i % CAR_NAMES.length], color,
      pos: mesh.position, heading: spot.heading, speed: 0, parked: true,
    });
  }

  const system = {
    cars,
    current: null, // the car the player is driving, or null
    nearestCar(pos, maxDist = 3.5) {
      let best = null, bestD = maxDist;
      for (const car of cars) {
        const d = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
        if (d < bestD) { best = car; bestD = d; }
      }
      return best;
    },
    enter(car) {
      car.parked = false;
      system.current = car;
      return car;
    },
    exit() {
      const car = system.current;
      system.current = null;
      if (car) { car.speed = 0; car.parked = true; }
      return car;
    },
  };
  return system;
}

// Arcade driving for the player's current car.
export function updateDrive(system, world, keys, dt) {
  const car = system.current;
  if (!car) return;
  const accel = keys.has('KeyW') || keys.has('ArrowUp');
  const brake = keys.has('KeyS') || keys.has('ArrowDown');
  const hand = keys.has('Space');

  if (accel) car.speed += 16 * dt;
  if (brake) car.speed -= car.speed > 0.5 ? 26 * dt : 12 * dt;
  if (hand) car.speed *= Math.max(0, 1 - 3 * dt);
  // Drag and rolling resistance.
  car.speed -= car.speed * 0.35 * dt;
  if (!accel && !brake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 4 * dt);
  car.speed = Math.max(-REVERSE_MAX, Math.min(TOP_SPEED, car.speed));
  if (Math.abs(car.speed) < 0.05) car.speed = 0;

  let steer = 0;
  if (keys.has('KeyA')) steer += 1;
  if (keys.has('KeyD')) steer -= 1;
  const grip = Math.min(1, Math.abs(car.speed) / 8);
  car.heading += steer * 1.9 * grip * Math.sign(car.speed) * dt;

  const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
  car.pos.x = nx;
  car.pos.z = nz;
  const hitWall = collideCircle(world, car.pos, RADIUS);
  if (hitWall) car.speed *= 0.4;
  car.mesh.rotation.y = car.heading;
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2;
}
