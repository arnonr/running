# TECHNO SURFERS 3D: 10 Floors to Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "TECHNO SURFERS 3D: 10 Floors to Space (เทคโนเซิร์ฟเฟอร์ 3D: วิ่งทะลุมิติ พิชิต 9 ศูนย์นวัตกรรม)" 3D three-lane endless runner and synchronized 16:9 TV Live Arena for the TechnoPark Open House booth, extending `DanielLin0516/SUBWAY-SURFERS`.

**Architecture:** Pure TypeScript simulation (`src/sim/`) separated from a zero-GC Vanilla Three.js `InstancedMesh` renderer (`src/view/`), paired with a real-time synchronized match state machine (`src/net.ts` + `server/index.ts`) that runs 180-second shared-seed rounds across mobile clients and a 16:9 TV Live Arena (`?mode=tv`), with automatic `BroadcastChannel` + AI Ghost fallback when running standalone without a backend server.

**Tech Stack:** TypeScript 5, Three.js (`^0.155.0`), Vite 5, Vitest (unit/integration tests), `ws` (Node/Bun WebSocket server with optional Redis + built-in In-Memory Sorted Set leaderboard).

**Spec:** `docs/superpowers/specs/2026-10-27-techno-surfers-3d-design.md`

## Global Constraints

- **Game Title:** `TECHNO SURFERS 3D: 10 Floors to Space` / `เทคโนเซิร์ฟเฟอร์ 3D: วิ่งทะลุมิติ พิชิต 9 ศูนย์นวัตกรรม`
- **Default Match Duration:** `180` seconds (3 minutes), configurable by booth staff on the TV screen (`180`, `120`, `90` seconds).
- **No Instant Death:** Direct obstacle collisions never end the run early; they deduct `50` points (clamped at `0`), reset coin streak, slow speed to `65%` for `1.2s`, and grant `1.5s` invulnerability. Side grazes/bounces deduct `20` points and slow speed to `85%` for `0.6s`.
- **10-Floor Time-Synced Progression:** Floor progression (`Floor 1` → `Floor 10`) is driven by elapsed match time (`0s` → `180s`) across 4 zones so every runner reaches Floor 10 in the final 40 seconds regardless of stumbles.
- **9 TechnoPark Centers:** All 9 operating centers/institutes must appear as 5.0-second 3D transformation power-ups with at least 2 pickup opportunities per center in its corresponding zone, displaying the center's Thai name, actual exhibition floor badge, and special ability.
- **Synchronized TV Arena & Waiting Queue:** All players in a match start simultaneously (`t = 0`) using the same `matchSeed`. Visitors joining while a match is `COUNTDOWN` or `RUNNING` enter `waitingQueue` for the next round (where they can practice swiping on their 3D character and preview the 9 centers).
- **Hybrid Match Trigger:** After a `15s` podium display, `LOBBY` runs a `45s` auto-countdown once at least 1 player is present, with TV host controls to `start_now` or `toggle_hold`.
- **Mobile Browser Safety:** Enforce `touch-action: none; overscroll-behavior: none; user-select: none;` and unlock WebAudio on user gesture.

## Review Focus

1. **Score underflow on repeated early collisions:** A player who hits an obstacle at `score = 20` (with `-50` penalty) must have `score` clamped to `0`, never negative. (Tested in Task 3)
2. **Airborne power-up expiration over train roofs/obstacles:** When Center #1 (`Jet Fighter Pack`, `y = 4.2m`) expires while the runner is directly above a train (`train` or `mtrain`), the runner must receive `1.2s` post-power invulnerability (`invulnerableT >= 1.2`) and land safely on walkable train roofs without taking a `-50` front-hit penalty. (Tested in Task 3)
3. **Power-up pickup overwrite mid-transformation:** Collecting a new Center capsule while another Center power-up is still active must immediately switch `activeCenter` to the new Center, reset `centerTimer = 5.0`, award the pickup bonus, and grant `1.0s` grace invulnerability. (Tested in Task 3)
4. **Latecomer state isolation during active `RUNNING` match:** A player who joins while the room is in `RUNNING` state must be placed in `waitingQueue` and any `state` updates from queued players must be ignored by the active round's leaderboard until the next round starts. (Tested in Task 4)
5. **Nickname sanitization and empty input handling:** Submitting whitespace-only or HTML-injected nicknames (e.g. `"   "` or `"<script>alert(1)</script>"`) in Quick Join must sanitize to a safe fallback display name (`"นักวิ่ง Techno"` or stripped plain text up to 16 chars). (Tested in Task 4)

