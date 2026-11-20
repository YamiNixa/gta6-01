// Porto Verde — audio.js: every sound is synthesised with WebAudio.
// Engine hum, gunshots, sirens, pickup chimes and UI clicks, plus a calm
// chord-pad music loop that grows tense when the police are after you.
// Nothing here is a recording or a commercial track. Audio starts only
// after the player's first gesture, as browsers require.
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicTimer = null;
  let musicStep = 0;
  let started = false;
  let wanted = 0;
  let inCar = false;
  let speed = 0;

  // Calm loop: Am – F – C – G pads, one chord a bar. The tension layer
  // adds a pulsing minor second voice while the player is wanted.
  const CHORDS = [
    [220.0, 261.6, 329.6], [174.6, 220.0, 261.6],
    [196.0, 261.6, 329.6], [196.0, 246.9, 293.7],
  ];

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      // Engine: a sawtooth through a low-pass, pitch follows speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter).connect(engineGain).connect(master);
      engineOsc.start();
      // Siren: a triangle that wails between two notes.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 720;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain).connect(master);
      sirenOsc.start();
      return true;
    } catch { return false; }
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (started) return;
    started = true;
    // Resume on the first real gesture too (the ?shot= path starts play
    // without one, so the context stays suspended until the player acts).
    const resume = () => { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    // One chord a bar (2.4 s); each note fades in and out softly.
    const bar = () => {
      if (!ctx || ctx.state !== 'running') return;
      const chord = CHORDS[musicStep % CHORDS.length];
      musicStep++;
      const t0 = ctx.currentTime;
      for (const f of chord) {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.05, t0 + 0.6);
        g.gain.linearRampToValueAtTime(0.0, t0 + 2.4);
        o.connect(g).connect(master);
        o.start(t0); o.stop(t0 + 2.5);
      }
      if (wanted > 0) {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = 440 + wanted * 30;
        const g = ctx.createGain();
        const pulse = 0.03 + wanted * 0.008;
        g.gain.setValueAtTime(0, t0);
        for (let i = 0; i < 4; i++) {
          g.gain.linearRampToValueAtTime(pulse, t0 + 0.3 + i * 0.6);
          g.gain.linearRampToValueAtTime(0, t0 + 0.6 + i * 0.6);
        }
        o.connect(g).connect(master);
        o.start(t0); o.stop(t0 + 2.4);
      }
    };
    bar();
    musicTimer = setInterval(bar, 2400);
  }

  function blip(freq, dur, type, vol, when = 0) {
    if (!ctx || !started) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type || 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, vol, cutoff) {
    if (!ctx || !started) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff || 3000;
    const g = ctx.createGain(); g.gain.value = vol || 0.4;
    src.connect(f).connect(g).connect(master);
    src.start();
  }

  function play(name) {
    if (!ctx || !started) return;
    if (name === 'shot') { noiseBurst(0.14, 0.5, 2600); blip(140, 0.1, 'square', 0.15); }
    else if (name === 'punch') { noiseBurst(0.09, 0.3, 500); blip(90, 0.12, 'sine', 0.3); }
    else if (name === 'pickup') { blip(660, 0.12, 'sine', 0.22); blip(990, 0.2, 'sine', 0.22, 0.1); }
    else if (name === 'click') { blip(520, 0.06, 'sine', 0.15); }
    else if (name === 'mission') { blip(523, 0.14, 'sine', 0.2); blip(659, 0.14, 'sine', 0.2, 0.12); blip(784, 0.25, 'sine', 0.2, 0.24); }
    else if (name === 'fail') { blip(220, 0.3, 'sawtooth', 0.12); blip(165, 0.4, 'sawtooth', 0.12, 0.15); }
    else if (name === 'enter') { blip(180, 0.12, 'sine', 0.2); blip(320, 0.1, 'sine', 0.15, 0.08); }
  }

  // Called every frame: engine follows speed, siren follows the wanted level.
  function update(dt, s) {
    if (!ctx || !started || ctx.state !== 'running') return;
    wanted = s.wanted; inCar = s.inCar; speed = Math.abs(s.speed);
    const target = inCar ? 0.05 + Math.min(0.16, speed * 0.008) : 0;
    engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
    engineOsc.frequency.setTargetAtTime(50 + speed * 9, ctx.currentTime, 0.08);
    engineFilter.frequency.setTargetAtTime(280 + speed * 60, ctx.currentTime, 0.1);
    const sirenTarget = wanted > 0 ? 0.035 + wanted * 0.006 : 0;
    sirenGain.gain.setTargetAtTime(sirenTarget, ctx.currentTime, 0.3);
    if (wanted > 0) {
      const wail = 660 + 240 * Math.sin(ctx.currentTime * 2.4);
      sirenOsc.frequency.setTargetAtTime(wail, ctx.currentTime, 0.05);
    }
  }

  function stop() {
    if (musicTimer) clearInterval(musicTimer);
    if (ctx) ctx.close().catch(() => {});
    ctx = null; started = false;
  }

  return {
    unlock, play, update, stop,
    get running() { return started && !!ctx && ctx.state === 'running'; },
  };
}
