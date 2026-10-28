# Multi-Channel Booth Arena (`CH 1` – `CH 4`) Design

## 1. Intent & Why
Enable running 3–4 independent TECHNO SURFERS 3D booth stations simultaneously at the event using a single backend server (`PORT=8787`), so each station's TV screen, Admin host controls, AI bots, players, and Hall of Fame leaderboard operate without interfering with other stations.

## 2. Goals & Non-Goals
- **Goals:**
  - Support 4 standard channels (`'1'`, `'2'`, `'3'`, `'4'`, defaulting to `'1'` via `sanitizeChannelId`).
  - Isolate `MatchRoomCore` instances per channel on the server (`server/index.ts`), including active runners, waiting queue, round timer/phase, demo bots, and `allDayBest` Hall of Fame.
  - Scope WebSocket messages, HTTP `/api/sync` polling/posting, and `BroadcastChannel` fallback by `channel` (`src/net.ts`).
  - Automatically embed `?ch=<channel>` in the TV QR code URL (`src/qr.ts`) and update the QR SVG + URL text live when the TV switches channels.
  - Provide 1-click channel selector buttons (`CH 1` – `CH 4`) on both the TV Admin panel and the Mobile Lobby start screen, keeping `location.search` (`?ch=X`) in sync via `history.replaceState`.
- **Non-Goals / Anti-Goals:**
  - Free-text room codes (prone to typos at the booth).
  - Cross-channel shared Hall of Fame or cross-channel player broadcasting.

## 3. Constraints
- Must work seamlessly under both root (`/`) and Nginx Proxy Manager subpath (`/technosurfers/`) over WebSocket (`/ws?ch=X`), HTTP fallback (`/api/sync?ch=X`), and `BroadcastChannel`.

## 4. Approaches Considered
- **Approach 1 (Selected): Fixed 4-Channel Switcher (`CH 1` – `CH 4`) + Auto-Scoped QR Code.** One-click channel pills on TV and Mobile, server maintains a `Map<ChannelId, MatchRoomCore>`, and TV QR code encodes `?ch=1..4`. Chosen for zero-typo booth setup across 3–4 stations.
- **Approach 2: Free-text Custom Room Codes.** Rejected due to manual typing overhead and case/spelling mismatch risk on mobile and TV.

## 5. Architecture & Component Changes
- **`src/net.ts`:**
  - Define `export type ChannelId = '1' | '2' | '3' | '4'`, `export const CHANNEL_LIST: ChannelId[] = ['1', '2', '3', '4']`, and `export function sanitizeChannelId(raw?: string | null): ChannelId`.
  - Include `channel?: ChannelId` on `RoomSnapshot` and `NetMessage`.
  - `NetClient` accepts initial `channel: ChannelId` and provides `setChannel(ch: ChannelId)` which leaves the previous channel if joined, switches `BroadcastChannel` / WS / `/api/sync?ch=` target, and requests a fresh snapshot.
- **`server/index.ts`:**
  - Replace single `room` with `rooms = new Map<ChannelId, MatchRoomCore>()` pre-seeded with 4 bots per channel (`1..4`).
  - Track each WebSocket's subscribed channel (`clientChannels = new Map<WebSocket, ChannelId>()`) from URL query `?ch=` or incoming message `msg.channel`, and broadcast snapshots only to clients in that channel.
  - Route `GET/POST /api/sync?ch=X` (and `msg.channel`) to the corresponding channel's `MatchRoomCore`.
- **`src/qr.ts`:**
  - `resolveMobileJoinUrl(loc, fallbackLanIp, channel)` appends `?ch=${channel}` (when `channel` is provided) so scanning any TV's QR code opens the exact channel of that TV.
- **`src/ui.ts` & `src/main.ts`:**
  - Read initial channel from `new URLSearchParams(location.search).get('ch')`.
  - Render `CH 1` – `CH 4` buttons in the TV Admin panel and Mobile Start panel, plus a visible `CH X` badge in the TV header and Mobile Lobby status box.
  - Switching channels updates `?ch=` in the browser URL (`history.replaceState`), re-renders the TV QR code SVG and join URL text, and calls `net.setChannel(ch)`.
