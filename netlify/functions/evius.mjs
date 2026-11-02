// Netlify Function: the only code that talks to Evius Datahub. Shared by the 12 BID totems.
// Edit shared/netlify/functions/evius.mjs and run `node scripts/distribute-evius.mjs`.
// The browser posts { projectId, records: [press...] }; this function answers
// { ok, mode, skipped?, sent: [ids], rejected: [ids], errors: [], unauthorized? }.
import { createHash } from 'node:crypto';

const EXPERIENCE_ENV = {
  reboot: 'EVIUS_EXPERIENCE_REBOOT_ID', retroceder: 'EVIUS_EXPERIENCE_RETROCEDER_ID', pause: 'EVIUS_EXPERIENCE_PAUSE_ID',
  adelantar: 'EVIUS_EXPERIENCE_ADELANTAR_ID', back: 'EVIUS_EXPERIENCE_BACK_ID',
};
const EXPERIENCE_NAME = { reboot: 'Reiniciar', retroceder: 'Retroceder 10s', pause: 'Pausa / Reproducir',
  adelantar: 'Adelantar 10s', back: 'Volver al inicio' };
const ANON_DOMAIN = 'bid-videos.local';
const MAX_RECORDS = 300;
const ID = /^[0-9a-f-]{8,64}$/i;
const PROJECT = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

const json = (status, body) => new Response(JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = (value, max) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';

function validate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = clean(raw.id, 64), sessionId = clean(raw.sessionId, 64), at = clean(raw.at, 32);
  const projectId = clean(raw.projectId, 32), button = clean(raw.button, 16);
  if (!ID.test(id) || !ID.test(sessionId) || !PROJECT.test(projectId) || !(button in EXPERIENCE_ENV)) return null;
  if (!ISO.test(at) || Number.isNaN(Date.parse(at))) return null;
  const position = Number(raw.position);
  return { id, sessionId, projectId, button, at, action: clean(raw.action, 16) || button,
    projectName: clean(raw.projectName, 120) || null, deviceId: clean(raw.deviceId, 64) || null,
    position: Number.isFinite(position) ? Math.max(0, Math.round(position * 1000) / 1000) : null,
    test: raw.test === true };
}

const identity = record => ({
  email: `${record.test ? 'prueba' : 'anon'}-${record.sessionId.toLowerCase()}@${ANON_DOMAIN}`,
  fullName: record.test ? 'PRUEBA borrar - participante anonimo' : 'Participante anonimo',
});
const attendee = record => ({ ...identity(record), participantId: record.sessionId, company: record.projectName || record.projectId });
const experience = (record, score) => ({ ...identity(record), participantId: record.sessionId, participationId: record.id,
  experience: EXPERIENCE_NAME[record.button], play_timestamp: record.at, score,
  button: record.button, action: record.action, projectId: record.projectId, projectName: record.projectName,
  videoPosition: record.position, deviceId: record.deviceId });

const idempotencyKey = (path, ids) => `bid:${path}:${createHash('sha256').update([...ids].sort().join('\n')).digest('hex').slice(0, 32)}`;

async function post(cfg, path, payload, key) {
  let response;
  try {
    response = await fetch(`${cfg.url}/${path}`, { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}`, 'Idempotency-Key': key },
      body: JSON.stringify(payload) });
  } catch (error) { return { ok: false, error: `${path}: sin respuesta (${error.name})` }; }
  if (response.status === 401) return { ok: false, unauthorized: true, error: 'Evius rechazo el token (401). Renueva EVIUS_TOKEN.' };
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: `${path}: HTTP ${response.status} ${data?.message || ''}`.trim() };
  // Evius answers 200 even when records fail: success is decided by the body.
  const count = payload.records.length;
  const ok = !!data && data.failed === 0 && Array.isArray(data.errors) && data.errors.length === 0 && data.processed >= count;
  return { ok, error: ok ? null : `${path}: received=${data?.received} processed=${data?.processed} failed=${data?.failed} ` +
    JSON.stringify(data?.errors ?? data).slice(0, 400) };
}

export default async (request) => {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'Solo POST' });
  const env = process.env;
  const cfg = { url: (env.EVIUS_URL || '').replace(/\/+$/, ''), token: env.EVIUS_TOKEN || '', eventId: env.EVIUS_EVENT_ID || '',
    source: env.EVIUS_SOURCE || '', mode: (env.EVIUS_MODE || 'off').toLowerCase(),
    score: Number.isFinite(Number(env.EVIUS_SCORE_PER_PRESS)) ? Number(env.EVIUS_SCORE_PER_PRESS) : 100 };
  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: 'JSON invalido' }); }
  const incoming = Array.isArray(body?.records) ? body.records.slice(0, MAX_RECORDS) : [];
  const valid = [], rejected = [];
  for (const raw of incoming) {
    const record = validate(raw);
    if (record) valid.push(record); else if (typeof raw?.id === 'string') rejected.push(raw.id.slice(0, 64));
  }
  if (!valid.length) return json(400, { ok: false, error: 'Sin registros validos', sent: [], rejected });
  if (cfg.mode !== 'live') return json(200, { ok: true, mode: cfg.mode, skipped: true, sent: valid.map(r => r.id), rejected, errors: [] });
  if (!cfg.url || !cfg.token || !cfg.eventId || !cfg.source) return json(500, { ok: false, error: 'Faltan EVIUS_URL, EVIUS_TOKEN, EVIUS_EVENT_ID o EVIUS_SOURCE en el servidor' });

  const sentAt = new Date().toISOString();
  const base = { eventId: cfg.eventId, source: cfg.source, sentAt };
  // 1. One anonymous attendee per totem session (same email for every press of that session).
  const sessions = new Map();
  for (const record of valid) if (!sessions.has(record.sessionId)) sessions.set(record.sessionId, attendee(record));
  const attendees = await post(cfg, 'attendees', { ...base, records: [...sessions.values()] }, idempotencyKey('attendees', sessions.keys()));
  if (attendees.unauthorized) return json(401, { ok: false, unauthorized: true, error: attendees.error, sent: [], rejected });
  if (!attendees.ok) return json(502, { ok: false, error: attendees.error, sent: [], rejected, errors: [attendees.error] });
  // 2. One /experiences call per button, since each button is its own Evius experience.
  const sent = [], errors = [];
  const groups = new Map();
  for (const record of valid) groups.set(record.button, [...(groups.get(record.button) || []), record]);
  for (const [button, records] of groups) {
    const experienceId = env[EXPERIENCE_ENV[button]];
    if (!experienceId) { errors.push(`Falta ${EXPERIENCE_ENV[button]} en el servidor`); continue; }
    const result = await post(cfg, 'experiences', { ...base, experienceId, records: records.map(r => experience(r, cfg.score)) },
      idempotencyKey('experiences', records.map(r => r.id)));
    if (result.unauthorized) return json(401, { ok: false, unauthorized: true, error: result.error, sent, rejected });
    if (result.ok) sent.push(...records.map(r => r.id)); else errors.push(result.error);
  }
  return json(200, { ok: errors.length === 0, mode: 'live', sent, rejected, errors, error: errors[0] });
};
