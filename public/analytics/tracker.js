/* Shared by all 12 projects. Edit shared/analytics/tracker.js and run `node scripts/distribute-evius.mjs`. */
(() => {
  'use strict';
  const config = globalThis.BID_ANALYTICS_CONFIG || {};
  const projectId = config.projectId;
  const uid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  const seconds = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  // Evius: each button press is queued locally and relayed by the Netlify function (the token never reaches the browser).
  const evius = { endpoint: '/.netlify/functions/evius', batch: 200, ...(config.evius || {}) };
  const BUTTON_OF = { restart: 'reboot', backward: 'retroceder', forward: 'adelantar', home: 'back', pause: 'pause', play: 'pause' };
  const BACKOFF_MINUTES = [1, 2, 4, 8, 16, 30];
  const status = { local: 'starting', firebase: config.firebase ? 'pending' : 'disabled',
    evius: config.evius === false ? 'disabled' : 'pending', eviusError: null, error: null };
  let database, cloud, syncing = false, eviusTimer, eviusSending = false;
  const request = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  const ready = new Promise((resolve, reject) => {
    const req = indexedDB.open(`bid-interactions-${projectId}`, 2);
    req.onupgradeneeded = () => {
      for (const name of ['sessions', 'events', 'outbox', 'evius']) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      database = req.result; status.local = 'ready'; resolve();
      // A newer tracker in another tab needs to upgrade the database: release it instead of blocking that tab.
      database.onversionchange = () => { database.close(); status.local = 'closed'; failed('Base local cerrada: hay una versión más nueva del tótem en otra pestaña. Recarga esta página.'); };
    };
    req.onblocked = () => { status.local = 'blocked'; failed('Base local bloqueada por otra pestaña del tótem con una versión anterior. Cierra las demás pestañas del sitio y recarga.'); };
    req.onerror = () => reject(req.error);
  });
  function failed(error) {
    status.error = String(error?.message || error);
    console.warn('[BID analytics]', status.error);
  }
  ready.catch(error => { status.local = 'error'; failed(error); });
  async function transaction(names, work) {
    await ready;
    return new Promise((resolve, reject) => {
      const tx = database.transaction(names, 'readwrite');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      work(tx);
    });
  }
  async function all(name) {
    await ready;
    return request(database.transaction(name).objectStore(name).getAll());
  }
  // Copy at call time: later playback updates cannot change a queued transaction.
  function persist(session, events) {
    const snapshot = structuredClone(session);
    const additions = structuredClone(events);
    return transaction(['sessions', 'events', 'outbox'], tx => {
      tx.objectStore('sessions').put(snapshot);
      tx.objectStore('outbox').put({ id: `s:${snapshot.id}`, version: snapshot.version,
        path: `bidProjects/${projectId}/sessions/${snapshot.id}`, data: snapshot });
      for (const event of additions) {
        tx.objectStore('events').put(event);
        tx.objectStore('outbox').put({ id: `e:${event.id}`, version: 1,
          path: `bidProjects/${projectId}/sessions/${snapshot.id}/events/${event.id}`, data: event });
      }
    }).catch(error => { status.local = 'error'; failed(error); });
  }
  async function initializeCloud() {
    if (cloud) return cloud;
    const base = 'https://www.gstatic.com/firebasejs/13.1.0/';
    const [app, auth, firestore] = await Promise.all([
      import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js'),
    ]);
    const instance = app.initializeApp(config.firebase, `bid-analytics-${projectId}`);
    const identity = auth.getAuth(instance);
    await identity.authStateReady();
    if (!identity.currentUser) await auth.signInAnonymously(identity);
    cloud = { ...firestore, db: firestore.getFirestore(instance), identity };
    return cloud;
  }
  async function sync() {
    if (!config.firebase || syncing || navigator.onLine === false) return;
    syncing = true;
    try {
      const c = await initializeCloud();
      status.firebase = 'syncing';
      // Each successful batch removes only the exact versions it uploaded.
      // A newer local snapshot stays pending, including when playback continues during upload.
      // Event rules read their parent session. Keep at most 20 document accesses per batch.
      const nextBatch = async () => (await all('outbox'))
        .sort((a, b) => Number(b.id.startsWith('s:')) - Number(a.id.startsWith('s:'))).slice(0, 20);
      let pending = await nextBatch();
      while (pending.length) {
        const batch = c.writeBatch(c.db);
        for (const item of pending) batch.set(c.doc(c.db, item.path), {
          ...item.data, ownerUid: c.identity.currentUser.uid, receivedAt: c.serverTimestamp(),
        });
        await batch.commit();
        await transaction(['outbox'], tx => {
          const store = tx.objectStore('outbox');
          for (const item of pending) {
            const req = store.get(item.id);
            req.onsuccess = () => { if (req.result?.version === item.version) store.delete(item.id); };
          }
        });
        pending = await nextBatch();
      }
      status.firebase = 'synced'; status.error = null;
    } catch (error) {
      status.firebase = 'error'; failed(error);
    } finally { syncing = false; }
  }
  // ---- Evius relay -------------------------------------------------------------------------
  function eviusFailed(error) {
    status.eviusError = String(error?.message || error);
    console.warn('[BID analytics > Evius]', status.eviusError);
  }
  const backoff = attempts => BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] * 60000;
  function scheduleEvius(delay) {
    if (status.evius === 'disabled' || status.evius === 'unauthorized') return;
    clearTimeout(eviusTimer);
    eviusTimer = setTimeout(() => sendEvius().catch(() => {}), Math.max(0, delay));
  }
  function postpone(records) {
    return transaction(['evius'], tx => {
      const store = tx.objectStore('evius');
      for (const record of records) {
        const attempts = (record.attempts || 0) + 1;
        store.put({ ...record, attempts, nextAt: Date.now() + backoff(attempts - 1) });
      }
    }).catch(() => {});
  }
  async function sendEvius() {
    if (status.evius === 'disabled' || status.evius === 'unauthorized' || eviusSending || navigator.onLine === false) return;
    eviusSending = true;
    let due = [];
    try {
      const queue = await all('evius');
      const now = Date.now();
      due = queue.filter(r => (r.nextAt || 0) <= now).sort((a, b) => a.at.localeCompare(b.at)).slice(0, evius.batch);
      if (!due.length) {
        if (status.evius !== 'error') status.evius = queue.length ? 'waiting' : 'synced';
        return;
      }
      status.evius = 'sending';
      // A hung request must never freeze the queue: give up after 30 s and retry later.
      const response = await fetch(evius.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ projectId, records: due.map(({ attempts, nextAt, ...record }) => record) }) });
      const isJson = (response.headers.get('content-type') || '').includes('json');
      const body = isJson ? await response.json().catch(() => null) : null;
      if (response.status === 401 || body?.unauthorized) {
        status.evius = 'unauthorized';
        eviusFailed(body?.error || 'Evius rechazo el token. Renueva EVIUS_TOKEN en Netlify; no se reintenta.');
        return;
      }
      if (!body) throw new Error(`Relevo Evius no disponible (HTTP ${response.status})`);
      // Delivered or permanently invalid records leave the queue; the rest wait with growing delay.
      const done = new Set([...(body.sent || []), ...(body.rejected || [])]);
      await transaction(['evius'], tx => {
        const store = tx.objectStore('evius');
        for (const record of due) if (done.has(record.id)) store.delete(record.id);
      });
      const retry = due.filter(record => !done.has(record.id));
      due = [];
      if (retry.length) await postpone(retry);
      if (body.rejected?.length) eviusFailed(`${body.rejected.length} registro(s) invalidos descartados`);
      if (!response.ok || !body.ok) throw new Error(body.error || (body.errors || []).join('; ') || `HTTP ${response.status}`);
      status.evius = body.skipped ? `off (EVIUS_MODE=${body.mode})` : 'synced'; status.eviusError = null;
    } catch (error) {
      status.evius = 'error'; eviusFailed(error);
      if (due.length) await postpone(due);
    } finally {
      eviusSending = false;
      const remaining = await all('evius').catch(() => []);
      if (remaining.length) scheduleEvius(Math.min(...remaining.map(r => r.nextAt || 0)) - Date.now() + 1000);
    }
  }
  class Recorder {
    constructor(video) {
      this.video = video; this.session = null; this.enabled = false; this.last = null; this.pending = [];
      this.range = null; this.saves = Promise.resolve();
      for (const type of ['timeupdate', 'pause', 'waiting', 'ended']) video.addEventListener(type, () => {
        this.sample();
        if (type !== 'timeupdate') { this.flushRange(); this.last = null; }
        if (this.enabled && this.session && type !== 'timeupdate' && type !== 'ended') this.event(type);
        if (type !== 'timeupdate') this.save();
      });
      for (const type of ['playing', 'seeked', 'ratechange']) video.addEventListener(type, () => {
        this.last = this.enabled && !video.paused ? this.position() : null;
        if (this.enabled && this.session && type === 'playing') this.event('playing');
        this.save();
      });
      video.addEventListener('seeking', () => { this.flushRange(); this.last = null; });
      video.addEventListener('error', () => { this.event('video_error', { code: video.error?.code || 0 }); this.save(); });
      setInterval(() => { this.sample(); this.flushRange(); this.save(); }, 5000);
      globalThis.addEventListener('pagehide', () => this.end('pagehide'));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { this.sample(); this.flushRange(); this.save(); }
      });
    }
    position() { return { time: seconds(this.video.currentTime), wall: performance.now() }; }
    start() {
      if (this.session) this.end('replaced');
      this.session = { id: uid(), projectId, projectName: config.projectName, deviceId: config.deviceId || null,
        startedAt: new Date().toISOString(), endedAt: null, endReason: null, status: 'active',
        duration: seconds(this.video.duration), lastPosition: seconds(this.video.currentTime),
        watchedSeconds: 0, segments: {}, eventCount: 0, version: 0 };
      this.enabled = false; this.last = null;
      this.event('session_start'); this.save();
    }
    enable() {
      if (!this.session) return;
      this.enabled = true; this.last = null;
      this.event('intro_complete'); this.save();
    }
    event(type, data = {}) {
      if (!this.session) return;
      const sequence = ++this.session.eventCount;
      this.pending.push({ id: `${this.session.id}_${String(sequence).padStart(8, '0')}`,
        sessionId: this.session.id, projectId, sequence, type, at: new Date().toISOString(),
        position: seconds(this.video.currentTime), ...data });
    }
    action(type, target) {
      if (!this.session) return;
      this.sample(); this.flushRange();
      this.event(type, target === undefined ? {} : { from: seconds(this.video.currentTime), to: seconds(target) });
      if (target !== undefined) this.last = null;
      // 'play' also fires automatically after the intro; the player reports that button via press().
      if (type !== 'play') this.press(type);
      this.save();
    }
    // One physical button press for Evius: restart | backward | forward | home | pause | play.
    press(type) {
      const button = BUTTON_OF[type];
      if (!button || !this.session || status.evius === 'disabled') return;
      const record = { id: uid(), sessionId: this.session.id, projectId, projectName: config.projectName || null,
        deviceId: config.deviceId || null, button, action: type, at: new Date().toISOString(),
        position: seconds(this.video.currentTime), attempts: 0, nextAt: 0 };
      transaction(['evius'], tx => tx.objectStore('evius').put(record))
        .then(() => scheduleEvius(500)).catch(eviusFailed);
    }
    sample() {
      if (!this.session || !this.enabled) return;
      const next = this.position();
      const previous = this.last;
      this.last = !this.video.paused && !this.video.seeking && this.video.readyState >= 2 ? next : null;
      if (!previous || this.video.seeking) return;
      const delta = next.time - previous.time;
      // A seek is never watched time. The wall-clock bound also rejects external jumps.
      const elapsed = Math.max(0, (next.wall - previous.wall) / 1000);
      if (delta <= 0 || delta > elapsed * (this.video.playbackRate || 1) + 0.5) return;
      this.session.watchedSeconds += delta;
      for (let t = previous.time; t < next.time;) {
        const bin = Math.floor(t / 10);
        const end = Math.min(next.time, (bin + 1) * 10);
        this.session.segments[bin] = (this.session.segments[bin] || 0) + end - t;
        t = end;
      }
      if (this.range && Math.abs(this.range.to - previous.time) > 0.05) this.flushRange();
      if (!this.range) this.range = { from: previous.time, to: next.time };
      else this.range.to = next.time;
      this.session.lastPosition = next.time;
    }
    flushRange() {
      if (this.range) { this.event('watch_range', this.range); this.range = null; }
    }
    save() {
      if (!this.session) return this.saves;
      this.session.duration = seconds(this.video.duration);
      this.session.lastPosition = seconds(this.video.currentTime);
      this.session.version++;
      const pending = this.pending.splice(0);
      // Queue a concrete snapshot now, preserving ordering at session boundaries.
      const snapshot = structuredClone(this.session);
      this.saves = this.saves.then(() => persist(snapshot, pending));
      return this.saves;
    }
    end(reason = 'home') {
      if (!this.session) return;
      this.sample(); this.flushRange(); this.event('session_end', { reason });
      this.session.status = 'closed'; this.session.endedAt = new Date().toISOString(); this.session.endReason = reason;
      this.save(); this.session = null; this.last = null; this.enabled = false;
      this.saves.then(sync);
    }
  }
  async function exportData() {
    return { schemaVersion: 1, projectId, exportedAt: new Date().toISOString(),
      sessions: await all('sessions'), events: await all('events') };
  }
  globalThis.BIDAnalytics = { create: video => new Recorder(video), status, sync, exportData,
    pendingCount: async () => (await all('outbox')).length,
    sendEvius, pendingEvius: async () => (await all('evius')).length };
  globalThis.addEventListener('online', () => { sync(); scheduleEvius(0); });
  setInterval(sync, 30000);
  setInterval(() => scheduleEvius(0), 60000);
  ready.then(() => { sync(); scheduleEvius(2000); }).catch(() => {});
})();
