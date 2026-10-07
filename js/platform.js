// Eight Webs — platform: local persistence plus a thin layer over
// window.StarHermit (starhermit-sdk.js, loaded as a classic script before the
// module graph). The SDK reads the launch token (#game_token= /
// #access_token=), strips it, renews it and makes the platform calls; this
// class keeps the game's API: profile nickname, the cloud-save mirror of the
// progress document at /api/v1/me/cloud-saves/game:<slug> (remote wins on
// boot; debounced saves with a pagehide flush), the settings KV, key
// bindings, sign-in and invite link. The only own-server call is GET
// /api/v1/time, made only with a launch token; standalone play makes no
// own-server requests and uses the local clock. Signed in, a finished ranked
// round's total goes to the StarHermit `high-score` leaderboard through
// StarHermit.submitScores (score-script.js). History and achievements stay local.

export const PLATFORM_VERSION = 1;

const SAVE_DEBOUNCE_MS = 2000;
const PATCH_DEBOUNCE_MS = 400;
const sdk = () => (typeof window !== 'undefined' && window.StarHermit) || null;

export class Platform {
  constructor() {
    this.profile = null;            // { name } for the signed-in player
    this.sync = 'offline';          // offline | saving | synced (cloud mirror)
    this.playerId = this.ensurePlayerId(); // offline fallback identity
    this.offsetMs = 0;              // server-minus-client clock offset
    this._syncListeners = new Set();
    this._authListeners = new Set();
    this._patch = null;
    this._patchTimer = null;
    this._patchWaiters = [];
    const s = sdk();
    if (s) {
      s.init(); // read the launch token before anything touches the fragment
      s.on('saved', (ok) => { if (this.tokenHosted) this._setSync(ok ? 'synced' : 'offline'); });
      s.on('auth', (a) => {
        if (!(a && a.signedIn)) { this.profile = null; this._setSync('offline'); this.offsetMs = 0; }
        else this.syncServerTime().catch(() => {});
        for (const fn of this._authListeners) { try { fn(!!(a && a.signedIn)); } catch { /* ok */ } }
      });
    }
    if (typeof window !== 'undefined') {
      try {
        window.addEventListener('pagehide', () => this.flushSave(true));
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushSave(true); });
      } catch { /* no window events available */ }
    }
  }

  get token() { return sdk()?.token || null; }
  get userId() { return sdk()?.userId || null; }
  get slug() { return sdk()?.slug || null; }
  /** A launch token is held (platform identity + cloud save). */
  get tokenHosted() { const s = sdk(); return !!(s && s.signedIn && s.slug); }

  async init() {
    if (this.tokenHosted) this.fetchProfile().catch(() => {});
    await this.syncServerTime();
  }

  onAuth(fn) { if (typeof fn === 'function') this._authListeners.add(fn); }
  canSignIn() { return !!sdk()?.canSignIn(); }
  signIn() { return !!sdk()?.signIn(); }
  inviteLink() { return this.tokenHosted ? sdk()?.inviteLink() || null : null; }

  /* Identity: the profile nickname (SDK: nickname, then "Player <id>"). */
  profileFor(userId) {
    const s = sdk();
    if (!s || !this.tokenHosted || !userId) return Promise.resolve('player');
    return s.profile(String(userId)).then((p) => (p ? p.displayName : `Player ${String(userId).slice(0, 6)}`));
  }

  async fetchProfile() {
    if (!this.tokenHosted) return null;
    const name = String(await this.profileFor(this.userId)).slice(0, 40);
    this.profile = { name };
    return this.profile;
  }

  get displayName() {
    return this.tokenHosted && this.profile ? this.profile.name : null;
  }
  // Account identity for its-backend rows/achievements (offline id fallback).
  get identityId() { return this.tokenHosted ? this.userId : this.playerId; }

  onSync(fn) { if (typeof fn === 'function') this._syncListeners.add(fn); }
  _setSync(state) {
    if (this.sync === state) return;
    this.sync = state;
    for (const fn of this._syncListeners) {
      try { fn(state); } catch { /* listener errors never break the adapter */ }
    }
  }

  // --- local persistence ----------------------------------------------------
  saveLocal(key, value) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch { /* storage full or blocked: non-fatal */ }
    // Mirror the progress document to the cloud slot when signed in.
    if (key === 'eightwebs:progress' && value != null && this.tokenHosted) {
      try { sdk().saveJSON(value, SAVE_DEBOUNCE_MS); this._setSync('saving'); } catch { /* non-fatal */ }
    }
  }

  loadLocal(key) {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch { return null; }
  }

  /* Cloud save through the SDK slot; returns the raw doc JSON or null. */
  async loadCloudSave() {
    const s = sdk();
    if (!s || !this.tokenHosted) return null;
    try {
      const obj = await s.loadJSON();
      if (this.sync === 'offline') this._setSync('synced');
      return obj ? JSON.stringify(obj) : null;
    } catch {
      return null;
    }
  }

  async flushSave(keepalive) {
    const s = sdk();
    if (!s || !this.tokenHosted) return false;
    return s.flushSave(keepalive === true);
  }

  // --- settings KV + controls (StarHermit) ------------------------------------
  getSettings() {
    const s = sdk();
    return s && this.tokenHosted ? s.getSettings().catch(() => ({})) : Promise.resolve({});
  }
  patchSettings(obj) {
    const s = sdk();
    if (!s || !this.tokenHosted) return Promise.resolve(null);
    this._patch = Object.assign(this._patch || {}, obj);
    if (this._patchTimer) clearTimeout(this._patchTimer);
    return new Promise((resolve) => {
      this._patchWaiters.push(resolve);
      this._patchTimer = setTimeout(() => {
        const body = this._patch, waiters = this._patchWaiters;
        this._patch = null; this._patchTimer = null; this._patchWaiters = [];
        const done = (v) => waiters.forEach((w) => w(v));
        s.patchSettings(body).then(done, () => done(null));
      }, PATCH_DEBOUNCE_MS);
    });
  }
  loadBindings(defaults) {
    const copy = () => Object.fromEntries(Object.entries(defaults || {}).map(([k, v]) => [k, v.slice()]));
    const s = sdk();
    if (!s || !this.tokenHosted) return Promise.resolve(copy());
    return s.loadBindings(defaults).catch(copy);
  }

  ensurePlayerId() {
    let id = this.loadLocal('eightwebs:player');
    if (!id) {
      id = 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      this.saveLocal('eightwebs:player', id);
    }
    return id;
  }

  // Server clock: GET /api/v1/time, signed in only. Standalone (no launch
  // token) never issues a request; countdowns use the local clock.
  async syncServerTime() {
    this.offsetMs = 0;
    if (!this.tokenHosted || typeof fetch === 'undefined') return 0;
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', {
        cache: 'no-store',
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (!res.ok) throw new Error('no-time');
      const r = await res.json();
      const t1 = Date.now();
      const serverMs = Number(r.now ?? r.serverTime ?? r.epochMs);
      if (!Number.isFinite(serverMs)) throw new Error('no-time');
      this.offsetMs = serverMs - Math.round((t0 + t1) / 2);
    } catch {
      this.offsetMs = 0; // unreachable: fall back to the local clock
    }
    return this.offsetMs;
  }

  serverOffsetMs() { return this.offsetMs; }
  serverNow() { return Date.now() + this.offsetMs; }

  recordResult() { /* results are persisted locally by the session */ }

  /* Post a finished ranked round to the StarHermit leaderboards (score-script.js);
     resolves { posted, rank } — rank on the high-score board, or null. Signed in only. */
  async submitScore(total) {
    const s = sdk();
    if (!s || !this.tokenHosted) return { posted: false, rank: null };
    try {
      const keys = await s.submitScores({ 'high-score': total });
      if (!(keys || []).includes('high-score')) return { posted: false, rank: null };
      try {
        const r = await s.leaderboard('high-score', { pageSize: 100 });
        const me = (r.items || []).find((i) => i.userId === s.userId);
        return { posted: true, rank: me ? me.rank : null };
      } catch { return { posted: true, rank: null }; }
    } catch { return { posted: false, rank: null }; }
  }
}
