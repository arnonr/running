# Lives Quota, Obstacle Elimination & Last-Survivor Winner Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable lives quota (`3`, `5`, or `0` unlimited; default `3`) with obstacle elimination, last-survivor winner ranking, early round termination when all human runners die, anti-respawn locking, Option-A mobile eliminated wayfinding UX, and TV Live Arena hearts/elimination status + Admin presets.

**Architecture:** Client `Sim` enforces 120 Hz life deduction (`-1` life on front collisions and repeated side-stumbles within `4.5s`, preserving score penalties, Center `#4` shield blocks, `#1/#3/#9` immunity, and `#8` non-healing) and emits an `eliminated` event on `0` lives (`alive = false`, 3D `die` clip, `1.2s` track reveal into `#s-over`). `MatchRoomCore` distributes `maxLives`, stamps authoritative `survivedSec`, locks `eliminatedIds` and persists remaining `roundLives` per `matchId`, distinguishes `disconnect` (tab close/lock) from `leave` (channel switch), transitions `RUNNING -> PODIUM` early when all participating humans are eliminated, and ranks humans > survivors > longer `survivedSec` > `score` > `d`.

**Tech Stack:** TypeScript, Three.js, WebAudio API, WebSocket (`ws`) / HTTP `/api/sync` / `BroadcastChannel`, Vitest

**Spec:** `docs/superpowers/specs/2026-10-29-lives-and-elimination-design.md`

## Global Constraints

- Default lives quota: `DEFAULT_MAX_LIVES = 3`; Admin presets: `MAX_LIVES_OPTIONS = [3, 5, 0] as const` (`0` = unlimited/no-death score-only mode).
- Preserve existing score penalties (`-50` front hit, `-20` side stumble, clamped `>= 0`), single-hit survival in `tests/sim.test.ts`, latecomer QR mid-run join (`immediate: true` when not in `eliminatedIds`) in `tests/mobile-join-controls.test.ts`, and 4-channel (`CH 1..4`) isolation in `tests/multi-channel.test.ts`.
- Center `#4` (`Green Energy Shield`) absorbs up to 2 hits without losing lives; Centers `#1`, `#3`, `#9` preserve obstacle immunity/smash; Center `#8` (`Med-Tech Recovery Drone`) must **not** heal or restore `lives`.
- Background demo bots (`isBot: true`) never die, never block early `PODIUM` termination when all humans die (while bot-only rounds with 0 humans run full `matchDuration`), and always rank below all human participants (including eliminated humans).
- Verbatim Thai UI copy:
  - Non-fatal life-loss toast: `💔 ชนสิ่งกีดขวาง! เหลือ ${livesLeft}/${maxLives} ชีวิต (-${penalty} แต้ม)`
  - Single non-lethal side-bump toast: `⚠️ เฉี่ยวสิ่งกีดขวาง -${penalty} แต้ม`
  - Fatal elimination toast & `#r-title`: `💥 ชนครบ ${maxLives} ครั้ง! สิ้นสุดการวิ่ง` (survived `#r-title`: `🎉 พิชิตชั้น 10 สำเร็จ!`)
  - Eliminated next-round CTA (`#btn-again`): `⏳ เข้าคิวรอรอบถัดไป` -> `✅ อยู่ในคิวรอรอบถัดไป (รอดูผลบนจอทีวี)`
  - Anti-respawn lobby toast: `⏳ คุณจบการวิ่งในรอบนี้แล้ว — เข้าคิวรอรอบถัดไปเรียบร้อย!`
  - TV Admin life buttons: `❤️ 3 ชีวิต` (`3`), `❤️ 5 ชีวิต` (`5`), `♾️ ไม่ตาย` (`0`)
  - TV eliminated leaderboard badge: `💀 ตาย ${MM:SS}`
- All modules and tests must run cleanly in Vitest's Node environment (`typeof window === 'undefined'`, `typeof document === 'undefined'`).

## Review Focus

- Mid-round browser refresh or channel-toggle (`CH 1 -> CH 2 -> CH 1`) exploit: `roundLives` keeps a wounded player at their remaining `1/3` lives instead of healing to `3/3`, and `eliminatedIds` routes an eliminated player to `waitingQueue` (`queuedForNextRound: true`) without reviving or erasing their eliminated leaderboard entry (`tests/lives-elimination.test.ts`, Task 2).
- Eliminated or alive player locking/closing their phone (`ws.close` / `pagehide` -> `room.disconnect(id)`): alive runner forfeits (`eliminated: true`) when `maxLives > 0`, finalized `💀 ตาย MM:SS` entry stays on TV leaderboard and `PODIUM` instead of vanishing, and `enterLobby()` prunes `disconnectedIds` so closed tabs do not spawn AFK next round (`tests/lives-elimination.test.ts`, Task 2).
- Late-joiner survival duration & simultaneous-crash tie-breaking: a player joining 40s into `RUNNING` who dies at clock `55s` records `survivedSec = 15s` (ranking below an original starter who died at `30s`), bots with higher simulated scores rank below eliminated humans, and simultaneous deaths within `0.05s` tie-break by `score` then `d` (`tests/sim.test.ts` Task 1; `tests/lives-elimination.test.ts` Task 2).
- Multi-car / compound obstacle rapid side-stumble & mid-race Admin `set_max_lives` toggle: repeated side-stumble (`< 4.5s`) grants `1.5s` invulnerability so a multi-car train cannot drain 2 lives in one collision, and toggling `set_max_lives` mid-race updates alive runners without reviving already-eliminated runners (`tests/sim.test.ts` Task 1; `tests/lives-elimination.test.ts` Task 2).
- Admin `force_lobby` reset during the `1.2s` mobile death-fall window & live rank updates on `#s-over`: resetting to `LOBBY` cancels any pending `#s-over` timer, `#r-rank-line` updates live as remaining runners crash or overtake, and multiplayer Pause (`!soloRun`) never freezes `sim.update(dt)` (`tests/lives-elimination.test.ts`, Task 4).

---

### Task 1: Config & `Sim` Lives Quota, Repeated-Stumble Rules, Shield Protection, and Elimination Event

**Files:**
- Modify: `src/config.ts:8-12`
- Modify: `src/sim/types.ts:44-60`
- Modify: `src/sim/sim.ts:15-152`
- Modify: `src/sim/sim.ts:254-269`
- Modify: `src/sim/sim.ts:304-358`
- Modify: `src/sim/sim.ts:388-436`
- Modify: `src/sim/sim.ts:786-823`
- Modify: `src/sim/sim.ts:891-933`
- Test: `tests/config.test.ts`
- Test: `tests/sim.test.ts`

**Interfaces:**
- Produces:
  - `src/config.ts`:
    - `export const DEFAULT_MAX_LIVES = 3`
    - `export const MAX_LIVES_OPTIONS = [3, 5, 0] as const`
    - `export function sanitizeMaxLives(raw?: number | null): number`
  - `src/sim/types.ts`:
    - `SimEvent` union variants:
      - `{ type: 'stumble'; x: number; y: number; penalty: number; lostLife?: boolean; livesLeft?: number; maxLives?: number }`
      - `{ type: 'hit'; kind: ObKind; x: number; y: number; penalty: number; lostLife?: boolean; livesLeft?: number; maxLives?: number }`
      - `{ type: 'eliminated'; kind: ObKind; x: number; y: number; score: number; coins: number; distance: number; survivedSec: number; hitCount: number }`
  - `src/sim/sim.ts`:
    - `SimSnapshot`: adds `maxLives: number; lives: number; survivedSec: number`
    - `Sim` public fields: `maxLives: number`, `lives: number`, `survivedSec: number`
    - `Sim.prototype.reset(seed: number, tutorial?: boolean, matchDuration?: number, maxLives?: number): void`
    - `Sim.prototype.setLives(lives: number, maxLives?: number): void`

