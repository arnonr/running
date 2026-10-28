# Multi-Channel Booth Arena (`CH 1` – `CH 4`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 independent booth channels (`CH 1` – `CH 4`) so 3–4 TV + Mobile stations can run simultaneously on one server with isolated matches, bots, Hall of Fame, and auto-scoped QR codes.

**Architecture:** `server/index.ts` manages a `Map<ChannelId, MatchRoomCore>` for channels `'1'`, `'2'`, `'3'`, `'4'` (via a reusable `MultiChannelServerCore` helper in `src/net.ts`), routing WebSocket and `/api/sync?ch=X` traffic per channel. `NetClient` scopes its WebSocket URL, HTTP sync endpoint, and `BroadcastChannel` by `ChannelId`, while `resolveMobileJoinUrl` and `UI` provide 1-click channel switching (`CH 1` – `CH 4`) on both TV and Mobile with live QR code regeneration.

**Tech Stack:** TypeScript, Three.js, WebSockets (`ws`), Node HTTP, QRCode SVG, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-multi-channel-design.md`

## Global Constraints

- Valid channels are `'1' | '2' | '3' | '4'` (`CHANNEL_LIST = ['1', '2', '3', '4']`), defaulting to `'1'` via `sanitizeChannelId(raw)`.
- Each channel (`1..4`) has its own independent `MatchRoomCore` instance, including its own `activeRunners`, `waitingQueue`, `phase`, demo bots, and `allDayBest` Hall of Fame.
- TV QR code URL (`resolveMobileJoinUrl`) must include `?ch=<channel>` so scanning a TV's QR code automatically joins that TV's channel.
- Works under both `/` and `/technosurfers/` subpaths for WebSocket (`/ws?ch=X`) and HTTP fallback (`/api/sync?ch=X`).

## Review Focus

1. **Invalid or missing `?ch=` query values (e.g. `?ch=99`, `?ch=abc`, `null`, `""`):** `sanitizeChannelId` must normalize any invalid/empty input to `'1'`.
2. **Host command (`start_now`, `clear_bots`, `force_lobby`) or `allDayBest` update in `CH 2`:** Must never mutate `CH 1`, `CH 3`, or `CH 4` state or Hall of Fame.
3. **Player switching from `CH 1` to `CH 2` after joining `CH 1`'s Lobby:** Switching channels must automatically remove (`leave`) the player's ID from `CH 1` before joining/viewing `CH 2`.
4. **TV switching from `CH 1` to `CH 3`:** Must immediately regenerate the QR code SVG and visible join URL to end with `?ch=3`.
5. **Subpath deployment (`/technosurfers/?mode=tv&ch=4`):** `resolveMobileJoinUrl` must preserve `/technosurfers/` and append `?ch=4` (`http://<host>/technosurfers/?ch=4`).

---

### Task 1: Multi-Channel Core, Server Registry & QR URL Scoping

**Files:**
- Modify: `src/net.ts`
- Modify: `src/qr.ts`
- Modify: `server/index.ts`
- Test: `tests/multi-channel.test.ts`

**Interfaces:**
- Produces in `src/net.ts`:
  - `export type ChannelId = '1' | '2' | '3' | '4'`
  - `export const CHANNEL_LIST: readonly ChannelId[] = ['1', '2', '3', '4']`
  - `export function sanitizeChannelId(raw?: string | number | null): ChannelId`
  - `RoomSnapshot.channel?: ChannelId`
  - `NetMessage` variants accept optional `channel?: ChannelId`
  - `export class MultiChannelRoomRegistry` with `getRoom(ch?: string | null): MatchRoomCore`, `applyMessage(msg: NetMessage, defaultCh?: string | null): { channel: ChannelId; snapshot: RoomSnapshot }`, `tickAll(dt: number): void`
  - `NetClient`: `constructor(isTvMode?: boolean, initialChannel?: string | null)`, `getChannel(): ChannelId`, `setChannel(ch: string): void`
- Produces in `src/qr.ts`:
  - `export function resolveMobileJoinUrl(loc?: LocationLike, fallbackLanIp?: string, channel?: string | null): string`

