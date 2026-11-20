// Porto Verde — hud.js: everything the player reads on screen.
// Minimap, wanted stars, health, cash, ammo, speed, mission objective,
// toasts, pause and busted/wasted banners. It only reads the shared state
// and the live positions the main loop hands it; it never moves anything.
export function createHUD(api) {
  const { state, world } = api;
  const root = document.getElementById('hud');

  root.innerHTML = `
    <div id="hud-top-left">
      <canvas id="minimap" width="176" height="176"></canvas>
      <div id="hud-location">Marina Verde</div>
    </div>
    <div id="hud-top-right">
      <div id="hud-wanted" title="Wanted level"></div>
      <div id="hud-money">$0</div>
      <div id="hud-time">16:20</div>
    </div>
    <div id="hud-mission"></div>
    <div id="hud-bottom-right">
      <div id="hud-speed">0 <span>km/h</span></div>
      <div id="hud-car"></div>
      <div id="hud-ammo"></div>
    </div>
    <div id="hud-health"><div id="hud-health-fill"></div><span id="hud-health-text">100</span></div>
    <div id="hud-banner"></div>
    <div id="hud-pause">
      <h2>PAUSED</h2>
      <p>Porto Verde waits for no one — except now.</p>
      <p class="dim">P / Esc resume &middot; Ctrl+S save &middot; M mission &middot; E enter car</p>
    </div>`;

  const style = document.createElement('style');
  style.textContent = `
    #hud-top-left { position: fixed; left: 14px; top: 14px; }
    #minimap { border: 2px solid rgba(255,255,255,.75); border-radius: 50%; background: #12283a; box-shadow: 0 2px 10px rgba(0,0,0,.45); }
    #hud-location { margin-top: 4px; color: #fff; font-size: 13px; text-shadow: 0 1px 3px #000; letter-spacing: 1px; }
    #hud-top-right { position: fixed; right: 16px; top: 14px; text-align: right; color: #fff; text-shadow: 0 1px 3px #000; }
    #hud-wanted { font-size: 26px; letter-spacing: 3px; min-height: 32px; color: #ffd166; }
    #hud-wanted .lit { color: #ffcf3f; } #hud-wanted .dim { color: rgba(255,255,255,.35); }
    #hud-wanted.hot { animation: hudpulse 0.7s infinite alternate; }
    @keyframes hudpulse { from { transform: scale(1); } to { transform: scale(1.06); } }
    #hud-money { font-size: 24px; font-weight: bold; color: #7dff9a; }
    #hud-time { font-size: 14px; color: #dfeef5; }
    #hud-mission { position: fixed; left: 14px; top: 208px; max-width: 320px; color: #fff; background: rgba(0,0,0,.5);
      border-left: 4px solid #ffd166; padding: 8px 12px; border-radius: 4px; font-size: 14px; line-height: 1.45; display: none; }
    #hud-mission b { color: #ffd166; }
    #hud-bottom-right { position: fixed; right: 16px; bottom: 16px; text-align: right; color: #fff; text-shadow: 0 1px 3px #000; }
    #hud-speed { font-size: 30px; font-weight: bold; } #hud-speed span { font-size: 14px; font-weight: normal; }
    #hud-car { font-size: 14px; color: #ffd166; } #hud-ammo { font-size: 14px; color: #dfeef5; }
    #hud-health { position: fixed; left: 14px; bottom: 16px; width: 220px; height: 18px; background: rgba(0,0,0,.55);
      border: 1px solid rgba(255,255,255,.6); border-radius: 9px; overflow: hidden; }
    #hud-health-fill { height: 100%; width: 100%; background: linear-gradient(90deg,#37d67a,#7dff9a); transition: width .2s; }
    #hud-health.low #hud-health-fill { background: linear-gradient(90deg,#e5484d,#ff7a5c); }
    #hud-health-text { position: absolute; inset: 0; text-align: center; font-size: 12px; line-height: 18px; color: #fff; text-shadow: 0 1px 2px #000; }
    #hud-banner { position: fixed; left: 50%; top: 34%; transform: translate(-50%,-50%) scale(.9); font-size: 72px; font-weight: bold;
      letter-spacing: 8px; color: #ff4d4d; text-shadow: 0 4px 0 rgba(0,0,0,.5); opacity: 0; transition: opacity .25s, transform .25s; pointer-events: none; }
    #hud-banner.show { opacity: 1; transform: translate(-50%,-50%) scale(1); }
    #hud-pause { position: fixed; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center;
      color: #fff; background: rgba(4,20,32,.72); text-align: center; pointer-events: auto; }
    #hud-pause h2 { font-size: 52px; letter-spacing: 10px; color: #ffd166; margin: 0 0 8px; }
    #hud-pause .dim { color: #a9c6d2; font-size: 14px; }`;
  document.head.appendChild(style);

  const map = document.getElementById('minimap');
  const mctx = map.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const els = {
    wanted: $('hud-wanted'), money: $('hud-money'), time: $('hud-time'),
    mission: $('hud-mission'), speed: $('hud-speed'), car: $('hud-car'),
    ammo: $('hud-ammo'), health: $('hud-health'), fill: $('hud-health-fill'),
    healthText: $('hud-health-text'), banner: $('hud-banner'),
    pause: $('hud-pause'), location: $('hud-location'),
  };

  const HALF = world.half || 145;
  const R = 88; // minimap radius in px
  const toMap = (x, z) => [R + (x / HALF) * (R - 6), R + (z / HALF) * (R - 6)];
  let last = {};
  let bannerTimer = 0;

  function drawMinimap() {
    const c = mctx;
    c.clearRect(0, 0, 176, 176);
    c.save();
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.clip();
    // Water south, land, street grid.
    c.fillStyle = '#1d4a63'; c.fillRect(0, 0, 176, 176);
    c.fillStyle = '#2c4a3a'; c.fillRect(0, 0, 176, 176);
    c.fillStyle = '#3d3d46';
    for (const s of world.streets) {
      const [x] = toMap(s, 0); const [, z] = toMap(0, s);
      c.fillRect(x - 3, 0, 6, 176); c.fillRect(0, z - 3, 176, 6);
    }
    c.fillStyle = '#2a7fa8';
    const [, seaZ] = toMap(0, HALF + 20); c.fillRect(0, seaZ, 176, 176 - seaZ);
    // Park at the centre block.
    c.fillStyle = '#4d8a3f';
    const [px, pz] = toMap(world.parkCenter.x, world.parkCenter.z);
    c.fillRect(px - 14, pz - 14, 28, 28);
    const dot = (x, z, color, r) => {
      const [mx, mz] = toMap(x, z);
      c.fillStyle = color; c.beginPath(); c.arc(mx, mz, r, 0, Math.PI * 2); c.fill();
    };
    // Mission target: gold diamond.
    const target = api.getMissionTarget && api.getMissionTarget();
    if (target) {
      const [mx, mz] = toMap(target.x, target.z);
      c.fillStyle = '#ffd166';
      c.beginPath(); c.moveTo(mx, mz - 7); c.lineTo(mx + 6, mz); c.lineTo(mx, mz + 7); c.lineTo(mx - 6, mz); c.closePath(); c.fill();
      c.strokeStyle = '#fff'; c.stroke();
    }
    for (const car of api.getParkedCars()) dot(car.x, car.z, '#9aa7b0', 2.5);
    for (const car of api.getTrafficCars()) dot(car.x, car.z, '#ffffff', 3);
    for (const p of api.getPeds()) dot(p.x, p.z, '#c9c9c9', 1.6);
    const flash = Math.floor(performance.now() / 350) % 2 === 0;
    for (const u of api.getPolice()) dot(u.x, u.z, flash ? '#ff3b30' : '#3b82ff', 4);
    // Player arrow, pointing along the camera yaw.
    const pp = api.getPlayerPos();
    const [mx, mz] = toMap(pp.x, pp.z);
    c.save(); c.translate(mx, mz); c.rotate(api.getCamYaw());
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 2;
    c.beginPath(); c.arc(R, R, R - 1, 0, Math.PI * 2); c.stroke();
  }

  function stars(n) {
    let s = '';
    for (let i = 0; i < 5; i++) s += `<span class="${i < n ? 'lit' : 'dim'}">★</span>`;
    return s;
  }

  function refresh() {
    // Wanted stars.
    if (last.wanted !== state.wanted) {
      last.wanted = state.wanted;
      els.wanted.innerHTML = stars(state.wanted);
      els.wanted.classList.toggle('hot', state.wanted > 0);
    }
    if (last.money !== state.money) {
      last.money = state.money;
      els.money.textContent = '$' + state.money.toLocaleString('en-US');
    }
    const hh = Math.floor(state.timeMinutes / 60) % 24;
    const mm = Math.floor(state.timeMinutes % 60);
    const t = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (last.time !== t) { last.time = t; els.time.textContent = t; }
    // Health.
    const hp = Math.max(0, Math.round(state.health));
    if (last.hp !== hp) {
      last.hp = hp;
      els.fill.style.width = hp + '%';
      els.healthText.textContent = hp;
      els.health.classList.toggle('low', hp <= 30);
    }
    // Mission objective.
    const m = state.mission;
    const mKey = m ? `${m.id}|${m.status}|${m.objective}|${m.timeLeft ?? ''}` : 'none';
    if (last.mission !== mKey) {
      last.mission = mKey;
      if (!m || m.status === 'idle') {
        els.mission.style.display = 'none';
      } else {
        els.mission.style.display = 'block';
        const timer = m.timeLeft != null ? ` &middot; ${m.timeLeft}s left` : '';
        els.mission.innerHTML = `<b>${m.title}</b> — ${m.objective}<br>` +
          `<span style="color:#a9c6d2">Reward $${m.reward}${timer} &middot; press M for the next job</span>`;
      }
    }
    // Speed, car, ammo.
    const kmh = Math.round(Math.abs(api.getSpeed()) * 3.6);
    if (last.kmh !== kmh) { last.kmh = kmh; els.speed.innerHTML = `${kmh} <span>km/h</span>`; }
    const carName = state.inCar ? (state.carName || 'Car') : '';
    if (last.car !== carName) { last.car = carName; els.car.textContent = carName; }
    const ammo = api.getAmmo ? api.getAmmo() : null;
    const ammoKey = ammo ? `${ammo.mag}/${ammo.reserve}` : '';
    if (last.ammo !== ammoKey) {
      last.ammo = ammoKey;
      els.ammo.textContent = ammo ? `Pico-9  ${ammo.mag} / ${ammo.reserve}` : '';
    }
    // District label from position.
    const pp = api.getPlayerPos();
    const district = pp.z > 120 ? 'South Docks' : pp.z < -110 ? 'North Market' :
      Math.abs(pp.x) < 30 && Math.abs(pp.z) < 30 ? 'Marina Verde' : 'Porto Verde';
    if (last.district !== district) { last.district = district; els.location.textContent = district; }
    drawMinimap();
  }

  function showBanner(text, ms = 1600) {
    els.banner.textContent = text;
    els.banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => els.banner.classList.remove('show'), ms);
  }

  function setPaused(paused) {
    els.pause.style.display = paused ? 'flex' : 'none';
  }

  return { refresh, showBanner, setPaused };
}
