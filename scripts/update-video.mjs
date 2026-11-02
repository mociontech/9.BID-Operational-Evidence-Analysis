import { createReadStream } from 'node:fs';
import { access, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function updateVideoManifest(root = fileURLToPath(new URL('../', import.meta.url))) {
  let modular = true;
  try { await access(resolve(root, 'src/player.js')); } catch { modular = false; }
  const assets = modular ? 'public' : '.';
  const source = await readFile(resolve(root, assets, 'analytics/config.js'), 'utf8');
  const project = JSON.parse(source.split('globalThis.BID_ANALYTICS_CONFIG = ')[1].trim().replace(/;$/, ''));
  const video = resolve(root, 'Images/Video.mp4');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(video)) hash.update(chunk);
  const config = { projectId: project.projectId, source: modular ? '/local-video.mp4' : 'Images/Video.mp4',
    version: hash.digest('hex'), bytes: (await stat(video)).size };
  if (config.bytes < 1024) throw Error('Falta descargar el video completo de Git LFS.');
  await writeFile(resolve(root, assets, 'playback/media.js'), 'globalThis.BID_MEDIA_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n');
  console.log(`Video ${config.projectId}: ${config.bytes} bytes, version ${config.version.slice(0, 12)}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await updateVideoManifest();
