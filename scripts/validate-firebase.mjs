// Standalone build check: copied into each independent repository.
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
let modular = true;
try { await access(resolve(root, 'src/player.js')); } catch { modular = false; }
const folder = modular ? 'public/analytics' : 'analytics';
const source = await readFile(resolve(root, folder, 'config.js'), 'utf8');
const config = JSON.parse(source.split('globalThis.BID_ANALYTICS_CONFIG = ')[1]?.trim().replace(/;$/, '') || 'null');
if (!config || !/^bid-(0[1-9]|1[0-2])$/.test(config.projectId)) throw Error('Falta el identificador BID del proyecto.');
for (const field of ['apiKey', 'authDomain', 'projectId', 'appId']) {
  if (!config.firebase?.[field]) throw Error(`Falta firebase.${field} en ${folder}/config.js.`);
}
for (const name of ['tracker.js', 'report.html', 'report.js']) await access(resolve(root, folder, name));
const html = await readFile(resolve(root, 'index.html'), 'utf8');
if (!html.includes('analytics/config.js') || !html.includes('analytics/tracker.js')) throw Error('index.html no carga el registro de interacciones.');
const player = await readFile(resolve(root, modular ? 'src/player.js' : 'player.js'), 'utf8');
if (!player.includes('BIDAnalytics')) throw Error('El reproductor no está conectado al registro de sesiones.');
console.log(`Firebase preparado: ${config.projectId} → ${config.firebase.projectId}. Sitio independiente; reporte /analytics/report.html.`);