- [ ] **Step 1: Write the failing test in `tests/multi-channel.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_LIST,
  MultiChannelRoomRegistry,
  sanitizeChannelId,
} from '../src/net';
import { resolveMobileJoinUrl, buildJoinQrSvg } from '../src/qr';

describe('Multi-Channel Booth Arena (CH 1 - CH 4)', () => {
  it('sanitizes channel IDs to 1..4 and defaults invalid inputs to 1', () => {
    expect(CHANNEL_LIST).toEqual(['1', '2', '3', '4']);
    expect(sanitizeChannelId('1')).toBe('1');
    expect(sanitizeChannelId('2')).toBe('2');
    expect(sanitizeChannelId(3)).toBe('3');
    expect(sanitizeChannelId('4')).toBe('4');
    expect(sanitizeChannelId('99')).toBe('1');
    expect(sanitizeChannelId('')).toBe('1');
    expect(sanitizeChannelId(null)).toBe('1');
    expect(sanitizeChannelId(undefined)).toBe('1');
  });

  it('isolates MatchRoomCore state, bots, rounds, and Hall of Fame across channels 1..4', () => {
    const reg = new MultiChannelRoomRegistry(4);
    reg.applyMessage(
      {
        type: 'join',
        channel: '2',
        profile: { id: 'p-ch2', name: 'นักวิ่ง CH2', role: 'uni', color: '#22c55e', avatar: 'kin' },
        immediate: true,
      },
      '2',
    );

    // Clear bots and start match only in CH 2
    reg.applyMessage({ type: 'host', channel: '2', command: { action: 'clear_bots' } }, '2');
    reg.applyMessage({ type: 'host', channel: '2', command: { action: 'start_now' } }, '2');

    const snap1 = reg.getRoom('1').getSnapshot();
    const snap2 = reg.getRoom('2').getSnapshot();

    expect(snap1.channel).toBe('1');
    expect(snap1.phase).toBe('LOBBY');
    expect(snap1.activeRunners.filter((r) => r.isBot)).toHaveLength(4);
    expect(snap1.activeRunners.some((r) => r.id === 'p-ch2')).toBe(false);

    expect(snap2.channel).toBe('2');
    expect(snap2.phase).toBe('COUNTDOWN');
    expect(snap2.activeRunners).toHaveLength(1);
    expect(snap2.activeRunners[0].id).toBe('p-ch2');
  });

  it('embeds ?ch=<channel> into resolveMobileJoinUrl and QR SVG under root and /technosurfers/', () => {
    const urlCh3 = resolveMobileJoinUrl(
      { protocol: 'http:', hostname: 'it.technopark.kmutnb.ac.th', port: '', pathname: '/technosurfers/' },
      undefined,
      '3',
    );
    expect(urlCh3).toBe('http://it.technopark.kmutnb.ac.th/technosurfers/?ch=3');
    const svg = buildJoinQrSvg(urlCh3);
    expect(svg).toContain('?ch=3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/multi-channel.test.ts`
Expected: FAIL (`sanitizeChannelId` / `MultiChannelRoomRegistry` not exported)

- [ ] **Step 3: Implement `ChannelId`, `sanitizeChannelId`, `MultiChannelRoomRegistry`, `NetClient.setChannel` in `src/net.ts`, update `resolveMobileJoinUrl` in `src/qr.ts`, and wire `MultiChannelRoomRegistry` in `server/index.ts`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/net.ts src/qr.ts server/index.ts tests/multi-channel.test.ts
git commit -m "feat(net,server,qr): support 4 isolated booth channels (CH 1 - CH 4)"
```

---

### Task 2: TV & Mobile Channel Switcher UI and Main Loop Integration

**Files:**
- Modify: `index.html`
- Modify: `src/ui.ts`
- Modify: `src/main.ts`
- Test: `tests/multi-channel.test.ts`

**Interfaces:**
- Consumes from Task 1: `ChannelId`, `CHANNEL_LIST`, `sanitizeChannelId`, `resolveMobileJoinUrl`, `NetClient.setChannel`
- Produces in `src/ui.ts`:
  - `UIHandlers.selectChannel?(ch: ChannelId): void`
  - `UI.setChannel(ch: ChannelId): void`

- [ ] **Step 1: Add UI channel state & URL sync test in `tests/multi-channel.test.ts`**

Test that switching a player from `CH 1` to `CH 3` leaves `CH 1` and joins `CH 3` cleanly in `MultiChannelRoomRegistry`.

- [ ] **Step 2: Implement `CH 1` – `CH 4` selector buttons & badges in `src/ui.ts`, styles in `index.html`, and URL `?ch=` sync + `selectChannel` handler in `src/main.ts`**

- [ ] **Step 3: Run full test suite and production build**

Run: `npx vitest run && npm run build`
Expected: All tests PASS and `dist/` builds with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add index.html src/ui.ts src/main.ts tests/multi-channel.test.ts
git commit -m "feat(ui): add CH 1 - CH 4 channel selector on TV Arena and Mobile Lobby"
```