- [ ] **Step 1: Write the failing tests in `tests/config.test.ts` and `tests/sim.test.ts`**

1. In `tests/config.test.ts`, import `DEFAULT_MAX_LIVES`, `MAX_LIVES_OPTIONS`, `sanitizeMaxLives` from `../src/config` and add:
```ts
  it('defines lives quota presets [3, 5, 0] and sanitizes invalid/null inputs to DEFAULT_MAX_LIVES (3)', () => {
    expect(DEFAULT_MAX_LIVES).toBe(3);
    expect(MAX_LIVES_OPTIONS).toEqual([3, 5, 0]);
    expect(sanitizeMaxLives(3)).toBe(3);
    expect(sanitizeMaxLives(5)).toBe(5);
    expect(sanitizeMaxLives(0)).toBe(0);
    expect(sanitizeMaxLives(null)).toBe(3);
    expect(sanitizeMaxLives(undefined)).toBe(3);
    expect(sanitizeMaxLives(NaN)).toBe(3);
    expect(sanitizeMaxLives(-1)).toBe(3);
    expect(sanitizeMaxLives(99)).toBe(3);
  });
```
2. In `tests/sim.test.ts`, add tests covering 3-hit front elimination, isolated vs repeated (`< 4.5s`) side-stumble life deduction + `1.5s` multi-car invulnerability, Center `#4` shield absorption & Center `#8` non-healing, `maxLives = 0` unlimited mode, and mid-run `syncToElapsed` `survivedSec`:
```ts
  it('deducts 1 life per front hit, eliminates runner on 3rd hit with survivedSec, and stops movement & inputs', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180, 3);
    sim.start();
    expect(sim.maxLives).toBe(3);
    expect(sim.lives).toBe(3);

    for (let hit = 1; hit <= 3; hit++) {
      sim.invulnerableT = 0;
      sim.ignoreId = -1;
      sim.ignoreT = 0;
      const d0 = sim.d + 2;
      sim.addOb({ kind: 'train', lane: 1, d0, d1: d0 + 8, cars: 1 });
      sim.update(0.4);
      if (hit < 3) {
        expect(sim.alive).toBe(true);
        expect(sim.lives).toBe(3 - hit);
      }
    }

    expect(sim.alive).toBe(false);
    expect(sim.running).toBe(false);
    expect(sim.lives).toBe(0);
    expect(sim.speed).toBe(0);
    const events = sim.drainEvents();
    const elim = events.find((e) => e.type === 'eliminated');
    expect(elim).toBeDefined();
    if (elim?.type === 'eliminated') {
      expect(elim.survivedSec).toBeCloseTo(sim.survivedSec, 1);
      expect(elim.hitCount).toBe(3);
    }

    const dAtDeath = sim.d;
    sim.left();
    sim.jump();
    sim.update(1.0);
    expect(sim.d).toBe(dAtDeath);
    expect(sim.lane).toBe(1);
  });

  it('keeps isolated side-stumbles non-lethal (-20 pts, 0 lives lost) while repeated side-stumbles (< 4.5s) deduct 1 life with 1.5s multi-car grace', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180, 3);
    sim.start();
    sim.score = 200;

    // 1st isolated side-stumble (changing from lane 1 into a train already alongside in lane 0)
    sim.addOb({ kind: 'train', lane: 0, d0: sim.d - 2, d1: sim.d + 30, cars: 3 });
    sim.left();
    sim.update(0.2);
    let evs = sim.drainEvents();
    const firstStumble = evs.find((e) => e.type === 'stumble');
    expect(firstStumble).toBeDefined();
    if (firstStumble?.type === 'stumble') expect(firstStumble.lostLife).toBe(false);
    expect(sim.lives).toBe(3);

    // Wait > 4.5s (stumbleWindow) -> next side-stumble is also isolated (no life lost)
    sim.clearWorld();
    sim.update(4.7);
    sim.addOb({ kind: 'train', lane: 0, d0: sim.d - 2, d1: sim.d + 30, cars: 3 });
    sim.left();
    sim.update(0.2);
    expect(sim.lives).toBe(3);

    // Within 4.5s (e.g. 1.0s later after 0.6s invuln expires), side-stumble again into a long 3-car train -> loses exactly 1 life (not 2)
    sim.update(0.8);
    expect(sim.sinceStumble).toBeLessThan(4.5);
    sim.left();
    sim.update(0.6);
    evs = sim.drainEvents();
    const secondStumble = evs.find((e) => e.type === 'stumble');
    expect(secondStumble).toBeDefined();
    if (secondStumble?.type === 'stumble') {
      expect(secondStumble.lostLife).toBe(true);
      expect(secondStumble.livesLeft).toBe(2);
    }
    expect(sim.lives).toBe(2);
    expect(sim.invulnerableT).toBeGreaterThan(0.8);
  });

  it('absorbs 2 hits with Center #4 Shield without losing lives, does NOT heal lives on Center #8, supports maxLives=0 unlimited mode, and tracks survivedSec after syncToElapsed', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180, 3);
    sim.start();
    sim.syncToElapsed(40);
    sim.invulnerableT = 0;

    // Center #4 blocks 2 front hits with 0 life loss
    sim.activateCenter(4);
    sim.invulnerableT = 0;
    for (let i = 0; i < 2; i++) {
      sim.invulnerableT = 0;
      sim.ignoreId = -1;
      sim.ignoreT = 0;
      sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 8, cars: 1 });
      sim.update(0.35);
    }
    expect(sim.lives).toBe(3);

    // Lose 1 life -> 2/3, then activate Center #8 -> lives remain 2/3 (no healing)
    sim.invulnerableT = 0;
    sim.ignoreId = -1;
    sim.ignoreT = 0;
    sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 8, cars: 1 });
    sim.update(0.35);
    expect(sim.lives).toBe(2);
    sim.activateCenter(8);
    expect(sim.lives).toBe(2);
    expect(sim.survivedSec).toBeCloseTo(sim.time - 40, 2);

    // Unlimited mode (maxLives = 0) never loses lives or dies even after 5 front hits
    sim.reset(1, false, 180, 0);
    sim.start();
    for (let k = 0; k < 5; k++) {
      sim.invulnerableT = 0;
      sim.ignoreId = -1;
      sim.ignoreT = 0;
      sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 8, cars: 1 });
      sim.update(0.35);
    }
    expect(sim.alive).toBe(true);
    expect(sim.maxLives).toBe(0);
    expect(sim.hitCount).toBe(5);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts tests/sim.test.ts`
Expected: FAIL (`DEFAULT_MAX_LIVES is not undefined` / `sim.lives` undefined)

- [ ] **Step 3: Implement lives config constants and `Sim` collision life-deduction + `eliminated` transition**

1. In `src/config.ts`:
   - Export `DEFAULT_MAX_LIVES = 3`, `MAX_LIVES_OPTIONS = [3, 5, 0] as const`, and `sanitizeMaxLives(raw?: number | null): number` (return `raw` only when `typeof raw === 'number' && (raw === 0 || raw === 3 || raw === 5)`, else `DEFAULT_MAX_LIVES` — never coerce `null` via `Number(null)` to `0`).
