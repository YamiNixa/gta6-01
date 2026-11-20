// Porto Verde — world.js: the procedural city.
// Owns the street grid, blocks, buildings, sidewalks, props, sky and light,
// plus the building colliders every moving thing resolves against.
import * as THREE from 'three';

// Deterministic RNG so the city is the same every load (and every screenshot).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PITCH = 58;          // street centre to street centre
const ROAD = 14;           // road width
const GRID = 5;            // blocks per side
const HALF = (GRID * PITCH) / 2; // 145 — city half-extent
const STREET = [];         // street centre-line coordinates
for (let i = 0; i <= GRID; i++) STREET.push(-HALF + i * PITCH);

const PALETTE = [0xd8c9a3, 0xc9a06a, 0x9fb4c0, 0xd98a7a, 0xa8b89a, 0xe0d6c0, 0x8fa3b8, 0xd9b48a];

function facadeTexture(rng, base) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#' + base.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 128, 10);
  const cols = 4 + Math.floor(rng() * 3);
  const rows = 6 + Math.floor(rng() * 6);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = rng() < 0.25;
      g.fillStyle = lit ? '#ffe9a8' : 'rgba(20,30,44,0.85)';
      g.fillRect(10 + x * (108 / cols), 22 + y * (220 / rows), 108 / cols - 8, 220 / rows - 10);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function groundTexture() {
  const S = 1024, span = 360;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const toPx = (v) => ((v + span / 2) / span) * S;
  g.fillStyle = '#2e3238';
  g.fillRect(0, 0, S, S);
  // street centre dashes
  g.fillStyle = '#e8e4c8';
  for (const s of STREET) {
    for (let v = -HALF; v < HALF; v += 12) {
      g.fillRect(toPx(s) - 1, toPx(v), 2, 6);       // dashes along Z streets
      g.fillRect(toPx(v), toPx(s) - 1, 6, 2);       // dashes along X streets
    }
  }
  // zebra crossings at every intersection
  g.fillStyle = 'rgba(232,228,200,0.85)';
  for (const sx of STREET) {
    for (const sz of STREET) {
      for (let k = -2; k <= 2; k++) {
        g.fillRect(toPx(sx + k * 3) - 1, toPx(sz) - 6, 2, 12);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildWorld(scene) {
  const rng = mulberry32(20261121);
  const colliders = [];
  const world = { colliders, streets: STREET, half: HALF, bounds: HALF + 6 };

  // Sky, fog and sun: a bright late-afternoon over a port city.
  scene.background = new THREE.Color(0x8fc3e8);
  scene.fog = new THREE.Fog(0x8fc3e8, 220, 520);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7a5a, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6b0, 1.6);
  sun.position.set(140, 190, 70);
  scene.add(sun);

  // Ground: one textured asphalt plane for the whole city.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 360),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  scene.add(ground);

  // Sea and sand to the south — Porto Verde is a port city.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 180),
    new THREE.MeshLambertMaterial({ color: 0x2a7fa8 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.6, 275);
  scene.add(sea);
  const sand = new THREE.Mesh(
    new THREE.BoxGeometry(360, 0.4, 16),
    new THREE.MeshLambertMaterial({ color: 0xdcc48f }),
  );
  sand.position.set(0, 0.1, 178);
  scene.add(sand);

  // Facade textures, shared across buildings.
  const facades = PALETTE.map((col) => facadeTexture(rng, col));
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0xb9b3a4 });
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x5da24a });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f7d32 });
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
  const lampGlowMat = new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xffe9a0 });

  const blockSize = PITCH - ROAD; // 44
  let buildingCount = 0;

  for (let bx = 0; bx < GRID; bx++) {
    for (let bz = 0; bz < GRID; bz++) {
      const cx = -HALF + bx * PITCH + PITCH / 2;
      const cz = -HALF + bz * PITCH + PITCH / 2;
      const isPark = bx === 2 && bz === 2;

      // Sidewalk slab for the block.
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(blockSize, 0.3, blockSize),
        isPark ? grassMat : sidewalkMat,
      );
      slab.position.set(cx, 0.15, cz);
      scene.add(slab);

      if (isPark) {
        // Central park: Marina Verde — trees and a fountain.
        for (let t = 0; t < 12; t++) {
          const tx = cx + (rng() - 0.5) * 36;
          const tz = cz + (rng() - 0.5) * 36;
          if (Math.abs(tx - cx) < 5 && Math.abs(tz - cz) < 5) continue;
          addTree(scene, tx, tz, trunkMat, leafMat, rng);
        }
        const basin = new THREE.Mesh(
          new THREE.CylinderGeometry(4, 4.4, 1, 20),
          new THREE.MeshLambertMaterial({ color: 0xcfd4d6 }),
        );
        basin.position.set(cx, 0.8, cz);
        scene.add(basin);
        const water = new THREE.Mesh(
          new THREE.CylinderGeometry(3.5, 3.5, 0.3, 20),
          new THREE.MeshLambertMaterial({ color: 0x4fb0d8 }),
        );
        water.position.set(cx, 1.2, cz);
        scene.add(water);
        world.parkCenter = { x: cx, z: cz };
        continue;
      }

      // Four lots per block, each one building.
      const lot = blockSize / 2;
      for (let lx = 0; lx < 2; lx++) {
        for (let lz = 0; lz < 2; lz++) {
          const w = 13 + rng() * 5;
          const d = 13 + rng() * 5;
          const h = 8 + rng() * rng() * 26;
          const px = cx + (lx - 0.5) * lot;
          const pz = cz + (lz - 0.5) * lot;
          const tex = facades[Math.floor(rng() * facades.length)];
          const b = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            new THREE.MeshLambertMaterial({ map: tex }),
          );
          b.position.set(px, 0.3 + h / 2, pz);
          scene.add(b);
          // Flat roof cap.
          const roof = new THREE.Mesh(
            new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6),
            new THREE.MeshLambertMaterial({ color: 0x5a5f66 }),
          );
          roof.position.set(px, 0.3 + h + 0.25, pz);
          scene.add(roof);
          colliders.push({ x0: px - w / 2, x1: px + w / 2, z0: pz - d / 2, z1: pz + d / 2 });
          buildingCount++;
        }
      }
    }
  }
  world.buildingCount = buildingCount;

  // Street lamps along the two avenues and two cross streets.
  for (const s of [STREET[1], STREET[3]]) {
    for (let v = -HALF + 14; v < HALF; v += 29) {
      addLamp(scene, s + ROAD / 2 + 1.5, v, lampMat, lampGlowMat);
      addLamp(scene, v, s - ROAD / 2 - 1.5, lampMat, lampGlowMat);
    }
  }

  // Palm trees on the beachfront promenade.
  for (let x = -HALF + 10; x < HALF; x += 24) {
    addTree(scene, x, 168, trunkMat, leafMat, rng);
  }

  world.playerSpawn = { x: STREET[2] + 4, z: STREET[2] + 4 };
  world.missionPoint = { x: world.parkCenter.x + 8, z: world.parkCenter.z };
  return world;
}

