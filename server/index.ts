import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { extname, resolve } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  CHANNEL_LIST,
  MultiChannelRoomRegistry,
  sanitizeChannelId,
  type ChannelId,
  type NetMessage,
} from '../src/net';

const PORT = Number(process.env.PORT || 8787);
const DIST_DIR = resolve(process.cwd(), 'dist');
const registry = new MultiChannelRoomRegistry(4);

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

function applyIncomingNetMessage(msg: NetMessage, defaultCh: ChannelId = '1', ws?: WebSocket): ChannelId {
  const targetCh = sanitizeChannelId(msg.channel ?? defaultCh);
  if (ws) {
    clientChannels.set(ws, targetCh);
  }
  if (msg.type === 'join') {
    if (ws) clientPlayerIds.set(ws, { id: msg.profile.id, channel: targetCh });
    registry.applyMessage(msg, targetCh);
    broadcastSnapshot(targetCh);
  } else if (msg.type === 'leave') {
    if (ws) clientPlayerIds.delete(ws);
    registry.applyMessage(msg, targetCh);
    broadcastSnapshot(targetCh);
  } else if (msg.type === 'state') {
    const { urgent } = registry.applyMessage(msg, targetCh);
    if (urgent) {
      broadcastSnapshotThrottled(targetCh);
    }
  } else if (msg.type === 'host') {
    registry.applyMessage(msg, targetCh);
    broadcastSnapshot(targetCh);
  }
  return targetCh;
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
    const reqParams = new URLSearchParams(queryString || '');
    let activeCh = sanitizeChannelId(reqParams.get('ch'));

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
            for (const m of parsed) activeCh = applyIncomingNetMessage(m, activeCh);
          } else {
            activeCh = applyIncomingNetMessage(parsed, activeCh);
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
    res.end(JSON.stringify(registry.getRoom(activeCh).getSnapshot()));
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
const clientChannels = new Map<WebSocket, ChannelId>();
const clientPlayerIds = new Map<WebSocket, { id: string; channel: ChannelId }>();

const lastBroadcastAt = new Map<ChannelId, number>();
const pendingBroadcastTimer = new Map<ChannelId, ReturnType<typeof setTimeout>>();

function broadcastSnapshot(ch: ChannelId = '1') {
  const timer = pendingBroadcastTimer.get(ch);
  if (timer !== undefined) {
    clearTimeout(timer);
    pendingBroadcastTimer.delete(ch);
  }
  lastBroadcastAt.set(ch, performance.now());
  const snap = registry.getRoom(ch).getSnapshot();
  const payload = JSON.stringify({
    type: 'snapshot',
    channel: ch,
    snapshot: snap,
  } satisfies NetMessage);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && (clientChannels.get(client) ?? '1') === ch) {
      client.send(payload);
    }
  }
}

function broadcastSnapshotThrottled(ch: ChannelId = '1', minIntervalMs = 12) {
  const last = lastBroadcastAt.get(ch) ?? 0;
  const elapsed = performance.now() - last;
  if (elapsed >= minIntervalMs) {
    broadcastSnapshot(ch);
  } else if (!pendingBroadcastTimer.has(ch)) {
    const timer = setTimeout(() => {
      pendingBroadcastTimer.delete(ch);
      broadcastSnapshot(ch);
    }, Math.max(1, Math.ceil(minIntervalMs - elapsed)));
    pendingBroadcastTimer.set(ch, timer);
  }
}

wss.on('connection', (ws, req) => {
  req.socket?.setNoDelay?.(true);
  const [, wsQuery] = (req.url || '').split('?');
  const wsCh = sanitizeChannelId(new URLSearchParams(wsQuery || '').get('ch'));
  clientChannels.set(ws, wsCh);
  ws.send(
    JSON.stringify({
      type: 'snapshot',
      channel: wsCh,
      snapshot: registry.getRoom(wsCh).getSnapshot(),
    } satisfies NetMessage),
  );

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as NetMessage;
      const defaultCh = clientChannels.get(ws) ?? wsCh;
      applyIncomingNetMessage(msg, defaultCh, ws);
    } catch {
      // ignore invalid JSON
    }
  });

  ws.on('close', () => {
    clientChannels.delete(ws);
    const entry = clientPlayerIds.get(ws);
    if (entry) {
      clientPlayerIds.delete(ws);
      registry.getRoom(entry.channel).leave(entry.id);
      broadcastSnapshot(entry.channel);
    }
  });
});

let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  registry.tickAll(dt);
  for (const ch of CHANNEL_LIST) {
    broadcastSnapshot(ch);
  }
}, 33);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[TECHNO SURFERS 3D] Booth Match Server running on http://0.0.0.0:${PORT} (Channels: ${CHANNEL_LIST.join(', ')})`);
});