2. In `src/sim/types.ts`:
   - Add optional `lostLife?: boolean; livesLeft?: number; maxLives?: number` to `stumble` and `hit` events, and add the `eliminated` variant to `SimEvent`.
3. In `src/sim/sim.ts`:
   - Add `maxLives = DEFAULT_MAX_LIVES`, `lives = DEFAULT_MAX_LIVES`, `survivedSec = 0`, and `private runStartTime = 0` to `Sim` (and `maxLives`, `lives`, `survivedSec` to `SimSnapshot` / `snapshot()`).
   - Update `reset(seed, tutorial = false, matchDuration = DEFAULT_MATCH_DURATION, maxLives = DEFAULT_MAX_LIVES)` to accept any finite integer `maxLives >= 0` (`0` = unlimited), resetting `alive = true`, `maxLives`, `lives = maxLives`, `survivedSec = 0`, `runStartTime = 0`.
   - Add `setLives(lives: number, maxLives = this.maxLives)` to clamp/sync `this.maxLives` and `this.lives` (`0` when `this.maxLives === 0`; if `this.maxLives > 0 && this.lives <= 0 && this.alive`, keep `this.lives` clamped `>= 0`).
   - In `syncToElapsed(elapsed)`, set `this.runStartTime = safeElapsed` and `this.survivedSec = 0`.
   - In `update(dt)`, guard `if (!this.running || this.finished || !this.alive) return;` and include `&& this.alive` in the `while` loop; in `step(dt)`, update `this.survivedSec = Math.max(0, this.time - this.runStartTime)` (including right before emitting `finish`).
   - Add `private eliminate(kind: ObKind)` setting `alive = false`, `running = false`, `speed = 0`, `slideT = 0`, `stumbleSlow = 0`, `frontHitSlow = false`, `invulnerableT = 0`, `activeCenter = null`, `centerTimer = 0`, `shieldHits = 0`, `survivedSec = Math.max(0, this.time - this.runStartTime)`, and pushing `{ type: 'eliminated', kind, x: this.x, y: this.y, score: Math.floor(this.score), coins: this.coins, distance: Math.floor(this.d), survivedSec: +this.survivedSec.toFixed(2), hitCount: this.hitCount }`.
   - In `frontHit(o)` and `bounce(o)` (checking `const repeatedStumble = this.sinceStumble < PLAYER.stumbleWindow` **before** `this.sinceStumble = 0`), deduct `1` life when `this.maxLives > 0` (always on `frontHit`; only when `repeatedStumble` on `bounce`, where `repeatedStumble` also increments `this.hitCount++` and sets `this.invulnerableT = Math.max(this.invulnerableT, PLAYER.frontHitInvulnDuration)` and `this.ignoreT = 1.5`), attach `{ lostLife, livesLeft: this.lives, maxLives: this.maxLives }` to the `hit`/`stumble` event, and call `this.eliminate(kind)` when `lostLife && this.lives <= 0`. Do not touch `this.lives` in `activateCenter(8)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts tests/sim.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/sim/types.ts src/sim/sim.ts tests/config.test.ts tests/sim.test.ts
git commit -m "feat(sim): add configurable lives quota, repeated-stumble life loss, and elimination event"
```

---

### Task 2: `MatchRoomCore`, `MultiChannelRoomRegistry`, & `server/index.ts` Elimination Authority, Disconnect Lifecycle, Early Podium & Winner Ranking

**Files:**
- Modify: `src/net.ts:1-90`
- Modify: `src/net.ts:112-621`
- Modify: `src/net.ts:871-1082`
- Modify: `server/index.ts:32-55`
- Modify: `server/index.ts:203-212`
- Create: `tests/lives-elimination.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_MAX_LIVES`, `sanitizeMaxLives` (`src/config.ts`)
- Produces:
  - `src/net.ts`:
    - `RunnerNetState`: adds `lives?: number; maxLives?: number; eliminated?: boolean; survivedSec?: number`
    - `RoomSnapshot`: adds `maxLives: number; eliminatedIds: string[]`
    - `HostCommand`: adds `| { action: 'set_max_lives'; maxLives: number }`
    - `NetMessage`: adds `| { type: 'disconnect'; channel?: ChannelId; id: string }`
    - `MatchRoomCore`:
      - `maxLives: number`
      - `disconnect(id: string): void`
    - `NetClient`:
      - `disconnect(id: string): void`

- [ ] **Step 1: Write the failing tests in `tests/lives-elimination.test.ts`**

