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

const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: false });
const clientPlayerIds = new Map<WebSocket, string>();

let lastBroadcastAt = 0;
let pendingBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

function broadcastSnapshot() {
  if (pendingBroadcastTimer !== null) {
    clearTimeout(pendingBroadcastTimer);
    pendingBroadcastTimer = null;
  }
  lastBroadcastAt = performance.now();
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

function broadcastSnapshotThrottled(minIntervalMs = 12) {
  const elapsed = performance.now() - lastBroadcastAt;
  if (elapsed >= minIntervalMs) {
    broadcastSnapshot();
  } else if (pendingBroadcastTimer === null) {
    pendingBroadcastTimer = setTimeout(() => {
      pendingBroadcastTimer = null;
      broadcastSnapshot();
    }, Math.max(1, Math.ceil(minIntervalMs - elapsed)));
  }
}

wss.on('connection', (ws, req) => {
  req.socket?.setNoDelay?.(true);
  ws.send(JSON.stringify({ type: 'snapshot', snapshot: room.getSnapshot() } satisfies NetMessage));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as NetMessage;
      if (msg.type === 'join') {
        clientPlayerIds.set(ws, msg.profile.id);
        room.join(msg.profile, { immediate: msg.immediate });
        broadcastSnapshot();
      } else if (msg.type === 'state') {
        const prev = room.getRunnerState(msg.id);
        const urgent =
          !prev ||
          (msg.state.lane !== undefined && msg.state.lane !== prev.lane) ||
          (msg.state.sliding !== undefined && msg.state.sliding !== prev.sliding) ||
          (msg.state.stumbling !== undefined && msg.state.stumbling !== prev.stumbling) ||
          (msg.state.activeCenter !== undefined && msg.state.activeCenter !== prev.activeCenter) ||
          (msg.state.y !== undefined && Math.abs(msg.state.y - prev.y) > 0.2);
        room.updateRunnerState(msg.id, msg.state);
        if (urgent) {
          broadcastSnapshotThrottled();
        }
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

let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  room.tick(dt);
  broadcastSnapshot();
}, 33);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[TECHNO SURFERS 3D] Booth Match Server running on http://0.0.0.0:${PORT}`);
});
