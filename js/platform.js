// Eight Webs — platform: local persistence, hosted REST adapter with
// retries + rate-limit handling, round-trip-adjusted server time, the
// StarHermit launch-token lifecycle, profile nicknames, the cloud-save
// mirror for progress, and score/achievement submission. ES module.
//
// Hosted contract (wiki): the launch token arrives in the URL fragment
// `#game_token=<jwt>` (optional `&session_id=`, stripped after the read;
// query `?launch_token=` kept for local dev). The JWT carries sub = user id
// and game_scope = this game's slug — never hard-coded. Every call sends
// Authorization: Bearer; the token re-mints every 45 min via
// POST /api/v1/games/{slug}/launch-token. The display name is the profile
// nickname from GET /api/v1/users/{sub}/profile — never usernames, never
// /api/v1/me. Cloud save is ONE zip+base64 slot at
// GET/PUT /api/v1/me/cloud-saves/{slug} for the progress document.
// The own-server score/leaderboard/achievement routes are its backend
// (declared server=server.js): they carry the Bearer + account identity and
// degrade gracefully when the backend is absent.

export const PLATFORM_VERSION = 1;

const REFRESH_MS = 45 * 60 * 1000; // token lives 60 min; re-mint at 45
const RETRY_MS = 60 * 1000;
const SAVE_DEBOUNCE_MS = 2000;

