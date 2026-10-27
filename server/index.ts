import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { MatchRoomCore, type NetMessage } from '../src/net';

const PORT = Number(process.env.PORT || 8787);
const room = new MatchRoomCore();
room.addDemoBots(4);

const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health' || req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(room.getSnapshot()));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('TECHNO SURFERS 3D Synchronized Booth Server Ready');
});

const wss = new WebSocketServer({ server: httpServer });
const clientPlayerIds = new Map<WebSocket, string>();

function broadcastSnapshot() {
  const payload = JSON.stringify({
    type: 'snapshot',
    snapshot: room.getSnapshot(),
  } satisfies NetMessage);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'snapshot', snapshot: room.getSnapshot() } satisfies NetMessage));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as NetMessage;
      if (msg.type === 'join') {
        clientPlayerIds.set(ws, msg.profile.id);
        room.join(msg.profile);
        broadcastSnapshot();
      } else if (msg.type === 'state') {
        room.updateRunnerState(msg.id, msg.state);
      } else if (msg.type === 'host') {
        room.hostCommand(msg.command);
        broadcastSnapshot();
      }
    } catch {
      // ignore invalid JSON
    }
  });

  ws.on('close', () => {
    const pid = clientPlayerIds.get(ws);
    if (pid) {
      clientPlayerIds.delete(ws);
      room.leave(pid);
      broadcastSnapshot();
    }
  });
});

setInterval(() => {
  room.tick(0.1);
  broadcastSnapshot();
}, 100);

httpServer.listen(PORT, () => {
  console.log(`[TECHNO SURFERS 3D] Booth Match Server running on http://localhost:${PORT}`);
});
