// Porto Verde — missions.js: the story and the jobs.
// Four chained jobs for Lucia "Luz" Ferrer, a courier who just rolled into
// Porto Verde and owes the wrong people money. Her fixer Rio Marín hands
// out the work; each job pays out, auto-saves, and unlocks the next one.
// M starts (or retries) the current job; failing a timed job lets you retry.
import * as THREE from 'three';

const MISSION_DEFS = [
  {
    id: 'first-meeting', title: 'First Meeting', giver: 'Rio Marín', reward: 150,
    brief: 'Rio wants to size you up. Meet him at the Marina Verde park.',
    steps: [
      { kind: 'goto', text: 'Meet Rio at Marina Verde park', pos: 'missionPoint', radius: 3.5 },
    ],
  },
  {
    id: 'hot-wheels', title: 'Hot Wheels', giver: 'Rio Marín', reward: 300,
    brief: 'Rio needs wheels that cannot be traced. Take any parked car and bring it to the old garage.',
    steps: [
      { kind: 'steal', text: 'Steal a car (walk up to one, press E)' },
      { kind: 'drive', text: 'Drive the car to the old garage', pos: 'garage', radius: 5 },
    ],
  },
  {
    id: 'courier-run', title: 'The Courier Run', giver: 'Dana Kessler', reward: 500,
    brief: 'Dana Kessler pays cash for speed. Pick up the parcel at the north market, deliver it to the south docks before the clock runs out.',
    timeLimit: 150,
    steps: [
      { kind: 'pickup', text: 'Pick up the parcel at the north market', pos: 'market', radius: 3.5 },
      { kind: 'deliver', text: 'Deliver the parcel to the south docks', pos: 'docks', radius: 4 },
    ],
  },
  {
    id: 'dockside-trouble', title: 'Dockside Trouble', giver: 'Rio Marín', reward: 800,
    brief: 'The Harbormaster\'s enforcers are shaking down Rio\'s crew at the docks. Go down there and settle it — with your fists or the Pico-9.',
    steps: [
      { kind: 'goto', text: 'Get to the south docks', pos: 'docks', radius: 6 },
      { kind: 'defeat', text: 'Deal with the Harbormaster\'s enforcers (0 left)', pos: 'docks', radius: 8 },
    ],
  },
];