---

### Task 1: Project Scaffolding, Reference Assets & TechnoPark Domain Config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `public/assets/core.glb` (copied from `/tmp/subway-surfers-ref/public/assets/core.glb`)
- Create: `public/assets/scenery.glb` (copied from `/tmp/subway-surfers-ref/public/assets/scenery.glb`)
- Create: `public/favicon.ico` (copied from `/tmp/subway-surfers-ref/public/favicon.ico`)
- Create: `src/sim/types.ts`
- Create: `src/sim/rng.ts`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: none (foundational module)
- Produces:
  - `src/sim/types.ts`:
    - `export type ObKind = 'low' | 'hurdle' | 'overhead' | 'train' | 'ramp' | 'mtrain'`
    - `export type CenterId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9`
    - `export type ZoneId = 1 | 2 | 3 | 4`
    - `export type Hint = 'jump' | 'slide' | 'lane' | 'ramp'`
    - `export interface Ob { id: number; kind: ObKind; lane: number; d0: number; d1: number; yb: number; yt: number; halfW: number; walk: boolean; cars: number; variant: number; hint: Hint | null; hinted: boolean; meet: number; len: number; pd0: number; pd1: number; }`
    - `export interface Coin { id: number; lane: number; d: number; y: number; x: number; pulled: boolean; bonus?: boolean; }`
    - `export interface CenterPickup { id: number; centerId: CenterId; lane: number; d: number; y: number; }`
    - `export type SimEvent = { type: 'jump'; super: boolean } | { type: 'land'; fall: number } | { type: 'slide' } | { type: 'lane'; dir: number } | { type: 'bump'; dir: number } | { type: 'stumble'; x: number; y: number; penalty: number } | { type: 'hit'; kind: ObKind; x: number; y: number; penalty: number } | { type: 'shieldBlock'; x: number; y: number; remaining: number } | { type: 'armorSmash'; kind: ObKind; x: number; y: number; bonus: number } | { type: 'coin'; x: number; y: number; streak: number } | { type: 'centerPower'; centerId: CenterId; x: number; y: number; firstTime: boolean } | { type: 'centerPowerEnd'; centerId: CenterId } | { type: 'floorChange'; floor: number; zoneId: ZoneId } | { type: 'finish'; score: number; coins: number; distance: number } | { type: 'hint'; hint: Hint }`
  - `src/sim/rng.ts`:
    - `export class Rng { constructor(seed?: number); next(): number; range(a: number, b: number): number; int(a: number, b: number): number; chance(p: number): boolean; pick<T>(arr: readonly T[]): T; weighted<K extends string>(w: Record<K, number>): K; }`
  - `src/config.ts`:
    - `export const GAME_TITLE = { en: 'TECHNO SURFERS 3D: 10 Floors to Space', th: 'เทคโนเซิร์ฟเฟอร์ 3D: วิ่งทะลุมิติ พิชิต 9 ศูนย์นวัตกรรม' }`
    - `export const DEFAULT_MATCH_DURATION = 180`
    - `export const POWER_DURATION = 5.0`
    - `export const PICKUP_PULL_RANGE = 2.2`
    - `export interface CenterMeta { id: CenterId; nameTh: string; shortTh: string; exhibitionFloorTh: string; exhibitionFloorGroup: 1 | 2 | 8 | 9 | 10; powerName: string; powerDescTh: string; color: string; icon: string; zoneId: ZoneId; spawnTimes: [number, number]; }`
    - `export const CENTERS: Record<CenterId, CenterMeta>`
    - `export const CENTER_LIST: CenterMeta[]`
    - `export function floorAtProgress(progress01: number): number` (maps `0..1` to integer floor `1..10`)
    - `export function zoneAtProgress(progress01: number): ZoneId` (maps `0..1/3` -> `1`, `1/3..5/9` -> `2`, `5/9..7/9` -> `3`, `7/9..1` -> `4`)
    - `export function baseMultForFloor(floor: number): number` (`1` for floors 1-3, `2` for 4-7, `3` for 8-9, `4` for 10)
    - `export function speedAtProgress(progress01: number): number` (ramps smoothly from `12.0` to `25.0 m/s`)

