import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { MatchRoomCore, type NetMessage } from '../src/net';

const PORT = Number(process.env.PORT || 8787);
const DIST_DIR = resolve(process.cwd(), 'dist');
const room = new MatchRoomCore();
room.addDemoBots(4);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function applyIncomingNetMessage(msg: NetMessage, ws?: WebSocket) {
  if (msg.type === 'join') {
    if (ws) clientPlayerIds.set(ws, msg.profile.id);
    room.join(msg.profile, { immediate: msg.immediate });
    broadcastSnapshot();
  } else if (msg.type === 'leave') {
    if (ws) clientPlayerIds.delete(ws);
    room.leave(msg.id);
    broadcastSnapshot();
  } else if (msg.type === 'state') {
    const prev = room.getRunnerState(msg.id);
    const urgent =
      !prev ||
      (msg.state.name !== undefined && msg.state.name !== prev.name) ||
      (msg.state.role !== undefined && msg.state.role !== prev.role) ||
      (msg.state.color !== undefined && msg.state.color !== prev.color) ||
      (msg.state.avatar !== undefined && msg.state.avatar !== prev.avatar) ||
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
}

const httpServer = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  req.socket?.setNoDelay?.(true);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const fullUrl = req.url || '/';
  const [rawPath, queryString] = fullUrl.split('?');

  // If accessed at `/technosurfers` without trailing slash, redirect to `/technosurfers/` so relative assets (`./assets/...`) resolve under `/technosurfers/`
  if (rawPath === '/technosurfers' && req.method === 'GET') {
    const qs = queryString ? `?${queryString}` : '';
    res.writeHead(302, { Location: `/technosurfers/${qs}` });
    res.end();
    return;
  }

  // Support both root (`/`) and subpath (`/technosurfers/...`) requests seamlessly
  const strippedPath = rawPath.replace(/^\/technosurfers(?=\/|$)/, '') || '/';

  if (strippedPath === '/api/sync' || strippedPath === '/health' || strippedPath === '/status') {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        if (rawBody) {
          const parsed = JSON.parse(rawBody) as NetMessage | NetMessage[];
          if (Array.isArray(parsed)) {
            for (const m of parsed) applyIncomingNetMessage(m);
          } else {
            applyIncomingNetMessage(parsed);
          }
        }
      } catch {
        // ignore malformed JSON
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(JSON.stringify(room.getSnapshot()));
    return;
  }

  // Serve built production frontend from ./dist if present
  try {
    const safePath = strippedPath === '/' ? '/index.html' : strippedPath;
    const candidate = resolve(DIST_DIR, '.' + safePath);
    if (candidate.startsWith(DIST_DIR)) {
      const info = await stat(candidate);
      if (info.isFile()) {
        const buf = await readFile(candidate);
        const ext = extname(candidate).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        });
        res.end(buf);
        return;
      }
    }
  } catch {
    // Fallback if dist/ is not built or file not found
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
      applyIncomingNetMessage(msg, ws);
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
