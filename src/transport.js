import { uniqueId } from './protocol.js';

export const staticHosting = import.meta.env.MODE === 'netlify';

export async function connect({ role, room, token, onMessage, onStatus, onPaired }) {
  if (staticHosting) return browserConnect({ role, room, token, onMessage, onStatus, onPaired });
  return localConnect({ role, room, token, onMessage, onStatus, onPaired });
}

function browserConnect({ role, room, token, onMessage, onStatus, onPaired }) {
  if (!globalThis.BroadcastChannel) throw new Error('Abre ambas ventanas en Chrome o Edge para conectar el control.');
  const screen = role === 'screen';
  if (screen) { room = uniqueId(); token = uniqueId(); }
  const channel = new BroadcastChannel(`bid-screen-${room}`);
  let closed = false, online = false, lastState = performance.now();
  const status = (value, error) => {
    if (online === value && !error) return;
    online = value;
    onStatus(value, error);
  };
  const post = (type, payload) => channel.postMessage({ role, token, type, payload });
  channel.onmessage = ({ data }) => {
    if (closed || !data || data.token !== token) return;
    if (screen && data.role === 'tablet' && data.type === 'command') onMessage('command', data.payload);
    if (!screen && data.role === 'screen') {
      if (data.type === 'state') {
        lastState = performance.now();
        status(true);
        onMessage('state', data.payload);
      } else if (data.type === 'closed') status(false);
    }
  };
  // Defer callbacks until the caller has stored the returned transport.
  const start = setTimeout(() => {
    onPaired({ room, token });
    if (screen) {
      onMessage('invitation', { room, token });
      status(true);
    }
  }, 0);
  const heartbeat = setInterval(() => {
    if (!screen && performance.now() - lastState > 3000) status(false);
  }, 500);
  return {
    async send(type, payload) {
      if (closed || (!screen && !online)) throw new Error('Sin conexión con la pantalla.');
      post(type, payload);
    },
    close() {
      if (closed) return;
      if (screen) post('closed');
      closed = true;
      clearTimeout(start); clearInterval(heartbeat);
      channel.close();
    },
  };
}

function localConnect({ role, room, token, onMessage, onStatus, onPaired }) {
  let ws, closed = false, retry;
  function open() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/relay`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role, room, token }));
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === 'paired') {
        room = message.room; token = message.token;
        onPaired({ room, token }); onStatus(true);
      } else if (message.type === 'error') {
        onStatus(false, message.message); closed = true; ws.close();
      } else onMessage(message.type, message.payload);
    };
    ws.onclose = () => { onStatus(false); if (!closed) retry = setTimeout(open, 1500); };
    ws.onerror = () => onStatus(false);
  }
  open();
  return {
    async send(type, payload) {
      if (ws.readyState !== WebSocket.OPEN) throw new Error('Sin conexión.');
      ws.send(JSON.stringify({ type, payload }));
    },
    close() { closed = true; clearTimeout(retry); ws.close(); },
  };
}
