import './validate-firebase.mjs';
import { build } from 'vite';
import { copyFile, open } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const video = new URL('../Images/Video.mp4', import.meta.url);
async function isPointer() {
  const file = await open(video, 'r');
  try {
    const { buffer } = await file.read(Buffer.alloc(128), 0, 128, 0);
    return buffer.toString().startsWith('version https://git-lfs.github.com/spec/v1');
  } finally { await file.close(); }
}
if (await isPointer()) {
  try { execFileSync('git', ['lfs', 'pull', '--include=Images/Video.mp4'], { cwd: root, stdio: 'inherit' }); }
  catch { throw new Error('No se pudo descargar el video de Git LFS. Configura GIT_LFS_ENABLED=true en Netlify y vuelve a desplegar.'); }
  if (await isPointer()) throw new Error('Images/Video.mp4 sigue siendo un puntero de Git LFS; falta descargar el video real.');
}
await build({ root, mode: 'netlify' });
await copyFile(video, new URL('../dist/local-video.mp4', import.meta.url));
console.log('Video incluido en dist/local-video.mp4.');
