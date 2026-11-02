(() => {
  'use strict';
  const jobs = new WeakMap();
  const status = { state: 'idle', cached: false, cacheHit: false, bytes: 0, version: null, error: null };
  function prepare(video, { onProgress = () => {} } = {}) {
    if (jobs.has(video)) return jobs.get(video);
    const config = globalThis.BID_MEDIA_CONFIG;
    if (!config) return Promise.resolve();
    const job = (async () => {
      const url = new URL(config.source, location.href);
      url.searchParams.set('v', config.version);
      status.state = 'loading'; status.version = config.version;
      let cache, response;
      const chunkUrl = index => { const key = new URL(url); key.searchParams.set('_chunk', String(index)); return key.href; };
      try {
        try {
          if (globalThis.caches) { cache = await caches.open(`bid-video-${config.projectId}`); response = await cache.match(url.href); }
        } catch { /* Disk caching is optional; the complete Blob still avoids network seeks. */ }
        let blob;
        if (response) {
          try {
            if (response.headers.get('Content-Type')?.includes('application/json')) {
              const saved = await response.json();
              if (saved.version !== config.version || saved.bytes !== config.bytes) throw Error('Stale video');
              const parts = [];
              for (let i = 0; i < saved.chunks; i++) {
                const part = await cache.match(chunkUrl(i));
                if (!part) throw Error('Incomplete video cache');
                parts.push(await part.blob());
              }
              blob = new Blob(parts, { type: 'video/mp4' });
            } else blob = await response.blob();
            if (blob.size !== config.bytes) throw Error('Invalid cached video size');
          } catch { await cache.delete(url.href); response = null; }
        }
        status.cacheHit = Boolean(response);
        if (!response) {
          response = await fetch(url.href, { cache: 'no-store' });
          if (!response.ok || response.status !== 200) throw Error(`Video HTTP ${response.status}`);
          const total = config.bytes || Number(response.headers.get('Content-Length'));
          let loaded = 0, lastPercent = -1;
          if (response.body) {
            const reader = response.body.getReader();
            const body = new ReadableStream({
              async pull(controller) {
                try {
                  const { done, value } = await reader.read();
                  if (done) { controller.close(); return; }
                  loaded += value.byteLength; status.bytes = loaded;
                  const percent = total ? Math.min(99, Math.floor(loaded / total * 100)) : null;
                  if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
                  controller.enqueue(value);
                } catch (error) { controller.error(error); }
              },
              cancel(reason) { return reader.cancel(reason); },
            });
            blob = await new Response(body, { headers: { 'Content-Type': 'video/mp4' } }).blob();
          } else blob = await response.blob();
          if (blob.size !== config.bytes) throw Error('El video descargado no coincide con la versión publicada.');
          if (cache) {
            const keys = new Set([url.href]);
            try {
              // Smaller entries avoid Chromium's large-response storage limits.
              const chunkSize = 16 * 1024 * 1024;
              const chunks = Math.ceil(blob.size / chunkSize);
              for (let i = 0; i < chunks; i++) {
                const key = chunkUrl(i); keys.add(key);
                await cache.put(key, new Response(blob.slice(i * chunkSize, (i + 1) * chunkSize), { headers: { 'Content-Type': 'video/mp4' } }));
              }
              await cache.put(url.href, new Response(JSON.stringify({ version: config.version, bytes: blob.size, chunks }), { headers: { 'Content-Type': 'application/json' } }));
              // Remove earlier video versions only after the replacement is safely stored.
              for (const key of await cache.keys()) if (!keys.has(key.url)) await cache.delete(key);
              status.cached = true;
            } catch (error) {
              status.cached = false; status.storageError = `${error.name}: ${error.message}`;
              for (const key of keys) await cache.delete(key).catch(() => {});
            }
          }
        } else status.cached = true;
        const source = URL.createObjectURL(blob);
        video.src = source; video.load();
        status.state = 'ready'; status.bytes = blob.size;
        onProgress(100);
        globalThis.addEventListener('pagehide', event => { if (!event.persisted) URL.revokeObjectURL(source); }, { once: true });
        return { mode: 'local', cached: status.cached };
      } catch (error) {
        status.state = 'streaming'; status.error = String(error.message || error);
        console.warn('[BID video]', status.error);
        video.src = url.href; video.load(); onProgress(100);
        return { mode: 'streaming', error: status.error };
      }
    })();
    jobs.set(video, job);
    return job;
  }
  globalThis.BIDVideoCache = { prepare, status };
})();
