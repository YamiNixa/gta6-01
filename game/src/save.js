// Porto Verde — save.js: saving and loading through localStorage.
// Stores the player's position, money, health, wanted level, mission
// progress, ammo and the car they were driving. Ctrl+S saves by hand;
// missions auto-save on completion. Loading restores it all on the
// start screen, so a session picks up where it left off.
const SAVE_KEY = 'porto-verde-save-v1';

export function createSave(api) {
  function save(silent) {
    try {
      const data = {
        version: 1,
        x: api.getPlayerPos().x,
        z: api.getPlayerPos().z,
        money: api.state.money,
        health: api.state.health,
        wanted: api.state.wanted,
        timeMinutes: api.state.timeMinutes,
        mission: api.getMissionProgress(),
        ammo: api.getAmmo(),
        reserve: api.getReserve(),
        car: api.getCarState(),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      if (!silent) api.toast('Game saved.');
      return true;
    } catch {
      if (!silent) api.toast('Could not save — storage unavailable.');
      return false;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (typeof s.x !== 'number' || typeof s.z !== 'number') return false;
      api.setPlayerPos(s.x, s.z);
      api.state.money = s.money ?? api.state.money;
      api.state.health = s.health ?? api.state.health;
      api.state.wanted = Math.max(0, Math.min(5, s.wanted ?? 0));
      api.state.timeMinutes = s.timeMinutes ?? api.state.timeMinutes;
      if (s.ammo != null) api.setAmmo(s.ammo, s.reserve ?? 48);
      if (s.mission) api.setMissionProgress(s.mission);
      if (s.car) api.setCarState(s.car);
      api.toast('Save loaded — welcome back to Porto Verde.');
      return true;
    } catch {
      return false;
    }
  }

  return { save, load, autoSave() { return save(true); }, key: SAVE_KEY };
}