Create `tests/lives-elimination.test.ts` covering all Spec 5.3 rules and Review Focus #1–#4:
```ts
import { describe, expect, it } from 'vitest';
import { MatchRoomCore, MultiChannelRoomRegistry } from '../src/net';

describe('MatchRoomCore: Lives Authority, Early Podium, Winner Ranking & Anti-Respawn', () => {
  it('terminates RUNNING into PODIUM immediately when all humans die (ignoring bots), while bot-only rounds run full duration', () => {
    // Bot-only round runs full 180s
    const botRoom = new MatchRoomCore('1');
    botRoom.addDemoBots(3);
    botRoom.hostCommand({ action: 'start_now' });
    botRoom.tick(3.6);
    expect(botRoom.phase).toBe('RUNNING');
    botRoom.tick(60);
    expect(botRoom.phase).toBe('RUNNING');

    // Mixed round: 2 humans + 3 bots -> ends early as soon as 2nd human dies
    const room = new MatchRoomCore('1');
    room.addDemoBots(3);
    room.join({ id: 'h1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.join({ id: 'h2', name: 'เมย์', role: 'uni', color: '#ec4899' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    room.tick(20); // elapsed = 20s

    room.updateRunnerState('h1', { score: 8000, d: 300, lives: 0, eliminated: true });
    room.tick(0.1);
    expect(room.phase).toBe('RUNNING'); // h2 still alive!

    room.tick(35); // elapsed ~ 55.1s
    room.updateRunnerState('h2', { score: 1500, d: 750, lives: 0, eliminated: true });
    room.tick(0.1);
    expect(room.phase).toBe('PODIUM');

    // Ranking: h2 (survived ~55.1s, lower score) beats h1 (survived ~20s, higher score), and BOTH humans beat all bots!
    const snap = room.getSnapshot();
    expect(snap.top10[0].id).toBe('h2');
    expect(snap.top10[0].eliminated).toBe(true);
    expect(snap.top10[1].id).toBe('h1');
    expect(snap.top10[1].eliminated).toBe(true);
    expect(snap.top10[2].isBot).toBe(true);
  });

  it('ranks survivors above eliminated humans, measures late-joiner actual survivedSec, and tie-breaks simultaneous deaths by score then distance', () => {
    const room = new MatchRoomCore('1');
    room.join({ id: 'starter', name: 'คนเริ่ม', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.join({ id: 'survivor', name: 'คนรอด', role: 'uni', color: '#22c55e' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);

    // starter dies at 30s (survivedSec = 30s)
    room.tick(30);
    room.updateRunnerState('starter', { score: 1200, d: 420, lives: 0, eliminated: true });

    // latecomer joins at 40s and dies at 55s -> actual survivedSec = 15s (< 30s!)
    room.tick(10); // elapsed = 40s
    room.join({ id: 'late', name: 'มาสาย', role: 'junior', color: '#f59e0b' }, { immediate: true });
    room.tick(15); // elapsed = 55s
    room.updateRunnerState('late', { score: 9000, d: 800, lives: 0, eliminated: true });
    room.updateRunnerState('survivor', { score: 500, d: 820, lives: 1, eliminated: false });

    const ranked = room.getSnapshot().activeRunners;
    expect(ranked.map((r) => r.id)).toEqual(['survivor', 'starter', 'late']);
    expect(ranked[1].survivedSec).toBeCloseTo(30, 1);
    expect(ranked[2].survivedSec).toBeCloseTo(15, 1);

    // Simultaneous crash within 0.05s tie-breaks by score
    const tieRoom = new MatchRoomCore('2');
    tieRoom.join({ id: 'a', name: 'A', role: 'senior', color: '#38bdf8' }, { immediate: true });
    tieRoom.join({ id: 'b', name: 'B', role: 'senior', color: '#22c55e' }, { immediate: true });
    tieRoom.hostCommand({ action: 'start_now' });
    tieRoom.tick(3.5);
    tieRoom.tick(25);
    tieRoom.updateRunnerState('a', { score: 1000, d: 350, lives: 0, eliminated: true });
    tieRoom.updateRunnerState('b', { score: 2500, d: 340, lives: 0, eliminated: true });
    expect(tieRoom.getSnapshot().activeRunners.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('locks eliminated players from respawning mid-round (even after channel leave/rejoin) and persists remaining roundLives across refresh', () => {
    const room = new MatchRoomCore('1');
    room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.join({ id: 'p2', name: 'เมย์', role: 'uni', color: '#ec4899' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    room.tick(12);

    // p1 drops to 1 life, then refreshes/leaves and rejoins same matchId -> stays at 1 life (no 3/3 heal!)
    room.updateRunnerState('p1', { lives: 1, score: 600, d: 160 });
    room.leave('p1');
    const rejoinAlive = room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    expect(rejoinAlive.queuedForNextRound).toBe(false);
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p1')?.lives).toBe(1);

    // p1 now dies -> late state packets cannot move/revive p1, and re-joining (even with immediate=true or after leave) queues for next round
    room.updateRunnerState('p1', { lives: 0, eliminated: true, score: 700, d: 180 });
    room.updateRunnerState('p1', { lives: 3, eliminated: false, score: 99999, d: 999 });
    const afterLatePacket = room.getSnapshot().activeRunners.find((r) => r.id === 'p1')!;
    expect(afterLatePacket.eliminated).toBe(true);
    expect(afterLatePacket.score).toBe(700);
    expect(room.getSnapshot().eliminatedIds).toContain('p1');

    const respawnAttempt = room.join({ id: 'p1', name: 'นนท์ ใหม่', role: 'senior', color: '#38bdf8' }, { immediate: true });
    expect(respawnAttempt.queuedForNextRound).toBe(true);
    expect(room.getSnapshot().waitingQueue.some((w) => w.id === 'p1')).toBe(true);
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p1')?.eliminated).toBe(true);
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p1')?.name).toBe('นนท์ ใหม่');

    // Channel-switch toggle (leave + join) also cannot bypass eliminatedIds in the same matchId
    room.leave('p1');
    const afterToggle = room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    expect(afterToggle.queuedForNextRound).toBe(true);
    expect(room.getSnapshot().activeRunners.some((r) => r.id === 'p1')).toBe(false);
  });

  it('preserves disconnected eliminated runners on TV through PODIUM, prunes them on enterLobby, and auto-eliminates >10s silent AFK phones', () => {
    const room = new MatchRoomCore('1');
    room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.join({ id: 'p2', name: 'เมย์', role: 'uni', color: '#ec4899' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    room.tick(10);

    // p1 dies and locks phone (disconnect) -> remains in activeRunners on TV!
    room.updateRunnerState('p1', { score: 900, d: 140, lives: 0, eliminated: true });
    room.disconnect('p1');
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p1')?.eliminated).toBe(true);

    // p2 stops sending packets (frozen/backgrounded HTTP phone) for > 10s of incremental ticks (dt <= 1.0)
    for (let i = 0; i < 22; i++) {
      room.tick(0.5); // 11.0s total silentSec -> auto-eliminates p2 and triggers early PODIUM!
    }
    expect(room.phase).toBe('PODIUM');
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p1')).toBeDefined();
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p2')?.eliminated).toBe(true);

    // When PODIUM finishes -> enterLobby prunes disconnected p1 while keeping connected p2 reset to fresh lives
    room.tick(15.5);
    expect(room.phase).toBe('LOBBY');
    const nextRunners = room.getSnapshot().activeRunners;
    expect(nextRunners.some((r) => r.id === 'p1')).toBe(false);
    const p2Reset = nextRunners.find((r) => r.id === 'p2')!;
    expect(p2Reset.eliminated).toBe(false);
    expect(p2Reset.lives).toBe(3);
  });

  it('handles Admin set_max_lives (3, 5, 0) in LOBBY and mid-race without reviving eliminated runners, and flags life changes urgent', () => {
    const reg = new MultiChannelRoomRegistry(0);
    const room = reg.getRoom('1');
    room.join({ id: 'p1', name: 'A', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.join({ id: 'p2', name: 'B', role: 'uni', color: '#22c55e' }, { immediate: true });

    reg.applyMessage({ type: 'host', channel: '1', command: { action: 'set_max_lives', maxLives: 5 } });
    expect(room.getSnapshot().maxLives).toBe(5);
    expect(room.getSnapshot().activeRunners.every((r) => r.lives === 5)).toBe(true);

    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    const { urgent } = reg.applyMessage({
      type: 'state',
      channel: '1',
      id: 'p1',
      state: { lives: 0, eliminated: true },
    });
    expect(urgent).toBe(true);

    // Admin switches to unlimited (0) mid-race -> p2 becomes immortal (maxLives=0), p1 stays eliminated
    room.hostCommand({ action: 'set_max_lives', maxLives: 0 });
    const snap = room.getSnapshot();
    expect(snap.maxLives).toBe(0);
    expect(snap.activeRunners.find((r) => r.id === 'p1')?.eliminated).toBe(true);
    expect(snap.activeRunners.find((r) => r.id === 'p2')?.maxLives).toBe(0);
    expect(snap.activeRunners.find((r) => r.id === 'p2')?.eliminated).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lives-elimination.test.ts`
Expected: FAIL (`room.disconnect is not a function` / `snap.maxLives` undefined)

- [ ] **Step 3: Implement `MatchRoomCore`, `MultiChannelRoomRegistry`, `NetClient`, and `server/index.ts` elimination & disconnect authority**