- [ ] **Step 1: Copy reference assets and initialize `package.json`, `tsconfig.json`, and `vite.config.ts`**

Run:
```bash
mkdir -p /Users/macbook-arnon/Projects/running/public/assets
cp /tmp/subway-surfers-ref/public/assets/core.glb /Users/macbook-arnon/Projects/running/public/assets/core.glb
cp /tmp/subway-surfers-ref/public/assets/scenery.glb /Users/macbook-arnon/Projects/running/public/assets/scenery.glb
cp /tmp/subway-surfers-ref/public/favicon.ico /Users/macbook-arnon/Projects/running/public/favicon.ico
```
Create `package.json` with `three@^0.155.0`, `ws@^8.18.0`, devDependencies `@types/three`, `@types/ws`, `@types/node`, `typescript@~5.3.0`, `vite@^5.0.10`, `vitest@^1.6.0`, `tsx@^4.7.0`, and scripts `"dev": "vite"`, `"build": "tsc --noEmit && vite build"`, `"test": "vitest run"`, `"server": "tsx server/index.ts"`. Run `npm install`.

- [ ] **Step 2: Write the failing test in `tests/config.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import {
  CENTERS, CENTER_LIST, DEFAULT_MATCH_DURATION, POWER_DURATION,
  floorAtProgress, zoneAtProgress, baseMultForFloor, speedAtProgress,
} from '../src/config';
import { Rng } from '../src/sim/rng';

describe('TechnoPark Config & RNG', () => {
  it('defines all 9 TechnoPark centers with 2 scheduled spawn times within 180s', () => {
    expect(CENTER_LIST).toHaveLength(9);
    for (let id = 1; id <= 9; id++) {
      const c = CENTERS[id as keyof typeof CENTERS];
      expect(c).toBeDefined();
      expect(c.nameTh.length).toBeGreaterThan(5);
      expect(c.spawnTimes[0]).toBeGreaterThan(5);
      expect(c.spawnTimes[1]).toBeGreaterThan(c.spawnTimes[0]);
      expect(c.spawnTimes[1]).toBeLessThan(DEFAULT_MATCH_DURATION - 5);
    }
    // Verify 4 centers exhibit on Floor 1
    const floor1Centers = CENTER_LIST.filter((c) => c.exhibitionFloorGroup === 1);
    expect(floor1Centers.map((c) => c.id)).toEqual([1, 3, 4, 5]);
    expect(POWER_DURATION).toBe(5.0);
  });

  it('maps normalized match progress (0..1) across Floors 1..10, Zones 1..4, and Speed 12..25', () => {
    expect(floorAtProgress(0)).toBe(1);
    expect(floorAtProgress(0.30)).toBe(1);
    expect(floorAtProgress(0.45)).toBeGreaterThanOrEqual(2);
    expect(floorAtProgress(0.65)).toBe(8);
    expect(floorAtProgress(0.95)).toBe(10);
    expect(zoneAtProgress(0.1)).toBe(1);
    expect(zoneAtProgress(0.4)).toBe(2);
    expect(zoneAtProgress(0.65)).toBe(3);
    expect(zoneAtProgress(0.85)).toBe(4);
    expect(baseMultForFloor(1)).toBe(1);
    expect(baseMultForFloor(5)).toBe(2);
    expect(baseMultForFloor(8)).toBe(3);
    expect(baseMultForFloor(10)).toBe(4);
    expect(speedAtProgress(0)).toBeCloseTo(12.0, 1);
    expect(speedAtProgress(1)).toBeCloseTo(25.0, 1);
  });

  it('produces identical random sequences for identical seeds', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    expect([a.next(), a.int(0, 9), a.range(10, 20)]).toEqual([b.next(), b.int(0, 9), b.range(10, 20)]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL with module not found `../src/config`.

- [ ] **Step 4: Implement `src/sim/types.ts`, `src/sim/rng.ts`, and `src/config.ts`**

Implement the exact types and constants from the spec (sections 5.1 and 5.2), preserving `PLAYER`, `GRAVITY`, `JUMP_V`, `SUPER_JUMP_V`, `OB`, `MOVER`, `CAR_LEN`, `CAR_GAP`, `trainLength`, `moverFront`, `moverSpan`, `VIEW_AHEAD`, `LANE_W`, `LANE_COUNT`, and `laneX` from `/tmp/subway-surfers-ref/src/config.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/config.test.ts`
Expected: PASS (3 passed).

---

### Task 2: Deterministic Track Generator, Path Solver & 9-Center Capsule Spawner

**Files:**
- Create: `src/sim/track.ts`
- Test: `tests/track.test.ts`

**Interfaces:**
- Consumes: `src/config.ts`, `src/sim/types.ts`, `src/sim/rng.ts`
- Produces:
  - `src/sim/track.ts`:
    - `export function solve(specs: Spec[], start: number, end: number, startLanes: number[], speed: number | ((d: number) => number), wantPath?: boolean, preferLane?: number): SolveResult`
    - `export interface TrackSink { ob(spec: Spec): void; coin(lane: number, d: number, y: number): void; centerPickup(centerId: CenterId, lane: number, d: number, y: number): void; }`
    - `export class Track { constructor(seed: number, sink: TrackSink); reset(seed: number, tutorial: boolean): void; ensure(upTo: number): void; frontier: number; chunks: number; failures: number; spawnedCenters: CenterId[]; }`

- [ ] **Step 1: Write the failing test in `tests/track.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { Track, solve, type Spec } from '../src/sim/track';
import type { CenterId } from '../src/sim/types';
import { speedAt } from '../src/config';

