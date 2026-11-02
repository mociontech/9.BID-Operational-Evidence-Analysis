(() => {
  'use strict';
  function autoHide({ areas, active, onChange, delay = 2000 }) {
    let timer, visible = false;
    const pointers = new Set();
    function refresh() {
      clearTimeout(timer);
      if (visible && active() && !pointers.size) timer = setTimeout(() => show(false), delay);
    }
    function show(value) { visible = value; onChange(value); refresh(); }
    for (const area of areas) {
      area.addEventListener('pointerdown', event => { if (active()) { pointers.add(event.pointerId); clearTimeout(timer); } });
      for (const type of ['pointermove', 'click', 'input', 'keydown']) area.addEventListener(type, refresh);
      area.addEventListener('lostpointercapture', event => { pointers.delete(event.pointerId); refresh(); });
    }
    for (const type of ['pointerup', 'pointercancel']) globalThis.addEventListener(type, event => {
      if (pointers.delete(event.pointerId)) refresh();
    });
    globalThis.addEventListener('blur', () => { pointers.clear(); refresh(); });
    return { show, refresh, reset() { pointers.clear(); show(false); }, get visible() { return visible; } };
  }
  function createSeek(video, { onRequest = () => {}, onError = () => {} } = {}) {
    let timer, pending = null, waitingSince = 0;
    function pump() {
      clearTimeout(timer);
      if (pending === null) return;
      if (video.seeking && performance.now() - waitingSince < 2000) { timer = setTimeout(pump, 80); return; }
      const next = pending; pending = null;
      try { video.currentTime = next; } catch (error) { onError(error); }
    }
    video.addEventListener('seeked', () => { if (pending !== null) { clearTimeout(timer); timer = setTimeout(pump, 0); } });
    return {
      get position() { return pending ?? video.currentTime; },
      request(target, action = 'seek') {
        const next = Math.max(0, Math.min(video.duration, target));
        if (!Number.isFinite(next)) return;
        onRequest(action, next);
        if (pending === null) { waitingSince = performance.now(); timer = setTimeout(pump, 80); }
        pending = next;
      },
      reset() { clearTimeout(timer); pending = null; },
      flush: pump,
    };
  }
  globalThis.BIDPlayback = { autoHide, createSeek };
})();