// Minimal ZIP writer/reader (stored entries only, no compression).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0);
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export class Platform {
  constructor() {
    this.token = null;              // launch token from the URL; never persisted
    this.userId = null;             // JWT sub
    this.slug = null;               // JWT game_scope — never hard-coded
    this.tokenHosted = false;       // a launch token was read (platform identity)
    this.hosted = false;            // own-server backend reachable; gates its routes
    this.profile = null;            // { name } for the signed-in player
    this.sync = 'offline';          // offline | saving | synced (cloud mirror)
    this.playerId = this.ensurePlayerId(); // offline fallback identity
    this.offsetMs = 0;              // server-minus-client clock offset
    this.consent = false;           // telemetry consent flag
    this.online = typeof navigator === 'undefined' ? false : navigator.onLine;
    this._refreshTimer = null;
    this._retryTimer = null;
    this._saveTimer = null;
    this._pendingSave = null;
    this._profileNames = {};
    this._syncListeners = new Set();
    if (typeof window !== 'undefined') {
      this.token = this._readLaunchToken();
      if (this.token) {
        const claims = this._decodeJwt(this.token);
        if (!claims) this.token = null;
        else {
          if (typeof claims.sub === 'string' && claims.sub) this.userId = claims.sub;
          if (typeof claims.game_scope === 'string' && claims.game_scope) this.slug = claims.game_scope;
          if (!this.userId || !this.slug) this.token = null; // unusable token
        }
      }
      this.tokenHosted = !!this.token;
      if (this.tokenHosted) {
        this._refreshTimer = setInterval(() => this.refreshToken(), REFRESH_MS);
        try {
          window.addEventListener('pagehide', () => this.flushSave());
          document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushSave(); });
        } catch { /* no window events available */ }
      }
      window.addEventListener('online', () => { this.online = true; });
      window.addEventListener('offline', () => { this.online = false; });
    }
  }

  async init() {
    if (this.tokenHosted) this.fetchProfile().catch(() => {});
    await this.syncServerTime();
  }

  // Fragment first (platform contract); query forms are local-dev only.
  _readLaunchToken() {
    try {
      const h = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
      const t = h.get('game_token');
      if (t) {
        h.delete('game_token');
        h.delete('session_id');
        const rest = h.toString();
        window.history.replaceState(null, '', window.location.pathname + window.location.search + (rest ? '#' + rest : ''));
        return t;
      }
      const q = new URLSearchParams(window.location.search);
      return q.get('game_token') || q.get('launch_token') || q.get('token') || null;
    } catch {
      return null;
    }
  }

  _decodeJwt(token) {
    try {
      const seg = String(token).split('.')[1];
      if (!seg) return null;
      let b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
      b64 += '='.repeat((4 - (b64.length % 4)) % 4);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  // Token refresh: scoped tokens may re-mint via the game's launch-token
  // route. Retry a failed re-mint after ~60 s.
  async refreshToken() {
    if (!this.token || !this.slug) return false;
    try {
      const res = await fetch(`/api/v1/games/${encodeURIComponent(this.slug)}/launch-token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` }, body: '{}',
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && typeof data.token === 'string' && data.token) {
        this.token = data.token; // memory only
        const claims = this._decodeJwt(this.token);
        if (claims && claims.sub) this.userId = claims.sub;
        if (claims && claims.game_scope) this.slug = claims.game_scope;
        return true;
      }
    } catch { /* fall through to retry */ }
    if (!this._retryTimer) {
      this._retryTimer = setTimeout(() => { this._retryTimer = null; this.refreshToken(); }, RETRY_MS);
    }
    return false;
  }

  /* Identity: the profile nickname is the only profile read a game-scoped
   * token may make. Never usernames, never /api/v1/me. */
  profileFor(userId) {
    if (!userId || typeof userId !== 'string') return Promise.resolve('player');
    if (this._profileNames[userId]) return this._profileNames[userId];
    const p = fetch(`/api/v1/users/${encodeURIComponent(userId)}/profile`, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    }).then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && typeof j.nickname === 'string' && j.nickname ? j.nickname : null))
      .then((n) => n || (`Player ${userId.slice(0, 8)}`))
      .catch(() => `Player ${userId.slice(0, 8)}`);
    this._profileNames[userId] = p;
    return p;
  }

  async fetchProfile() {
    if (!this.userId) return null;
    const name = (await this.profileFor(this.userId)).slice(0, 40);
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
      // Mirror the progress document to the cloud slot when hosted.
      if (key === 'eightwebs:progress' && this.tokenHosted && value != null) {
        this._pendingSave = JSON.stringify(value);
        this._setSync('saving');
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
      }
    } catch { /* storage full or blocked: non-fatal */ }
  }

  loadLocal(key) {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch { return null; }
  }

  /* Cloud save: ONE zip+base64 slot at /api/v1/me/cloud-saves/{slug} holding
   * the progress document. Remote wins on boot (the caller validates the
   * shape); saves debounce ~2 s and flush on pagehide/hidden with keepalive. */
  async loadCloudSave() {
    if (!this.tokenHosted || !this.slug) return null;
    try {
      const res = await fetch(`/api/v1/me/cloud-saves/${encodeURIComponent(this.slug)}`, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`http-${res.status}`);
      const buf = await res.arrayBuffer();
      if (!buf || !buf.byteLength) return null;
      return new TextDecoder().decode(unzipFirstEntry(new Uint8Array(buf)));
    } catch {
      return null;
    }
  }

  async flushSave() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (!this.tokenHosted || !this.slug || this._pendingSave == null) return false;
    const docJson = this._pendingSave;
    this._pendingSave = null;
    let body;
    try {
      body = { dataBase64: bytesToBase64(zipStore('save.json', new TextEncoder().encode(docJson))) };
    } catch {
      return false;
    }
    try {
      const res = await fetch(`/api/v1/me/cloud-saves/${encodeURIComponent(this.slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (res.ok) { this._setSync('synced'); return true; }
      this._pendingSave = this._pendingSave == null ? docJson : this._pendingSave;
      this._setSync('offline');
      return false;
    } catch {
      this._pendingSave = this._pendingSave == null ? docJson : this._pendingSave;
      this._setSync('offline');
      return false;
    }
  }

  ensurePlayerId() {
    let id = this.loadLocal('eightwebs:player');
    if (!id) {
      id = 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      this.saveLocal('eightwebs:player', id);
    }
    return id;
  }

  // --- hosted REST ------------------------------------------------------------
  async api(path, body, { retries = 2 } = {}) {
    if (typeof fetch === 'undefined') throw new Error('offline');
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`/api/v1${path}`, { method: body !== undefined ? 'POST' : 'GET', headers, body: payload });
        if (res.status === 429) { // rate limited: recoverable, back off
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { code: data?.error_code });
        return data;
      } catch (e) {
        lastErr = e;
        if (e.code) throw e; // structured error: not retryable
        if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  // Probe the one route every host guarantees: GET /api/v1/time. Its result
  // sets the `hosted` flag for the own-server backend; when it fails, every
  // its-backend feature below is a local no-op and never issues a request.
  async syncServerTime() {
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
      this.hosted = true;
    } catch {
      // Offline or unhosted: countdowns fall back to the local clock.
      this.hosted = false;
      this.offsetMs = 0;
    }
    return this.offsetMs;
  }

  serverOffsetMs() { return this.offsetMs; }
  serverNow() { return Date.now() + this.offsetMs; }

  // --- score + achievement submission (its-backend, identity-carrying) --------
  async submitScore(def, envelope) {
    if (!this.hosted) return { error: 'offline', casual: true };
    const board = def.mode === 'daily' ? `daily:${def.goals?.daily}` : `global:${def.suits}suit`;
    try {
      const r = await this.api('/score', {
        board,
        envelope,
        identity: {
          playerId: this.identityId,
          name: this.displayName || undefined,
        },
      });
      return r;
    } catch (e) {
      // Offline or rejected: label handled by UI; practice runs never submit.
      return { error: e.message, casual: true };
    }
  }

  async reportAchievements(keys) {
    if (!this.hosted) return;
    try {
      await this.api('/achievements', { playerId: this.identityId, keys });
    } catch { /* durable locally */ }
  }

  async fetchLeaderboard(board = 'global') {
    if (!this.hosted) return { entries: [] };
    try { return await this.api(`/leaderboard/${board}`); } catch { return { entries: [] }; }
  }

  recordResult() { /* results are persisted locally by the session; hosted
    submission happens through submitScore() for ranked content only. */ }

  // --- telemetry: anonymous funnel only, explicit consent ----------------------
  telemetry(event, props = {}) {
    if (!this.consent || !this.hosted) return;
    const allowed = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
    if (!allowed.includes(event)) return;
    try { navigator.sendBeacon?.('/api/v1/telemetry', JSON.stringify({ event, props, t: Date.now() })); } catch {}
  }
}
