/* Shared by all 12 projects. Run scripts/distribute-analytics.py after changes. */
(() => {
  'use strict';
  const config = globalThis.BID_ANALYTICS_CONFIG || {};
  const projectId = config.projectId;
  const uid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  const seconds = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  const status = { local: 'starting', firebase: config.firebase ? 'pending' : 'disabled', error: null };
  let database, cloud, syncing = false;
  const request = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  const ready = new Promise((resolve, reject) => {
    const req = indexedDB.open(`bid-interactions-${projectId}`, 1);
    req.onupgradeneeded = () => {
      for (const name of ['sessions', 'events', 'outbox']) req.result.createObjectStore(name, { keyPath: 'id' });
    };
    req.onsuccess = () => { database = req.result; status.local = 'ready'; resolve(); };
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
      this.save();
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
    pendingCount: async () => (await all('outbox')).length };
  globalThis.addEventListener('online', sync);
  setInterval(sync, 30000);
  ready.then(sync).catch(() => {});
})();