function addTree(scene, x, z, trunkMat, leafMat, rng) {
  const h = 4 + rng() * 2;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h, 6), trunkMat);
  trunk.position.set(x, 0.3 + h / 2, z);
  scene.add(trunk);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1.8 + rng(), 8, 6), leafMat);
  crown.position.set(x, 0.3 + h + 1, z);
  scene.add(crown);
}

function addLamp(scene, x, z, lampMat, glowMat) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 6), lampMat);
  pole.position.set(x, 3.3, z);
  scene.add(pole);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), glowMat);
  head.position.set(x, 6.4, z);
  scene.add(head);
}

// Circle-vs-building push-out. pos is a THREE.Vector3 (uses .x/.z, writes back).
// Returns true when a push happened. Shared by the player, cars and traffic.
export function collideCircle(world, pos, radius) {
  let hit = false;
  for (const c of world.colliders) {
    const nx = Math.max(c.x0, Math.min(pos.x, c.x1));
    const nz = Math.max(c.z0, Math.min(pos.z, c.z1));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * radius;
      pos.z = nz + (dz / d) * radius;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = pos.x - c.x0, pr = c.x1 - pos.x, pt = pos.z - c.z0, pb = c.z1 - pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = c.x0 - radius;
      else if (m === pr) pos.x = c.x1 + radius;
      else if (m === pt) pos.z = c.z0 - radius;
      else pos.z = c.z1 + radius;
    }
  }
  // Keep everything inside the city bounds.
  const b = world.bounds;
  pos.x = Math.max(-b, Math.min(b, pos.x));
  pos.z = Math.max(-b, Math.min(b, pos.z));
  return hit;
}
