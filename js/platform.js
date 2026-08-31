// Eight Webs — platform: local persistence, hosted REST adapter with
// retries + rate-limit handling, round-trip-adjusted server time, anonymous
// funnel telemetry, and score/achievement submission. ES module.

export const PLATFORM_VERSION = 1;

export class Platform {
  constructor() {
    this.token = null;              // launch/account token from the host shell
    this.playerId = this.ensurePlayerId();
    this.offsetMs = 0;              // server-minus-client clock offset
    this.consent = false;           // telemetry consent flag
    this.online = typeof navigator === 'undefined' ? false : navigator.onLine;
    if (typeof window !== 'undefined') {
      // Launch token arrives via the host shell; never persisted.
      const params = new URLSearchParams(window.location.search);
      this.token = params.get('launch_token') || null;
      window.addEventListener('online', () => { this.online = true; });
      window.addEventListener('offline', () => { this.online = false; });
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

  // --- local persistence ----------------------------------------------------
  saveLocal(key, value) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch { /* storage full or blocked: non-fatal */ }
  }

  loadLocal(key) {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch { return null; }
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

  // Round-trip-adjusted offset against GET /api/v1/time.
  async syncServerTime() {
    try {
      const t0 = Date.now();
      const r = await this.api('/time');
      const t1 = Date.now();
      this.offsetMs = r.now - Math.round((t0 + t1) / 2);
    } catch { /* offline: countdowns fall back to local clock */ }
    return this.offsetMs;
  }

  serverOffsetMs() { return this.offsetMs; }
  serverNow() { return Date.now() + this.offsetMs; }

  // --- score + achievement submission ------------------------------------------
  async submitScore(def, envelope) {
    const board = def.mode === 'daily' ? `daily:${def.goals?.daily}` : `global:${def.suits}suit`;
    try {
      const r = await this.api('/score', { board, envelope });
      return r;
    } catch (e) {
      // Offline or rejected: label handled by UI; practice runs never submit.
      return { error: e.message, casual: true };
    }
  }

  async reportAchievements(keys) {
    try { await this.api('/achievements', { playerId: this.playerId, keys }); } catch { /* durable locally */ }
  }

  recordResult() { /* results are persisted locally by the session; hosted
    submission happens through submitScore() for ranked content only. */ }

  // --- telemetry: anonymous funnel only, explicit consent ----------------------
  telemetry(event, props = {}) {
    if (!this.consent) return;
    const allowed = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
    if (!allowed.includes(event)) return;
    try { navigator.sendBeacon?.('/api/v1/telemetry', JSON.stringify({ event, props, t: Date.now() })); } catch {}
  }
}
