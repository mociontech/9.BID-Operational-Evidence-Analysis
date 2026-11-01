(() => {
  'use strict';
  let data = { sessions: [], events: [] };
  const $ = id => document.getElementById(id);
  const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  function segments() {
    const bins = new Map();
    for (const session of data.sessions) for (const [index, watched] of Object.entries(session.segments)) {
      const key = `${session.projectId}:${index}`;
      const row = bins.get(key) || { project: session.projectId, start: Number(index) * 10, watched: 0, sessions: 0 };
      row.watched += watched; row.sessions++; bins.set(key, row);
    }
    return [...bins.values()].sort((a, b) => b.watched - a.watched);
  }
  function render() {
    const rows = segments();
    const max = rows[0]?.watched || 1;
    $('sessions').innerHTML = `<table><thead><tr><th>Proyecto</th><th>Sesión / inicio</th><th>Estado</th><th>Segundos vistos</th><th>Eventos</th></tr></thead><tbody>${data.sessions.map(s => `<tr><td>${escape(s.projectName || s.projectId)}</td><td>${escape(s.id)}<br>${escape(s.startedAt)}</td><td>${escape(s.endReason || 'Abierta o interrumpida')}</td><td>${s.watchedSeconds.toFixed(1)}</td><td>${s.eventCount}</td></tr>`).join('')}</tbody></table>`;
    $('segments').innerHTML = `<table><thead><tr><th>Proyecto</th><th>Tramo</th><th>Segundos reproducidos</th><th>Sesiones que lo vieron</th><th>Comparación</th></tr></thead><tbody>${rows.map(r => `<tr><td>${escape(r.project)}</td><td>${time(r.start)}–${time(r.start + 10)}</td><td>${r.watched.toFixed(1)}</td><td>${r.sessions}</td><td><div class="bar" style="width:${r.watched / max * 100}%"></div></td></tr>`).join('')}</tbody></table>`;
  }
  function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function refresh() {
    try {
      data = await BIDAnalytics.exportData(); render();
      const state = BIDAnalytics.status;
      $('status').textContent = `${data.sessions.length} sesiones · ${data.events.length} eventos · ${await BIDAnalytics.pendingCount()} registros pendientes\nLocal: ${state.local} · Firebase: ${state.firebase}${state.error ? '\n' + state.error : ''}`;
    } catch (error) { $('status').textContent = 'No se pudieron leer los datos locales: ' + error.message; }
  }
  $('refresh').onclick = refresh;
  $('sync').onclick = async () => { $('status').textContent = 'Sincronizando…'; await BIDAnalytics.sync(); await refresh(); };
  $('json').onclick = () => download('bid-interacciones.json', 'application/json', JSON.stringify(data, null, 2));
  $('csv').onclick = () => {
    const cell = value => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [['projectId', 'inicio_segundos', 'fin_segundos', 'segundos_reproducidos', 'sesiones'],
      ...segments().map(r => [r.project, r.start, r.start + 10, r.watched.toFixed(3), r.sessions])];
    download('bid-tramos.csv', 'text/csv;charset=utf-8', '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n'));
  };
  $('imports').onchange = async event => {
    try {
      const sessions = new Map(data.sessions.map(s => [`${s.projectId}:${s.id}`, s]));
      const events = new Map(data.events.map(e => [`${e.projectId}:${e.id}`, e]));
      for (const file of event.target.files) {
        const imported = JSON.parse(await file.text());
        if (!Array.isArray(imported.sessions) || !Array.isArray(imported.events)) throw new Error('Formato JSON no válido');
        for (const s of imported.sessions) {
          const key = `${s.projectId}:${s.id}`;
          if (!sessions.has(key) || s.version > sessions.get(key).version) sessions.set(key, s);
        }
        for (const e of imported.events) events.set(`${e.projectId}:${e.id}`, e);
      }
      data = { schemaVersion: 1, exportedAt: new Date().toISOString(), sessions: [...sessions.values()], events: [...events.values()] };
      render(); $('status').textContent = `${data.sessions.length} sesiones combinadas. No se modificó el almacenamiento local.`;
    } catch (error) { $('status').textContent = error.message; }
  };
  refresh();
})();