export function createMissions(scene, world, api) {
  const S = world.streets;
  const spots = {
    missionPoint: world.missionPoint,
    garage: { x: S[4], z: S[1] },
    market: { x: S[0], z: S[3] },
    docks: { x: S[5], z: S[5] },
  };

  // Objective marker: a gold ring plus a light pillar, easy to spot.
  const marker = new THREE.Mesh(
    new THREE.TorusGeometry(1.6, 0.14, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd166 }),
  );
  marker.rotation.x = Math.PI / 2;
  marker.visible = false;
  scene.add(marker);
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 40, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  beacon.visible = false;
  scene.add(beacon);

  let idx = 0;            // mission index, 0..3; 4 means the story is done
  let stepIdx = 0;
  let status = 'idle';    // 'idle' | 'active' | 'failed' | 'done'
  let timer = 0;
  let stepSpawned = false;

  function def() { return MISSION_DEFS[idx]; }
  function step() { return def() ? def().steps[stepIdx] : null; }
  function stepPos(s) { return s.pos ? spots[s.pos] : null; }

  function syncState() {
    if (idx >= MISSION_DEFS.length) {
      api.state.mission = { id: 'story-done', title: 'Porto Verde is yours', status: 'complete', objective: 'Story complete — the city is open. Keep driving, keep earning.' };
      return;
    }
    const d = def();
    const s = step();
    api.state.mission = {
      id: d.id, title: d.title, status,
      objective: status === 'failed' ? 'Failed — press M to retry' : (s ? s.text : d.brief),
      giver: d.giver, reward: d.reward,
      step: stepIdx + 1, steps: d.steps.length,
      timeLeft: d.timeLimit ? Math.max(0, Math.ceil(timer)) : null,
    };
  }

  function placeMarker() {
    const s = step();
    const pos = s && s.pos ? stepPos(s) : null;
    if (status === 'active' && pos) {
      marker.position.set(pos.x, 0.6, pos.z);
      beacon.position.set(pos.x, 20, pos.z);
      marker.visible = true;
      beacon.visible = true;
    } else {
      marker.visible = false;
      beacon.visible = false;
    }
  }

  function enterStep() {
    stepSpawned = false;
    const s = step();
    if (s && s.kind === 'defeat') {
      const pos = stepPos(s);
      api.spawnEnemy(pos.x - 3, pos.z + 2, { name: 'Dock Enforcer', hp: 60 });
      api.spawnEnemy(pos.x + 3, pos.z - 2, { name: 'Dock Enforcer', hp: 60 });
      stepSpawned = true;
    }
    syncState();
    placeMarker();
  }

  function startMission(i) {
    idx = i;
    stepIdx = 0;
    status = 'active';
    timer = def().timeLimit || 0;
    const d = def();
    api.toast(`${d.title} — ${d.giver}: ${d.brief}`);
    api.onMissionEvent('start', { id: d.id });
    enterStep();
  }

  function startCurrent() {
    if (idx >= MISSION_DEFS.length) { api.toast('Story complete — the city is open.'); return; }
    if (status === 'active') { api.toast('Job already running: ' + def().title); return; }
    startMission(idx);
  }

  function completeMission() {
    const d = def();
    api.state.money += d.reward;
    api.toast(`${d.title} complete — +$${d.reward}.`);
    api.onMissionEvent('complete', { id: d.id, reward: d.reward });
    api.saveGame();
    idx++;
    stepIdx = 0;
    if (idx >= MISSION_DEFS.length) {
      status = 'done';
      syncState();
      placeMarker();
      api.toast('Story complete — Porto Verde is yours, Luz.');
      return;
    }
    startMission(idx);
  }

  function failMission(reason) {
    status = 'failed';
    api.toast(`Job failed — ${reason}. Press M to retry.`);
    api.onMissionEvent('fail', { id: def().id, reason });
    syncState();
    placeMarker();
  }

  function update(dt) {
    marker.rotation.z += dt * 0.8;
    if (status !== 'active') return;
    const d = def();
    const s = step();
    if (!s) return;
    if (d.timeLimit) {
      timer -= dt;
      if (timer <= 0) { failMission('out of time'); return; }
      api.state.mission.timeLeft = Math.ceil(timer);
    }
    const p = api.getPlayerPos();
    if (s.kind === 'goto' || s.kind === 'pickup' || s.kind === 'deliver' || s.kind === 'drive') {
      const pos = stepPos(s);
      const dist = Math.hypot(p.x - pos.x, p.z - pos.z);
      const ok = s.kind === 'drive' ? (api.isInCar() && dist < s.radius) : dist < s.radius;
      if (ok) {
        if (stepIdx + 1 < d.steps.length) { stepIdx++; enterStep(); }
        else completeMission();
      }
    } else if (s.kind === 'steal') {
      if (api.isInCar()) {
        if (stepIdx + 1 < d.steps.length) { stepIdx++; enterStep(); }
        else completeMission();
      }
    } else if (s.kind === 'defeat') {
      const left = api.missionEnemiesAlive();
      const cur = api.state.mission;
      if (cur) cur.objective = `Deal with the Harbormaster's enforcers (${left} left)`;
      if (stepSpawned && left === 0) completeMission();
    }
  }

  function getProgress() { return { idx, status }; }
  function setProgress(saved) {
    if (!saved) return;
    idx = Math.max(0, Math.min(MISSION_DEFS.length, saved.idx || 0));
    if (idx >= MISSION_DEFS.length) { status = 'done'; syncState(); placeMarker(); return; }
    if (saved.status === 'active') startMission(idx);
    else { status = 'idle'; syncState(); placeMarker(); }
  }

  syncState();
  return {
    defs: MISSION_DEFS, update, startMission, startCurrent, getProgress, setProgress,
    get current() { return idx < MISSION_DEFS.length ? { id: def().id, title: def().title, status, step: stepIdx } : null; },
  };
}
