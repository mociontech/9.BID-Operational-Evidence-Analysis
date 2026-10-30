import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const production = process.argv.includes('--production');
const port = 5173;
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const server = createServer();
const vite = production ? null : await createViteServer({ root, server: { middlewareMode: true, hmr: { server } } });
const origins = () => Object.values(networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => `http://${n.address}:${port}`);
// The original 208 MB video stays outside the production bundle.
const video = fileURLToPath(new URL('../Images/Video.mp4', import.meta.url));
function serveVideo(req, res) {
  let size;
  try { size = statSync(video).size; }
  catch { res.writeHead(404); return res.end('No se encuentra Images/Video.mp4.'); }
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  res.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
    ...(match ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(video, { start, end }); stream.on('error', () => res.destroy()); stream.pipe(res);
  res.on('close', () => stream.destroy());
}
server.on('request', (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/network') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(origins())); }
  if (pathname === '/local-video.mp4') return serveVideo(req, res);
  if (!production) return vite.middlewares(req, res);
  let path;
  try { path = resolve(dist, '.' + decodeURIComponent(pathname)); } catch { res.writeHead(400); return res.end(); }
  if (path !== dist && !path.startsWith(dist + sep)) { res.writeHead(403); return res.end(); }
  if (['/', '/pantalla', '/tablet', '/control'].includes(pathname)) path = resolve(dist, 'index.html');
  let stat; try { stat = statSync(path); } catch { res.writeHead(404); return res.end('No encontrado. Ejecuta npm run build antes de iniciar.'); }
  if (!stat.isFile()) { res.writeHead(404); return res.end(); }
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': stat.size, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(path); stream.pipe(res); res.on('close', () => stream.destroy());
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
const rooms = new Map();
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/relay') return;
  if (req.headers.origin !== `http://${req.headers.host}`) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
const send = (ws, value) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
wss.on('connection', ws => {
  let joined, role;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return ws.close(); }
    if (m.type === 'hello' && !joined) {
      if (m.role === 'screen') {
        if (m.room) {
          joined = rooms.get(m.room);
          if (!joined || joined.hostToken !== m.token) return ws.close();
          joined.screen?.close();
        } else {
          joined = { id: randomUUID(), hostToken: randomBytes(24).toString('hex'), token: randomBytes(24).toString('hex'), tablets: new Set(), created: Date.now() };
          rooms.set(joined.id, joined);
        }
        role = 'screen'; joined.screen = ws;
        send(ws, { type: 'paired', room: joined.id, token: joined.hostToken });
        send(ws, { type: 'invitation', payload: { room: joined.id, token: joined.token } });
      } else if (m.role === 'tablet') {
        joined = rooms.get(m.room);
        if (!joined || joined.token !== m.token) {
          joined = null;
          return send(ws, { type: 'error', message: 'Vínculo no válido. Escanea nuevamente el QR de la pantalla.' });
        }
        role = 'tablet'; joined.tablets.add(ws);
        send(ws, { type: 'paired', room: joined.id, token: joined.token });
      }
      return;
    }
    if (!joined) return ws.close();
    if (role === 'screen' && m.type === 'state') joined.tablets.forEach(t => send(t, m));
    if (role === 'tablet' && m.type === 'command') send(joined.screen, m);
  });
  ws.on('close', () => joined?.tablets.delete(ws));
});
setInterval(() => {
  for (const [id, r] of rooms) if (Date.now() - r.created > 12 * 3600000) {
    r.screen?.close(); r.tablets.forEach(t => t.close()); rooms.delete(id);
  }
}, 60000).unref();
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'El puerto 5173 está ocupado. Cierra la otra instancia y vuelve a abrir.' : error.message); process.exit(1); });
server.listen(port, '0.0.0.0', () => {
  console.log(`\n  IDB Group · Reproductor local\n  Computadora: http://localhost:${port}\n  Tableta (misma red):`);
  origins().forEach(origin => console.log(`  ${origin}`));
  console.log('\n  Mantén esta ventana abierta durante el evento.\n');
});
