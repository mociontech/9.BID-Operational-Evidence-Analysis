export async function connect({ role, room, token, onMessage, onStatus, onPaired }) {
  return localConnect({ role, room, token, onMessage, onStatus, onPaired });
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