1. In `src/net.ts`:
   - Extend `RunnerNetState`, `RoomSnapshot`, `HostCommand`, and `NetMessage` per **Interfaces** above.
   - Add `maxLives = DEFAULT_MAX_LIVES` and private `eliminatedIds`, `roundLives`, `joinedAtElapsed`, `silentSec`, `disconnectedIds` to `MatchRoomCore`.
   - Add `private currentElapsed(): number` and `private eliminateRunner(id: string, fallbackSurvivedSec?: number): void` stamping `r.eliminated = true`, `r.lives = 0`, `r.maxLives = this.maxLives`, `r.activeCenter = null`, `r.sliding = false`, `r.stumbling = false`, `this.eliminatedIds.add(id)`, `this.roundLives.set(id, 0)`, and `r.survivedSec = this.phase === 'RUNNING' ? +Math.max(0, this.currentElapsed() - (this.joinedAtElapsed.get(id) ?? 0)).toFixed(2) : +(fallbackSurvivedSec ?? r.survivedSec ?? 0).toFixed(2)`.
   - In `join(profile, options)`:
     - Clear `this.disconnectedIds.delete(cleanProfile.id)`.
     - If `(this.phase === 'RUNNING' || this.phase === 'COUNTDOWN') && this.eliminatedIds.has(cleanProfile.id)`: update display metadata (`name`, `role`, `color`, `avatar`) on `this.activeMap.get(cleanProfile.id)` if present (without reviving), insert `cleanProfile` into `this.waitingMap`, and return `{ queuedForNextRound: true }`.
     - Otherwise, when inserting/updating `activeMap`, initialize `lives: cleanProfile.isBot ? this.maxLives : (existing?.lives ?? this.roundLives.get(cleanProfile.id) ?? this.maxLives)`, `maxLives: this.maxLives`, `eliminated: existing?.eliminated ?? false`, `survivedSec: existing?.survivedSec ?? 0`; on `joinMidRun`, set `this.joinedAtElapsed.set(cleanProfile.id, this.currentElapsed())` and `this.silentSec.set(cleanProfile.id, 0)`.
   - Keep `leave(id)` removing from `activeMap`, `waitingMap`, `botSeeds`, `silentSec`, `disconnectedIds` (do **not** delete from `eliminatedIds` or `roundLives` so channel-toggle cannot bypass round locks; clear all round maps in `startRunningPhase()`, `enterLobby()`, and `clearAllRunners()`).
   - Add `disconnect(id: string)`: in `LOBBY` / `COUNTDOWN`, delegate to `this.leave(id)`; in `RUNNING` / `PODIUM`, delete from `waitingMap`, and if in `activeMap` (`!r.isBot`), add `id` to `this.disconnectedIds` and if `this.phase === 'RUNNING' && this.maxLives > 0 && !r.eliminated`, call `this.eliminateRunner(id)`. In `enterLobby()`, delete any `id` in `this.disconnectedIds` from `this.activeMap` (unless queued in `this.waitingMap`) before resetting active runners and clearing `disconnectedIds`.
   - In `updateRunnerState(id, state)`: accept `lives`, `maxLives`, `eliminated`, `survivedSec`; reset `this.silentSec.set(id, 0)` and `this.disconnectedIds.delete(id)`; if `r.eliminated` is already `true`, update only display metadata (`name`, `role`, `color`, `avatar`) and return; record `roundLives` when `state.lives !== undefined && this.maxLives > 0` (`r.lives = clamped`); if `!r.isBot && (state.eliminated === true || (this.maxLives > 0 && state.lives !== undefined && state.lives <= 0))`, call `this.eliminateRunner(id, state.survivedSec)`.
   - In `hostCommand`: handle `set_max_lives` via `sanitizeMaxLives(cmd.maxLives)` (in `LOBBY`/`COUNTDOWN`, set all `activeMap` runners to `lives = this.maxLives, maxLives = this.maxLives, eliminated = false`; in `RUNNING`, update alive runners' `maxLives` and clamp alive `lives` to `0` when `nextMax === 0` or `Math.max(1, Math.min(nextMax, r.lives || nextMax))` when `nextMax > 0`, leaving eliminated runners untouched).
   - In `tick(dt)` during `RUNNING`:
     - When `this.maxLives > 0 && dt <= 1.0`, increment `silentSec` for each alive non-bot runner; if `nextSilent > 10.0`, call `this.eliminateRunner(id)`.
     - After bot updates, collect `humans = Array.from(this.activeMap.values()).filter((r) => !r.isBot)`; if `this.maxLives > 0 && humans.length > 0 && humans.every((r) => r.eliminated)`, call `this.enterPodium()` and `return`.
   - In `getSnapshot()`:
     - Sort `runners` by: (1) if `hasHumans`, `!isBot` before `isBot`; (2) `!eliminated` before `eliminated`; (3) if both `eliminated`, `(b.survivedSec ?? 0) - (a.survivedSec ?? 0)` when `Math.abs(diff) > 0.05`, then `b.score - a.score`, then `b.d - a.d`; (4) if both surviving, `b.score - a.score`, then `b.d - a.d`.
     - Compute `meanD` from surviving runners (`const survivors = runners.filter((r) => !r.eliminated);` falling back to `this.referenceDistance` if empty).
     - Include `maxLives: this.maxLives` and `eliminatedIds: Array.from(this.eliminatedIds)` in the returned `RoomSnapshot`.
   - In `MultiChannelRoomRegistry.applyMessage`: handle `msg.type === 'disconnect'` (`room.disconnect(msg.id); urgent = true;`) and add `(msg.state.eliminated !== undefined && msg.state.eliminated !== prev.eliminated) || (msg.state.lives !== undefined && msg.state.lives !== prev.lives)` to `urgent`.
   - In `NetClient`: handle `msg.type === 'disconnect'` in `handleChannelMessage`, and add `disconnect(id: string)` posting `{ type: 'disconnect', channel: this.channel, id }` via WS, `postHttpMessage` (`keepalive: true`), `localRoom.disconnect(id)`, and `bc`.
2. In `server/index.ts`:
   - Handle `msg.type === 'disconnect'` in `applyIncomingNetMessage` (`if (ws) clientPlayerIds.delete(ws); registry.applyMessage(msg, targetCh); broadcastSnapshot(targetCh);`).
   - In `ws.on('close')` (`server/index.ts:208`), call `registry.getRoom(entry.channel).disconnect(entry.id)` instead of `.leave(entry.id)`.

- [ ] **Step 4: Run all room and regression tests**

Run: `npx vitest run tests/lives-elimination.test.ts tests/net.test.ts tests/multi-channel.test.ts tests/mobile-join-controls.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/net.ts server/index.ts tests/lives-elimination.test.ts
git commit -m "feat(net): add MatchRoomCore lives authority, early podium, survivor ranking, and anti-respawn lock"
```

---

### Task 3: 3D `die` Animations (`PlayerView` & `World` TV Ghosts) and Audio Fatal Crash SFX

**Files:**
- Modify: `src/audio.ts:106-113`
- Modify: `src/view/player.ts:193-244`
- Modify: `src/view/world.ts:60-86`
- Modify: `src/view/world.ts:1590-1918`
- Test: `tests/lives-elimination.test.ts`

**Interfaces:**
- Consumes: `SimEvent` (`eliminated`), `Sim.alive` (`src/sim/sim.ts`); `RunnerNetState.eliminated` (`src/net.ts`)
- Produces:
  - `Audio.prototype.eliminated(): void` (`src/audio.ts`)
  - `PlayerView.prototype.update(sim: Sim, dt: number, events: SimEvent[]): void` playing `'die'` clip when `!sim.alive` (`src/view/player.ts`)
  - `World` ghost elimination animation (`'die'` clip + red burst for `1.4s` during `isRunning`, then `slot.group.visible = false`; visible in `'idle'` on `!isRunning` `PODIUM` grid) (`src/view/world.ts`)

- [ ] **Step 1: Write the failing tests in `tests/lives-elimination.test.ts`**

Append headless tests to `tests/lives-elimination.test.ts` verifying `Audio.eliminated()` (no-op safe when `ctx === null`) and `PlayerView.update()` switching to `'die'`, stopping invulnerability blink (`model.visible === true`), and clearing 9-Center attachments when `sim.alive === false`:
```ts
import * as THREE from 'three';
import { Audio } from '../src/audio';
import { PlayerView } from '../src/view/player';
import { Sim } from '../src/sim/sim';

describe('Audio & PlayerView 3D Elimination Behavior', () => {
  it('plays die animation clip, forces model visible, and clears active attachments when runner is eliminated', () => {
    const audio = new Audio();
    expect(() => audio.eliminated()).not.toThrow();

    const gltfScene = new THREE.Group();
    const playerObj = new THREE.Group();
    playerObj.name = 'player';
    gltfScene.add(playerObj);
    const makeClip = (name: string) =>
      new THREE.AnimationClip(name, 0.8, [new THREE.NumberKeyframeTrack('.position[y]', [0, 0.8], [0, 0])]);
    const animations = ['idle', 'run', 'jump', 'jumpup', 'fall', 'roll', 'die', 'runlookback'].map(makeClip);

    const viewScene = new THREE.Scene();
    const pv = new PlayerView({ scene: gltfScene, animations } as any, viewScene);

    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180, 1);
    sim.start();
    sim.activateCenter(4);
    sim.shieldHits = 0; // shield spent, next front hit is fatal
    sim.invulnerableT = 0;
    sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 8, cars: 1 });
    sim.update(0.35);

    const events = sim.drainEvents();
    expect(sim.alive).toBe(false);
    pv.update(sim, 0.016, events);

    expect(pv.current).toBe('die');
    expect(pv.model.visible).toBe(true);
    expect(Object.values(pv.attachments).every((grp) => !grp.visible)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lives-elimination.test.ts`
Expected: FAIL (`audio.eliminated is not a function` / `Expected 'die', Received 'runlookback'`)

- [ ] **Step 3: Implement `Audio.eliminated`, `PlayerView` `'die'` handling, and `World` ghost `'die'` + `1.4s` hide**

1. In `src/audio.ts`:
   - Add `eliminated()`: layer a heavy lowpass crash `this.hiss(0.42, 0.55, 1600, 140, 0, 'lowpass')` with a 3-note downward sawtooth/triangle sweep (`320 -> 180`, `220 -> 110` at `0.1s`, `140 -> 55` at `0.22s`).
2. In `src/view/player.ts`:
   - In `update(sim, dt, events)`: handle `e.type === 'eliminated'` (set `this.stumbleT = 0`, `this.play('die', 0.06, 1.0)`). When `!sim.alive`, ensure `this.play('die', 0.08, 1.0)` stays active, keep `this.model.visible = true` (no invulnerability blink), zero lean/yaw targets (`dir = 0`), and pass `null` to `this.setCenterEffect(null, sim.time)`.
3. In `src/view/world.ts`:
   - Add `eliminatedTimer: number;` to `GhostSlot` (initialized to `0` on creation and slot assignment).
   - Also handle `ev.type === 'eliminated'` in `World.prototype.event(ev)` (if present) with stronger camera shake (`0.5`) and red particle burst (`28` particles of `0xf43f5e`).
   - In `syncGhostPack`:
     - Prefer surviving humans for `anchorRunner`: `others.find((r) => !r.isBot && !r.eliminated) || others.find((r) => !r.eliminated) || others[0]`.
     - When `!isRunning` (`LOBBY` / `COUNTDOWN` / `PODIUM`): reset `slot.eliminatedTimer = 0` and render all runners (`slot.group.visible = true`) in the grid playing `'idle'`.
     - When `isRunning && g.eliminated`:
       - On first frame (`slot.eliminatedTimer === 0`), trigger `this.fx.burst(slot.x, slot.y + 0.9, slot.z, 26, 0xf43f5e, { speed: 5.5, up: 3.4, size: 0.58, life: 0.55 })`, clear `updateCenterAttachments(slot.attachments, null, this.time)`, and call `this.playGhostClip(slot, 'die', 0.06, 1.0)`.
       - Advance `slot.eliminatedTimer += dt`, drift `slot.z += sim.speed * dt * 0.55` backward along the track at current `slot.supportY`, force `slot.charClone.visible = true`, step `slot.mixer.update(dt)`, and once `slot.eliminatedTimer > 1.4`, set `slot.group.visible = false` and `continue` so fallen ghosts never slide alongside active runners. (When `!g.eliminated`, reset `slot.eliminatedTimer = 0`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lives-elimination.test.ts tests/tv-smooth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/audio.ts src/view/player.ts src/view/world.ts tests/lives-elimination.test.ts
git commit -m "feat(view): play 3D die animation on eliminated runners and fade out fallen TV ghosts"
```

---

### Task 4: Mobile HUD Hearts, Option-A Eliminated Result Screen, TV Arena Leaderboard/Admin Presets, & Live Multiplayer Safeguards

**Files:**
- Modify: `index.html:139-161`
- Modify: `index.html:470-489`
- Modify: `src/ui.ts:17-49`
- Modify: `src/ui.ts:181-221`
- Modify: `src/ui.ts:335-366`
- Modify: `src/ui.ts:392-415`
- Modify: `src/ui.ts:575-598`
- Modify: `src/ui.ts:742-966`
- Modify: `src/main.ts:97-106`
- Modify: `src/main.ts:137-361`
- Modify: `src/main.ts:398-632`
- Test: `tests/lives-elimination.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_MAX_LIVES`, `sanitizeMaxLives` (`src/config.ts`); `Sim.lives`, `Sim.maxLives`, `Sim.survivedSec`, `Sim.setLives` (`src/sim/sim.ts`); `RoomSnapshot.maxLives`, `RoomSnapshot.eliminatedIds`, `RunnerNetState.eliminated`, `RunnerNetState.lives`, `RunnerNetState.survivedSec`, `HostCommand` (`set_max_lives`), `NetClient.disconnect` (`src/net.ts`); `Audio.eliminated` (`src/audio.ts`)
- Produces:
  - `src/ui.ts`:
    - `export function formatHeartsPill(lives: number, maxLives: number): string`
    - `export function formatTvRunnerStatus(runner: Pick<RunnerNetState, 'isBot' | 'eliminated' | 'lives' | 'survivedSec'>, roomMaxLives: number): string`
    - `export function describeResultHeader(opts: { eliminated: boolean; maxLives: number; survivedSec: number; rank: number; totalRunners: number; collectedCount: number; soloRun?: boolean; queuedNextRound?: boolean }): { titleTh: string; subtitleTh: string; ctaLabelTh: string; ctaDisabled: boolean }`
    - `export function shouldStepSimInScreen(screen: Screen, soloRun: boolean): boolean`
    - `export function shouldCancelDeathReveal(prevPhase: RoomSnapshot['phase'], nextPhase: RoomSnapshot['phase']): boolean`
    - `UI.prototype.hud(...)`: accepts `lives: number; maxLives: number`
    - `UI.prototype.result(...)`: accepts `eliminated?: boolean; maxLives?: number; survivedSec?: number; queuedNextRound?: boolean`
    - `UI.prototype.updateResultRank(opts: { rank: number; totalRunners: number; eliminated: boolean; survivedSec: number; queuedNextRound: boolean }): void`
    - `UI.prototype.setPauseMultiplayer(liveMultiplayer: boolean): void`
    - `UIHandlers.queueNextRound?(): void`

- [ ] **Step 1: Write the failing tests in `tests/lives-elimination.test.ts`**

Append unit tests to `tests/lives-elimination.test.ts` covering HUD heart pills (`3`, `5`, `0` unlimited), TV row status badges (`❤️❤️🖤`, `💀 ตาย 01:15`, `🤖`), Option-A eliminated vs full-survival result view-models + live rank updates + next-round CTA state, `LOBBY` reset cancellation during the `1.2s` death reveal (keeping `PODIUM` reveal intact), and non-freezing multiplayer Pause:
```ts
import {
  describeResultHeader,
  formatHeartsPill,
  formatTvRunnerStatus,
  shouldCancelDeathReveal,
  shouldStepSimInScreen,
} from '../src/ui';

describe('Mobile HUD Hearts, Option-A Eliminated Result Copy & TV Status Formatting', () => {
  it('formats mobile HUD hearts for 3 lives, 5 lives, and unlimited (0) mode', () => {
    expect(formatHeartsPill(3, 3)).toBe('❤️❤️❤️ 3/3');
    expect(formatHeartsPill(2, 3)).toBe('❤️❤️🖤 2/3');
    expect(formatHeartsPill(0, 3)).toBe('🖤🖤🖤 0/3');
    expect(formatHeartsPill(4, 5)).toBe('❤️❤️❤️❤️🖤 4/5');
    expect(formatHeartsPill(0, 0)).toBe('♾️ ไม่จำกัดชีวิต');
  });

  it('formats TV Top-10 status badges for surviving humans, eliminated humans (MM:SS), unlimited mode, and bots', () => {
    expect(formatTvRunnerStatus({ isBot: false, eliminated: false, lives: 2 }, 3)).toBe('❤️❤️🖤');
    expect(formatTvRunnerStatus({ isBot: false, eliminated: true, lives: 0, survivedSec: 75 }, 3)).toBe('💀 ตาย 01:15');
    expect(formatTvRunnerStatus({ isBot: false, eliminated: false, lives: 0 }, 0)).toBe('');
    expect(formatTvRunnerStatus({ isBot: true, eliminated: false, lives: 3 }, 3)).toBe('🤖');
  });

  it('builds Option-A eliminated result header, live rank line, and next-round queue CTA vs full survival & solo modes', () => {
    const elimBooth = describeResultHeader({
      eliminated: true,
      maxLives: 3,
      survivedSec: 84,
      rank: 2,
      totalRunners: 5,
      collectedCount: 4,
      soloRun: false,
      queuedNextRound: false,
    });
    expect(elimBooth.titleTh).toBe('💥 ชนครบ 3 ครั้ง! สิ้นสุดการวิ่ง');
    expect(elimBooth.subtitleTh).toContain('อยู่รอด 01:24');
    expect(elimBooth.subtitleTh).toContain('#2 จาก 5 คน');
    expect(elimBooth.ctaLabelTh).toBe('⏳ เข้าคิวรอรอบถัดไป');
    expect(elimBooth.ctaDisabled).toBe(false);

    const elimQueued = describeResultHeader({
      eliminated: true,
      maxLives: 3,
      survivedSec: 84,
      rank: 1,
      totalRunners: 5,
      collectedCount: 4,
      soloRun: false,
      queuedNextRound: true,
    });
    expect(elimQueued.subtitleTh).toContain('#1 จาก 5 คน');
    expect(elimQueued.ctaLabelTh).toBe('✅ อยู่ในคิวรอรอบถัดไป (รอดูผลบนจอทีวี)');
    expect(elimQueued.ctaDisabled).toBe(true);

    const survived = describeResultHeader({
      eliminated: false,
      maxLives: 3,
      survivedSec: 180,
      rank: 1,
      totalRunners: 4,
      collectedCount: 8,
      soloRun: false,
    });
    expect(survived.titleTh).toBe('🎉 พิชิตชั้น 10 สำเร็จ!');

    const soloElim = describeResultHeader({
      eliminated: true,
      maxLives: 3,
      survivedSec: 42,
      rank: 1,
      totalRunners: 1,
      collectedCount: 2,
      soloRun: true,
    });
    expect(soloElim.ctaLabelTh).toBe('🔄 เริ่มวิ่งใหม่อีกครั้ง');
    expect(soloElim.ctaDisabled).toBe(false);
  });

  it('keeps Sim stepping during multiplayer Pause (!soloRun) while freezing solo Pause, and cancels 1.2s death reveal only on LOBBY/COUNTDOWN reset (Review Focus #5)', () => {
    expect(shouldStepSimInScreen('play', false)).toBe(true);
    expect(shouldStepSimInScreen('play', true)).toBe(true);
    expect(shouldStepSimInScreen('pause', false)).toBe(true);
    expect(shouldStepSimInScreen('pause', true)).toBe(false);
    expect(shouldStepSimInScreen('over', false)).toBe(false);

    expect(shouldCancelDeathReveal('RUNNING', 'PODIUM')).toBe(false);
    expect(shouldCancelDeathReveal('RUNNING', 'LOBBY')).toBe(true);
    expect(shouldCancelDeathReveal('PODIUM', 'LOBBY')).toBe(true);
    expect(shouldCancelDeathReveal('RUNNING', 'COUNTDOWN')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lives-elimination.test.ts`
Expected: FAIL (`formatHeartsPill is not a function`)

- [ ] **Step 3: Implement CSS styles, `UI` hearts/result/TV-Admin components, and `main.ts` Option-A flow + multiplayer safeguards**

1. In `index.html`:
   - Add `.hud-lives` pill styling beneath `.score` (`background: var(--panel); border: 1px solid rgba(251,113,133,.45); border-radius: 999px; padding: 3px 10px; font-size: 13px; font-weight: 800; color: #fecdd3; font-variant-numeric: tabular-nums; transition: transform .18s`), `.hud-lives.unlimited` (`border-color: rgba(56,189,248,.45); color: #bae6fd`), and `.hud-lives.pulse` keyframe scale pop.
   - Add `.tv-btn.on` active preset highlight (`background: linear-gradient(135deg, rgba(56,189,248,.3), rgba(37,99,235,.28)); border-color: var(--gold); color: var(--gold); box-shadow: 0 0 10px rgba(250,204,21,.25)`), `.tv-lb-row.eliminated` (`background: rgba(127,29,29,.35); border: 1px solid rgba(251,113,133,.3); opacity: .78`), `.tv-lb-row.eliminated .tv-lb-name` (`text-decoration: line-through; color: #fca5a5`), and `.tv-lb-status` (`font-size: 11.5px; font-weight: 800; white-space: nowrap; color: #fecdd3`).
2. In `src/ui.ts`:
   - Export pure helpers `formatHeartsPill`, `formatTvRunnerStatus` (using `MM:SS` floor formatting `Math.max(0, Math.floor(sec))` for survival timestamps so `75s -> 01:15` and `84s -> 01:24`), `describeResultHeader`, `shouldStepSimInScreen(screen, soloRun)` (`screen === 'play' || (screen === 'pause' && !soloRun)`), and `shouldCancelDeathReveal(prevPhase, nextPhase)` (`(nextPhase === 'LOBBY' || nextPhase === 'COUNTDOWN') && nextPhase !== prevPhase`).
   - Add `<div class="hud-lives" id="hud-lives">❤️❤️❤️ 3/3</div>` inside `.hud-right` directly beneath `#score`, updating it in `hud(...)` (pulsing `.pulse` whenever `lives` decreases).
   - Add `id="r-title"` to `#s-over h2`; update `result(...)` and add `updateResultRank(...)` using `describeResultHeader`, wiring `#btn-again` so in booth eliminated/finished mode (`!soloRun` while room is `RUNNING` or `PODIUM`) clicking `#btn-again` invokes `this.handlers.queueNextRound?.()` instead of `restart()`.
   - Add `id="pause-note"` inside `#s-pause .panel` and `setPauseMultiplayer(liveMultiplayer: boolean)` so `!soloRun` displays `"⚠️ โหมดแข่งพร้อมจอทีวี: ตัวละครยังวิ่งต่อแบบสด!"` and changes `#btn-restart` text to `"🏳️ ออกจากการแข่งรอบนี้ (รอรอบถัดไป)"` (restoring `"เริ่มรอบใหม่"` in `soloRun`).
   - In `.tv-host-card`, add the 3 life-preset buttons row directly below duration buttons:
     - `#tv-btn-lives3`: `❤️ 3 ชีวิต` -> `{ action: 'set_max_lives', maxLives: 3 }`
     - `#tv-btn-lives5`: `❤️ 5 ชีวิต` -> `{ action: 'set_max_lives', maxLives: 5 }`
     - `#tv-btn-lives0`: `♾️ ไม่ตาย` -> `{ action: 'set_max_lives', maxLives: 0 }`
   - In `updateRoomSnapshot(snap, localPlayerId)`:
     - Toggle `.on` on `#tv-btn-lives3`, `#tv-btn-lives5`, `#tv-btn-lives0` matching `snap.maxLives` (and `.on` on `#tv-btn-dur180|120|90` matching `snap.matchDuration`).
     - Update `#ls-desc` when `snap.eliminatedIds.includes(localPlayerId)` during `RUNNING` to explain that the player finished this round and is queued for round `#${snap.matchId + 1}`.
     - Update `#tv-active-count`: when `humanCount > 0 && snap.maxLives > 0`, show `ผู้เล่นรอด ${aliveHumans}/${humanCount} คน · บอท ${botCount}` (keeping `${snap.activeRunners.length} คน (ผู้เล่น ${humanCount} · บอท ${botCount})` when `snap.maxLives === 0` or `humanCount === 0`).
     - Add `<span class="tv-lb-status"></span>` before `.tv-lb-score` in each `.tv-lb-row`, toggling `rowEl.classList.toggle('eliminated', !!r.eliminated)` and setting `statusEl.textContent = formatTvRunnerStatus(r, snap.maxLives)`.
3. In `src/main.ts`:
   - Track `let deathRevealTimer: number | null = null`, `let lastResultEliminated = false`, `let lastSurvivedSec = 0`, and `let queuedForNextRound = false`, with `clearDeathRevealTimer()` called inside `toLobby()` and `startMatchRun()` so an Admin `LOBBY` reset during the `1.2s` death animation never opens `#s-over` late.
   - Update `startMatchRun(seed, duration, initialElapsed = 0, maxLives = DEFAULT_MAX_LIVES)`: pass `maxLives` to `sim.reset(seed, false, duration, maxLives)`; when `!soloRun`, if `myRunner` in `latestRoom.activeRunners` has `lives !== undefined && maxLives > 0 && myRunner.lives < maxLives && !myRunner.eliminated`, call `sim.setLives(myRunner.lives, maxLives)` so refreshing mid-round preserves remaining lives.
   - Guard `joinQueue`: if `!isTvMode && latestRoom.phase === 'RUNNING' && (latestRoom.eliminatedIds.includes(savedProfile.id) || latestRoom.activeRunners.some((r) => r.id === savedProfile.id && r.eliminated))`, call `net.join(savedProfile, { immediate: false })`, `queuedForNextRound = true`, `ui.setLobbyReady(true)`, and toast `⏳ คุณจบการวิ่งในรอบนี้แล้ว — เข้าคิวรอรอบถัดไปเรียบร้อย!` without calling `startMatchRun`.
   - Implement `queueNextRound` handler on `UI`: calls `audio.click()`, `queuedForNextRound = true`, `hasJoinedLobby = true`, `net.join(savedProfile, { immediate: false })`, and refreshes `#s-over` CTA via `ui.updateResultRank(...)`.
   - In `publishRunnerStateNow()`: include `lives: sim.lives`, `maxLives: sim.maxLives`, `eliminated: !sim.alive`, `survivedSec: +sim.survivedSec.toFixed(2)`.
   - In `handleSimEvent(ev)`:
     - On `stumble` / `hit`: play `audio.stumble()`, `ui.flash('hit')`; if `ev.lostLife && (ev.livesLeft ?? 0) > 0`, toast `💔 ชนสิ่งกีดขวาง! เหลือ ${ev.livesLeft}/${ev.maxLives} ชีวิต (-${ev.penalty} แต้ม)` (`1500ms`); else if `!ev.lostLife`, toast `⚠️ เฉี่ยวสิ่งกีดขวาง -${ev.penalty} แต้ม` (`1000ms`).
     - On `eliminated`: set `lastResultEliminated = true`, `lastSurvivedSec = ev.survivedSec`, `queuedForNextRound = false`; call `audio.eliminated()`, `audio.stopMusic()`, `ui.flash('hit')`, `publishRunnerStateNow()`, and toast `💥 ชนครบ ${sim.maxLives} ครั้ง! สิ้นสุดการวิ่ง` (`1800ms`); persist `bestScore` & `collectedCenters`; start `deathRevealTimer = window.setTimeout(..., 1200)` which sets `state = 'over'` and opens `ui.result({ ..., eliminated: true, maxLives: sim.maxLives, survivedSec: ev.survivedSec, queuedNextRound: false })` + `ui.show('over')`.
   - In `net.onSnapshot(snap)`:
     - If `shouldCancelDeathReveal(prevPhase, snap.phase)`, call `clearDeathRevealTimer()` immediately.
     - If `!isTvMode && !soloRun && state === 'play' && sim.alive && snap.maxLives !== sim.maxLives`, call `sim.setLives(snap.maxLives === 0 ? 0 : Math.max(1, Math.min(snap.maxLives, sim.lives || snap.maxLives)), snap.maxLives)` so mid-race Admin `set_max_lives` takes effect immediately on running phones.
     - If `state === 'over' && !soloRun`, live-update rank on `#s-over` via `ui.updateResultRank(...)` using `snap.activeRunners`.
   - Live Multiplayer Pause & Forfeit Safeguard:
     - Call `ui.setPauseMultiplayer(!soloRun)` when opening pause.
     - In `tick(dt, draw)`, run `sim.update(dt)` and periodic `publishRunnerStateNow()` when `shouldStepSimInScreen(state, soloRun)` (and step `world.player.update` / `world.sync` with live `dt` whenever `state !== 'pause' || !soloRun`).
     - In `restart` and `home` handlers: if `!soloRun && !isTvMode && hasJoinedLobby && latestRoom.phase === 'RUNNING' && sim.alive && sim.maxLives > 0`, forfeit the active round first (`sim.setLives(0, sim.maxLives); sim.alive = false; sim.running = false; publishRunnerStateNow(); net.join(savedProfile, { immediate: false }); queuedForNextRound = true;`).
   - Backgrounded Tab & Disconnect Safeguards:
     - Change `window.addEventListener('pagehide', ...)` to call `net.disconnect(savedProfile.id)` instead of `net.leave(savedProfile.id)`.
     - Add a `250ms` `window.setInterval` that runs `tick(0.25, false)` whenever `document.hidden && !isTvMode && !soloRun && (state === 'play' || state === 'pause') && sim.alive`.
   - TV Surviving-Lead Camera (`src/main.ts:528`):
     - Change `const leadHuman = latestRoom.activeRunners.find((r) => !r.isBot && !r.eliminated);` so the TV camera smoothly hands off to the next surviving human when the leader crashes out.

- [ ] **Step 4: Run full test suite and production TypeScript + Vite build**

Run: `npm test && npm run build`
Expected: PASS (all Vitest test suites green and `tsc --noEmit && vite build` succeeds cleanly)

- [ ] **Step 5: Commit**

```bash
git add index.html src/ui.ts src/main.ts tests/lives-elimination.test.ts
git commit -m "feat(ui): add HUD hearts, Option-A eliminated wayfinding screen, TV lives presets, and multiplayer safeguards"
```
