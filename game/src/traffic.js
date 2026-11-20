// Porto Verde — traffic.js: the city in motion.
// Traffic cars loop the street grid and stop for the car ahead; pedestrians
// walk the sidewalks and turn at intersections. Simple avoidance only —
// no police, no missions here.
import * as THREE from 'three';
import { collideCircle, mulberry32 } from './world.js';
import { makeCarMesh } from './vehicles.js';

const TRAFFIC_COLORS = [0x8a8f96, 0x4a6b8a, 0xb08a3e, 0x5a5a5a, 0x7a3b2e, 0x3e6b4a];

export function createTraffic(scene, world, vehicleSystem) {
  const rng = mulberry32(4242);
  const cars = [];
  const peds = [];

  // One rectangular loop per chosen block ring, on street centrelines.
  const loops = [];
  for (let i = 0; i < 3; i++) {
    const a = world.streets[1 + i];
    const b = world.streets[3 + i > 5 ? 5 : 3 + i];
    loops.push([
      { x: a, z: a }, { x: b, z: a }, { x: b, z: b }, { x: a, z: b },
    ]);
  }
  // A few long loops along the avenues.
  loops.push([
    { x: world.streets[0], z: world.streets[1] },
    { x: world.streets[5], z: world.streets[1] },
    { x: world.streets[5], z: world.streets[4] },
    { x: world.streets[0], z: world.streets[4] },
  ]);

  for (let i = 0; i < 6; i++) {
    const loop = loops[i % loops.length];
    const mesh = makeCarMesh(TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]);
    scene.add(mesh);
    const wp = Math.floor(rng() * loop.length);
    const start = loop[wp];
    mesh.position.set(start.x + (rng() - 0.5) * 4, 0, start.z + (rng() - 0.5) * 4);
    cars.push({ mesh, pos: mesh.position, loop, wp, speed: 7 + rng() * 3, heading: 0, stopped: false });
  }

  // Pedestrians: a simple stylised walker with a bob.
  const shirtCols = [0xd94f4f, 0x4f7dd9, 0x4fd97a, 0xd9c24f, 0x9b4fd9, 0xe0e0e0];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const shirt = new THREE.MeshLambertMaterial({ color: shirtCols[i % shirtCols.length] });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
    const legs = new THREE.MeshLambertMaterial({ color: 0x2b2b33 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.34), shirt);
    body.position.y = 1.1;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), skin);
    head.position.y = 1.72;
    g.add(head);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.26), legs);
    legL.position.set(-0.16, 0.35, 0);
    g.add(legL);
    const legR = legL.clone();
    legR.position.x = 0.16;
    g.add(legR);
    // Start on a random sidewalk edge, walk along it.
    const street = world.streets[Math.floor(rng() * world.streets.length)];
    const along = (rng() * 2 - 1) * world.half * 0.8;
    const horiz = rng() < 0.5;
    g.position.set(horiz ? along : street + 8.5, 0.3, horiz ? street + 8.5 : along);
    scene.add(g);
    peds.push({
      mesh: g, pos: g.position, legL, legR,
      dir: rng() < 0.5 ? 1 : -1, horiz,
      speed: 1.1 + rng() * 0.7, phase: rng() * 6,
    });
  }

  function aheadBlocked(car, dt) {
    // Stop when another car (traffic or the player's) is close ahead.
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const all = [...cars, ...(vehicleSystem.current ? [vehicleSystem.current] : [])];
    for (const other of all) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 8 && dist > 0.01) {
        const dot = (dx * fx + dz * fz) / dist;
        if (dot > 0.5) return true;
      }
    }
    return false;
  }

  function update(dt) {
    for (const car of cars) {
      const target = car.loop[(car.wp + 1) % car.loop.length];
      const dx = target.x - car.pos.x;
      const dz = target.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.5) { car.wp = (car.wp + 1) % car.loop.length; continue; }
      car.heading = Math.atan2(dx, dz);
      car.stopped = aheadBlocked(car, dt);
      if (!car.stopped) {
        car.pos.x += Math.sin(car.heading) * car.speed * dt;
        car.pos.z += Math.cos(car.heading) * car.speed * dt;
      }
      car.mesh.rotation.y = car.heading;
      for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2;
    }
    for (const p of peds) {
      p.phase += dt * p.speed * 4;
      const swing = Math.sin(p.phase) * 0.45;
      p.legL.rotation.x = swing;
      p.legR.rotation.x = -swing;
      const step = p.speed * p.dir * dt;
      if (p.horiz) p.pos.x += step; else p.pos.z += step;
      // Turn around at the city edge; face the walking direction.
      const limit = world.half - 4;
      const along = p.horiz ? p.pos.x : p.pos.z;
      if (along > limit || along < -limit) {
        p.dir *= -1;
        if (p.horiz) p.pos.x = Math.max(-limit, Math.min(limit, p.pos.x));
        else p.pos.z = Math.max(-limit, Math.min(limit, p.pos.z));
      }
      p.mesh.rotation.y = p.horiz ? (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (p.dir > 0 ? 0 : Math.PI);
    }
  }

  return { cars, peds, update };
}
