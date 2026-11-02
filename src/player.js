import { accepts, clamp, uniqueId } from './protocol.js';

export const PREVIEW_TIME = 1;

export class Player {
  constructor(video, notify) {
    this.video = video; this.notify = notify;
    this.analytics = globalThis.BIDAnalytics?.create(video);
    this.seeker = globalThis.BIDPlayback?.createSeek(video, {
      onRequest: (action, target) => this.analytics?.action(action, target),
    });
    this.boot = uniqueId(); this.run = 0; this.mode = 'home'; this.ready = false;
    this.intro = false;
    this.error = ''; this.lastCommand = null; this.seen = new Set(); this.snapshots = new Map();
    video.addEventListener('ended', () => this.home('ended'));
    for (const event of ['play', 'pause', 'seeked', 'loadedmetadata', 'waiting', 'playing', 'canplay']) video.addEventListener(event, () => notify());
    video.addEventListener('error', () => {
      this.ready = false; this.error = 'No se pudo cargar el video. Revisa el archivo Video.mp4 y reinicia la pantalla.'; notify();
    });
  }
  snapshot() {
    const now = performance.now();
    for (const [id, created] of this.snapshots) if (now - created > 5000) this.snapshots.delete(id);
    const snapshot = uniqueId(); this.snapshots.set(snapshot, now);
    return { boot: this.boot, run: this.run, snapshot, mode: this.mode, ready: this.ready, intro: this.intro,
      paused: this.video.paused, time: this.video.currentTime || 0, duration: Number.isFinite(this.video.duration) ? this.video.duration : 0,
      buffering: this.mode === 'video' && !this.video.paused && this.video.readyState < 3,
      error: this.error, lastCommand: this.lastCommand };
  }
  async arm() {
    try {
      await this.video.play(); this.video.pause(); this.video.currentTime = 0;
      this.ready = true; this.error = '';
    } catch {
      this.error = 'No se pudo activar el video. Comprueba el archivo y vuelve a pulsar Activar pantalla.';
      this.ready = false;
    }
    this.notify();
    return this.ready;
  }
  home(reason = 'home') {
    this.seeker?.reset();
    this.analytics?.end(reason);
    this.intro = false;
    this.video.pause(); this.video.currentTime = 0; this.mode = 'home'; this.run++;
    this.notify();
  }
  async preparePreview() {
    this.video.pause();
    this.video.currentTime = Math.min(PREVIEW_TIME, this.video.duration / 2);
    // Keep the home artwork visible until the requested frame is decoded.
    if (this.video.seeking) await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); this.video.removeEventListener('seeked', done); };
      const done = () => { cleanup(); resolve(); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Preview seek timed out')); }, 10000);
      this.video.addEventListener('seeked', done);
    });
  }
  async command(command) {
    // Expire snapshots even if the tab was suspended and its heartbeat stopped.
    for (const [id, created] of this.snapshots) if (performance.now() - created > 5000) this.snapshots.delete(id);
    if (!this.ready || !accepts(command, this, this.seen, this.snapshots)) return;
    this.seen.add(command.id);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
    this.lastCommand = command.id; this.error = '';
    try {
      if (command.action === 'back') { this.analytics?.action('home'); this.home(); }
      else if (command.action === 'start' && this.mode === 'home') {
        this.run++;
        await this.preparePreview();
        this.intro = true; this.mode = 'video';
        this.analytics?.start();
      } else if (command.action === 'intro-complete' && this.mode === 'video' && this.intro) {
        this.intro = false;
        this.analytics?.enable();
        await this.video.play();
      } else if (this.mode === 'video' && !this.intro) {
        if (command.action === 'reboot') { this.seeker?.reset(); this.analytics?.action('restart', 0); this.run++; this.video.currentTime = 0; await this.video.play(); }
        if (command.action === 'play') { this.analytics?.press('play'); this.analytics?.action('play'); await this.video.play(); }
        if (command.action === 'pause') { this.analytics?.press('pause'); this.video.pause(); }
        if (command.action === 'skip' || command.action === 'seek') {
          const next = clamp(command.action === 'skip' ? (this.seeker?.position ?? this.video.currentTime) + command.value : command.value, this.video.duration);
          const action = command.action === 'seek' ? 'seek' : command.value < 0 ? 'backward' : 'forward';
          if (next >= this.video.duration) this.home('seek_to_end');
          else if (this.seeker) this.seeker.request(next, action);
          else { this.analytics?.action(action, next); this.video.currentTime = next; }
        }
      }
    } catch {
      this.error = 'La reproducción está bloqueada. Activa la pantalla de nuevo desde la computadora.';
      this.ready = false; this.home('playback_error');
    }
    this.notify();
  }
}