describe('Track Generator & 9-Center Capsule Spawner', () => {
  it('generates solvable chunks up to 3400m and spawns all 9 Center pickups at least twice', () => {
    const obs: Spec[] = [];
    const pickups: { centerId: CenterId; lane: number; d: number; y: number }[] = [];
    const track = new Track(42, {
      ob: (s) => obs.push(s),
      coin: () => {},
      centerPickup: (centerId, lane, d, y) => pickups.push({ centerId, lane, d, y }),
    });
    track.reset(42, false);
    track.ensure(3400);

    // Every center 1..9 must appear at least twice across the 3-minute (~3200m) track
    for (let id = 1 as CenterId; id <= 9; id = (id + 1) as CenterId) {
      const matches = pickups.filter((p) => p.centerId === id);
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }

    // No pickup may overlap a solid train body in the same lane
    for (const p of pickups) {
      const overlapsTrain = obs.some(
        (o) => (o.kind === 'train' || o.kind === 'mtrain' || o.kind === 'ramp') &&
          o.lane === p.lane && p.d >= o.d0 - 2 && p.d <= o.d1 + 2
      );
      expect(overlapsTrain).toBe(false);
    }

    // Full path solve verification
    const res = solve(obs, 0, track.frontier, [1], speedAt, false);
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/track.test.ts`
Expected: FAIL with module not found `../src/sim/track`.

- [ ] **Step 3: Implement `src/sim/track.ts`**

Adapt `/tmp/subway-surfers-ref/src/sim/track.ts` and replace random `placePower` with a scheduled queue of `(centerId, targetDistance)` computed from each center's `spawnTimes` in `CENTERS` integrated over the nominal speed curve (`~18` total pickups across `0..3200m`). For each chunk `[start, end]`, any scheduled pickup whose target distance falls in the chunk is placed on the solver's verified ground path (`!pt.top`) clear of obstacles.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/track.test.ts`
Expected: PASS.

---

### Task 3: Forgiving 180s Simulation Engine & All 9 Center Power-Up Abilities

**Files:**
- Create: `src/sim/sim.ts`
- Test: `tests/sim.test.ts`

**Interfaces:**
- Consumes: `src/config.ts`, `src/sim/types.ts`, `src/sim/track.ts`
- Produces:
  - `src/sim/sim.ts`:
    - `export class Sim` with properties:
      - `lane: number`, `x: number`, `y: number`, `vy: number`, `d: number`, `speed: number`
      - `time: number`, `matchDuration: number`, `timeLeft: number`, `progress01: number`
      - `floor: number`, `zoneId: ZoneId`, `alive: boolean`, `running: boolean`, `finished: boolean`
      - `score: number`, `coins: number`, `mult: number`, `hitCount: number`
      - `activeCenter: CenterId | null`, `centerTimer: number`, `shieldHits: number`, `invulnerableT: number`
      - `collectedCenters: Set<CenterId>`
      - `obs: Ob[]`, `coinList: Coin[]`, `pickups: CenterPickup[]`, `events: SimEvent[]`
      - Methods: `reset(seed: number, tutorial?: boolean, matchDuration?: number): void`, `start(): void`, `left(): void`, `right(): void`, `jump(): void`, `down(): void`, `update(dt: number): void`, `activateCenter(centerId: CenterId): void`, `drainEvents(): SimEvent[]`, `snapshot(): SimSnapshot`

- [ ] **Step 1: Write the failing test in `tests/sim.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';

describe('Sim: Forgiving No-Death Rules, 180s Timer & 9 Center Power-Ups', () => {
  it('never kills the runner on front collision, clamps score >= 0, and applies -50 penalty + invulnerability', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180);
    sim.start();
    sim.score = 20; // Review Focus #1: score < 50 before collision
    const d0 = sim.d + 3;
    sim.addOb({ kind: 'train', lane: 1, d0, d1: d0 + 10, cars: 1 });
    sim.update(0.5);
    expect(sim.alive).toBe(true);
    expect(sim.score).toBeGreaterThanOrEqual(0);
    expect(sim.hitCount).toBe(1);
    expect(sim.invulnerableT).toBeGreaterThan(0);
  });

  it('grants safe landing invulnerability when Center #1 (Jet Fighter Pack) expires over a train', () => {
    // Review Focus #2
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180);
    sim.start();
    sim.activateCenter(1); // Jet Fighter Pack -> flies at y ~ 4.2m
    sim.update(0.5);
    expect(sim.y).toBeGreaterThan(3.5);

    // Place a long unwalkable moving train directly underneath when timer expires
    sim.addOb({ kind: 'mtrain', lane: 1, d0: sim.d - 2, d1: sim.d + 40, cars: 3 });
    sim.centerTimer = 0.05;
    sim.update(0.1); // power-up expires
    expect(sim.activeCenter).toBeNull();
    expect(sim.invulnerableT).toBeGreaterThanOrEqual(1.0);
    const hitsBefore = sim.hitCount;
    sim.update(0.8); // falls through/onto train during grace window
    expect(sim.hitCount).toBe(hitsBefore);
    expect(sim.alive).toBe(true);
  });

  it('overwrites active power-up cleanly when picking up a new Center capsule (Review Focus #3)', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180);
    sim.start();
    sim.activateCenter(1);
    sim.update(1.0);
    expect(sim.activeCenter).toBe(1);
    sim.addCenterPickup(5, 1, sim.d + 0.2, sim.y);
    sim.update(0.1);
    expect(sim.activeCenter).toBe(5);
    expect(sim.centerTimer).toBeGreaterThan(4.8);
    expect(sim.collectedCenters.has(1)).toBe(true);
    expect(sim.collectedCenters.has(5)).toBe(true);
  });

  it('executes special abilities for Centers #2, #3, #4, #6, #7, #8, #9 and finishes cleanly at 180s', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180);
    sim.start();

    // #3 EV Train Armor smashes obstacle for +100 bonus without hit penalty
    sim.activateCenter(3);
    const s0 = sim.score;
    sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 9, cars: 1 });
    sim.update(0.35);
    expect(sim.hitCount).toBe(0);
    expect(sim.score).toBeGreaterThan(s0 + 90);

    // #4 Green Energy Shield blocks 2 hits
    sim.activateCenter(4);
    expect(sim.shieldHits).toBe(2);

    // #6 Radar Path Scanner converts barriers ahead into coins
    sim.clearWorld();
    sim.activateCenter(6);
    sim.addOb({ kind: 'low', lane: 0, d0: sim.d + 15, d1: sim.d + 15.7 });
    sim.update(0.1);
    expect(sim.obs.length).toBe(0);
    expect(sim.coinList.length).toBeGreaterThan(0);

    // #8 Med-Tech Recovery Drone clears stumbleSlow and adds +500 points
    sim.stumbleSlow = 1.0;
    const before8 = sim.score;
    sim.activateCenter(8);
    expect(sim.stumbleSlow).toBe(0);
    expect(sim.score).toBeGreaterThanOrEqual(before8 + 500);

    // Step to end of 180s match -> floor reaches 10 and finished = true
    sim.time = 179.9;
    sim.update(0.2);
    expect(sim.finished).toBe(true);
    expect(sim.running).toBe(false);
    expect(sim.floor).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim.test.ts`
Expected: FAIL with module not found `../src/sim/sim`.

- [ ] **Step 3: Implement `src/sim/sim.ts`**

Extend `/tmp/subway-surfers-ref/src/sim/sim.ts` with the 180-second match timer, time-based Floor 1–10 and Zone 1–4 progression, forgiving front-hit (`-50` pts, `stumbleSlow = 1.2`, `invulnerableT = 1.5`) and side-bounce (`-20` pts) mechanics, and all 9 Center Power-Up effects (`activateCenter(id)`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/sim.test.ts`
Expected: PASS (4 passed).

---

### Task 4: Synchronized Match Room Engine, WebSocket Server & Multi-Tab Fallback

**Files:**
- Create: `src/net.ts`
- Create: `server/index.ts`
- Test: `tests/net.test.ts`

**Interfaces:**
- Consumes: `src/config.ts`, `src/sim/types.ts`
- Produces:
  - `src/net.ts`:
    - `export type RoomPhase = 'LOBBY' | 'COUNTDOWN' | 'RUNNING' | 'PODIUM'`
    - `export type PlayerRole = 'junior' | 'senior' | 'uni' | 'public'`
    - `export interface PlayerProfile { id: string; name: string; role: PlayerRole; color: string; avatar?: string; }`
    - `export interface RunnerNetState { id: string; name: string; role: PlayerRole; color: string; lane: number; x: number; y: number; d: number; score: number; coins: number; floor: number; activeCenter: CenterId | null; collectedCount: number; rank: number; packOffsetZ: number; isBot?: boolean; }`
    - `export interface RoomSnapshot { matchId: number; phase: RoomPhase; phaseTimeLeft: number; matchDuration: number; lobbyHold: boolean; matchSeed: number; referenceDistance: number; currentFloor: number; activeRunners: RunnerNetState[]; top10: RunnerNetState[]; waitingQueue: PlayerProfile[]; allDayBest: { name: string; score: number; role: PlayerRole }[]; }`
    - `export function sanitizeNickname(raw: string): string`
    - `export class MatchRoomCore` (pure state machine used by both `server/index.ts` and client-side fallback)
    - `export class NetClient` (connects via WebSocket if available, automatically falling back to `BroadcastChannel('techno-surfers-room')` + simulated AI Ghost runners so single-machine multi-tab TV + Mobile testing works out-of-the-box)
  - `server/index.ts`:
    - WebSocket + HTTP status server on port `8787` wrapping `MatchRoomCore`.

- [ ] **Step 1: Write the failing test in `tests/net.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { MatchRoomCore, sanitizeNickname } from '../src/net';

describe('MatchRoomCore: Synchronized Rounds, Waiting Queue & Hybrid Controls', () => {
  it('sanitizes empty or HTML-injected nicknames (Review Focus #5)', () => {
    expect(sanitizeNickname('   ')).toBe('นักวิ่ง Techno');
    expect(sanitizeNickname('<script>alert(1)</script>นนท์')).toBe('alert(1)นนท์');
    expect(sanitizeNickname('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toHaveLength(16);
  });

  it('places players joining during RUNNING into waitingQueue and isolates active leaderboard (Review Focus #4)', () => {
    const room = new MatchRoomCore();
    room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' });
    room.join({ id: 'p2', name: 'เมย์', role: 'uni', color: '#22c55e' });
    expect(room.phase).toBe('LOBBY');

    // Host triggers start_now -> COUNTDOWN -> step 3.6s -> RUNNING
    room.hostCommand({ action: 'start_now' });
    expect(room.phase).toBe('COUNTDOWN');
    room.tick(3.6);
    expect(room.phase).toBe('RUNNING');
    expect(room.getSnapshot().activeRunners).toHaveLength(2);

    // Latecomer joins mid-run -> goes to waitingQueue, NOT activeRunners
    room.join({ id: 'p3', name: 'คนมาทีหลัง', role: 'junior', color: '#f59e0b' });
    room.updateRunnerState('p3', { lane: 1, x: 0, y: 0, d: 500, score: 99999, coins: 100, floor: 5, activeCenter: null, collectedCount: 5 });
    const snapMid = room.getSnapshot();
    expect(snapMid.waitingQueue.map((p) => p.id)).toEqual(['p3']);
    expect(snapMid.activeRunners.find((r) => r.id === 'p3')).toBeUndefined();
    expect(snapMid.top10.find((r) => r.id === 'p3')).toBeUndefined();

    // Update p1 and p2 -> verify rank sorting and clamped packOffsetZ in [-14, +10]
    room.updateRunnerState('p1', { lane: 0, x: -2.5, y: 0, d: 320, score: 4500, coins: 40, floor: 2, activeCenter: 2, collectedCount: 2 });
    room.updateRunnerState('p2', { lane: 2, x: 2.5, y: 0, d: 210, score: 2100, coins: 18, floor: 2, activeCenter: null, collectedCount: 1 });
    const snapRanked = room.getSnapshot();
    expect(snapRanked.top10[0].id).toBe('p1');
    expect(snapRanked.top10[0].packOffsetZ).toBeLessThanOrEqual(10);
    expect(snapRanked.top10[1].packOffsetZ).toBeGreaterThanOrEqual(-14);

    // Finish 180s match -> PODIUM (15s) -> next LOBBY automatically promotes p3 from waitingQueue
    room.tick(180.5);
    expect(room.phase).toBe('PODIUM');
    room.tick(15.5);
    expect(room.phase).toBe('LOBBY');
    const snapNext = room.getSnapshot();
    expect(snapNext.activeRunners.some((r) => r.id === 'p3')).toBe(true);
    expect(snapNext.waitingQueue).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/net.test.ts`
Expected: FAIL with module not found `../src/net`.

- [ ] **Step 3: Implement `src/net.ts` and `server/index.ts`**

Implement `sanitizeNickname`, `MatchRoomCore`, `NetClient` (with WebSocket + `BroadcastChannel` multi-tab sync + optional AI Ghosts for TV Arena demo), and `server/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/net.test.ts`
Expected: PASS (2 passed).

---

### Task 5: 3D View Engine, 10-Floor Atmosphere, 9-Center 3D Transformations & Ghost Pack Renderer

**Files:**
- Create: `src/view/assets.ts`
- Create: `src/view/pools.ts`
- Create: `src/view/textures.ts`
- Create: `src/view/fx.ts`
- Create: `src/view/player.ts`
- Create: `src/view/world.ts`
- Create: `src/audio.ts`
- Create: `src/input.ts`
- Create: `src/storage.ts`
- Test: `tests/view-data.test.ts`

**Interfaces:**
- Consumes: `src/config.ts`, `src/sim/types.ts`, `src/sim/sim.ts`, `src/net.ts`
- Produces:
  - `src/view/world.ts`: `export class World` with `sync(sim: Sim, dt: number, menu: boolean, ghosts?: RunnerNetState[], tvMode?: boolean): void`, `warm(renderer: THREE.WebGLRenderer): void`
  - `src/view/player.ts`: `export class PlayerView` with 9 Center 3D attachment meshes (`setCenterEffect(centerId: CenterId | null, time: number): void`)
  - `src/audio.ts`: `export class Audio` with `centerPower(centerId: CenterId): void`, `countdownBeep(final: boolean): void`
  - `src/input.ts`: `export function bindInput(...)`
  - `src/storage.ts`: `export function load<T>(key: string, fallback: T): T`, `export function save(key: string, val: unknown): void`

- [ ] **Step 1: Write the failing test in `tests/view-data.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { ZONE_PALETTES, lerpZonePalette } from '../src/view/textures';

describe('10-Floor Zone Atmosphere Palettes', () => {
  it('defines distinct sky, fog, and neon accent colors for all 4 floor zones and interpolates smoothly', () => {
    expect(Object.keys(ZONE_PALETTES)).toHaveLength(4);
    const p1 = lerpZonePalette(0.1);
    const p4 = lerpZonePalette(0.95);
    expect(p1.fogHex).not.toBe(p4.fogHex);
    expect(p4.starIntensity).toBeGreaterThan(0.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/view-data.test.ts`
Expected: FAIL with module not found `../src/view/textures`.

- [ ] **Step 3: Implement `src/view/*`, `src/audio.ts`, `src/input.ts`, and `src/storage.ts`**

Port `/tmp/subway-surfers-ref/src/view/*`, `src/audio.ts`, `src/input.ts`, and `src/storage.ts`, upgrading:
1. `src/view/textures.ts`: Add `ZONE_PALETTES`, `lerpZonePalette(progress01)`, `centerCapsuleTexture(centerId: CenterId)`, and `nameBadgeTexture(name, rank, color)`.
2. `src/view/player.ts`: Add 9 procedural 3D attachment groups attached to `this.root` for Centers `1..9` (wings/thruster for #1, dual wingman drones for #2, glowing EV train ram shield for #3, geodesic green sphere for #4, 5G signal rings for #5, rotating radar dish/sweep for #6, DNA helix boots glow for #7, orbiting medical drone for #8, twin space booster rockets for #9).
3. `src/view/world.ts`: Render all 9 Center pickup capsules with halos, smoothly transition sky/fog/track neon lights across the 4 Floor Zones, and render interpolated 3D Ghost runners (`RunnerNetState[]`) with name badges and power-up auras on the shared track (especially in `?mode=tv`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/view-data.test.ts`
Expected: PASS.

---

### Task 6: Upgraded Mobile UX/UI, Waiting Lobby, Smart Wayfinding Directory & 16:9 TV Live Arena

**Files:**
- Create: `index.html`
- Create: `src/ui.ts`
- Create: `src/main.ts`
- Test: `tests/ui-wayfinding.test.ts`

**Interfaces:**
- Consumes: `src/config.ts`, `src/sim/sim.ts`, `src/net.ts`, `src/view/world.ts`, `src/audio.ts`, `src/input.ts`, `src/storage.ts`
- Produces:
  - `src/ui.ts`: `export function groupCentersByExhibitionFloor(collected: Iterable<CenterId>): ExhibitionFloorGroup[]`, `export class UI` (manages Mobile Quick Join, Interactive Waiting Lobby, Countdown Overlay, In-Game Arcade HUD with 9-Center Hologram Banner, Smart Wayfinding Result Screen, and `?mode=tv` 16:9 TV Live Arena Dashboard with Hybrid Host Controls).
  - `src/main.ts`: Boot sequence, 60 FPS loop, `NetClient` synchronization (`250ms` state publish), and `?mode=tv` / `?test` hooks.

- [ ] **Step 1: Write the failing test in `tests/ui-wayfinding.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { groupCentersByExhibitionFloor } from '../src/ui';

describe('Smart Wayfinding Exhibition Directory Grouping', () => {
  it('groups all 9 TechnoPark centers into actual exhibition floors (1, 2, 8, 9, 10) and marks unlocked centers', () => {
    const groups = groupCentersByExhibitionFloor([1, 3, 6, 9]);
    expect(groups.map((g) => g.floor)).toEqual([1, 2, 8, 9, 10]);

    const floor1 = groups.find((g) => g.floor === 1)!;
    expect(floor1.centers.map((c) => c.id)).toEqual([1, 3, 4, 5]);
    expect(floor1.centers.find((c) => c.id === 1)?.unlocked).toBe(true);
    expect(floor1.centers.find((c) => c.id === 4)?.unlocked).toBe(false);

    const floor8 = groups.find((g) => g.floor === 8)!;
    expect(floor8.centers.map((c) => c.id)).toEqual([6, 7]);
    expect(floor8.centers.find((c) => c.id === 6)?.unlocked).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ui-wayfinding.test.ts`
Expected: FAIL with module not found `../src/ui`.

- [ ] **Step 3: Implement `index.html`, `src/ui.ts`, and `src/main.ts`**

Implement the complete responsive UI and game loop supporting both Mobile Client (`/`) and 16:9 TV Live Arena (`/?mode=tv`), plus a quick mode switcher button in the corner so booth staff/testers can toggle or open TV Arena view in one click.

- [ ] **Step 4: Run all unit tests and production build verification**

Run: `npm test && npm run build`
Expected: All test suites PASS and `vite build` succeeds with zero TypeScript or bundler errors.
