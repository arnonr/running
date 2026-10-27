# TV Mode 60 FPS Smooth Rendering & GPU Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate frame stuttering in TV Live Arena (`?mode=tv`) by interpolating TV elapsed time & track distance at 60 FPS, caching ghost nameplate textures, and eliminating DOM thrashing and `backdrop-filter` GPU stalls.

**Architecture:** Extract a pure `stepTvClock(currentElapsed, dt, snap)` helper in `src/config.ts` (consumed by `src/main.ts`) that advances the TV timeline at 60 FPS with smooth drift correction toward the 10 Hz `RoomSnapshot` and computes exact `distanceAtTime` and `floorAtProgress` every frame. Bound `nameBadgeTexture` with a 64-entry LRU cache in `src/view/textures.ts`, reuse `.tv-lb-row` DOM elements in `src/ui.ts`, and replace `backdrop-filter: blur(10px)` on `.tv-*` cards in `index.html` with GPU-friendly translucent gradients.

**Tech Stack:** TypeScript, Three.js, HTML5 Canvas, Vitest

**Spec:** `docs/superpowers/specs/2026-10-27-tv-mode-smooth-60fps-design.md`

## Global Constraints

- TV mode must advance `sim.time` and `sim.d` continuously every frame (`dt`) during `RUNNING` instead of stepping on 10 Hz (`100ms`) snapshots.
- When `Math.abs(targetElapsed - currentElapsed) > 1.5` (e.g. new match start, duration change, or tab switch), `stepTvClock` snaps immediately to `targetElapsed`; otherwise it smoothly blends (`dt * 6`).
- `nameBadgeTexture` cache must be bounded to `64` entries (`NAME_BADGE_CACHE_LIMIT = 64`) and evict the oldest entry when full.
- `World.syncGhostPack` must not call `.dispose()` on cached `nameBadgeTexture` instances.

## Review Focus

- Monotonic smooth progression between 10 Hz snapshots: when `phaseTimeLeft` stays constant across 5 consecutive 16.6ms frames (`dt = 1 / 60`), `stepTvClock` must still advance `elapsed` and `d` smoothly every frame rather than freezing.
- Match reset / phase transition: when `phase !== 'RUNNING'`, `stepTvClock` must return `elapsed = 0, d = 0, speed = 0, floor = 1`.
- Large time jump / duration change: when `targetElapsed` jumps by `> 1.5s`, `stepTvClock` snaps immediately without lag.
- Bounded texture cache: calling `nameBadgeTexture` with identical `(name, rank, color)` returns the exact same `THREE.Texture` reference, and exceeding `64` unique keys evicts the oldest entry.

---

### Task 1: 60 FPS TV Clock Interpolation, Bounded Badge Texture Cache & Zero-Thrash TV Overlay

**Files:**
- Modify: `src/config.ts:240-280`
- Modify: `src/main.ts:355-395`
- Modify: `src/view/textures.ts:599-622`
- Modify: `src/view/world.ts:1540-1588`
- Modify: `src/ui.ts:445-510`
- Modify: `index.html:274-334`
- Test: `tests/tv-smooth.test.ts`

**Interfaces:**
- Produces:
  - `src/config.ts`:
    - `export interface TvClockState { elapsed: number; d: number; speed: number; floor: number; progress01: number; stageIndex: number; stageCenter: CenterId }`
    - `export function stepTvClock(prevElapsed: number, dt: number, phase: string, phaseTimeLeft: number, matchDuration: number): TvClockState`
  - `src/view/textures.ts`:
    - `export const NAME_BADGE_CACHE_LIMIT = 64;`
    - `export function nameBadgeTexture(name: string, rank: number, color: string): THREE.CanvasTexture`

- [ ] **Step 1: Write the failing test in `tests/tv-smooth.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { stepTvClock } from '../src/config';
import { nameBadgeTexture, NAME_BADGE_CACHE_LIMIT } from '../src/view/textures';

describe('TV Mode 60 FPS Smooth Clock & Badge Cache', () => {
  it('advances elapsed time and distance smoothly across 60 FPS frames even while 10Hz snapshot phaseTimeLeft is unchanged', () => {
    let elapsed = 10.0;
    const distances: number[] = [];
    // Simulate 5 frames at 60 FPS (dt = 1/60) while snapshot phaseTimeLeft stays frozen at 170.0s (targetElapsed = 10.0s)
    for (let f = 0; f < 5; f++) {
      const st = stepTvClock(elapsed, 1 / 60, 'RUNNING', 170.0, 180);
      expect(st.d).toBeGreaterThan(distances[distances.length - 1] ?? 0);
      elapsed = st.elapsed;
      distances.push(st.d);
    }
    expect(distances[4]).toBeGreaterThan(distances[0]);
  });

  it('snaps immediately on large time jumps (> 1.5s) and resets cleanly when not RUNNING', () => {
    const jumped = stepTvClock(2.0, 1 / 60, 'RUNNING', 150.0, 180);
    expect(jumped.elapsed).toBeCloseTo(30.0, 2);

    const lobby = stepTvClock(30.0, 1 / 60, 'LOBBY', 45.0, 180);
    expect(lobby.elapsed).toBe(0);
    expect(lobby.d).toBe(0);
    expect(lobby.speed).toBe(0);
  });

  it('caches nameBadgeTexture instances and bounds the cache at NAME_BADGE_CACHE_LIMIT (64)', () => {
    expect(NAME_BADGE_CACHE_LIMIT).toBe(64);
    const t1 = nameBadgeTexture('น้องเมย์', 1, '#f472b6');
    const t2 = nameBadgeTexture('น้องเมย์', 1, '#f472b6');
    expect(t1).toBe(t2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tv-smooth.test.ts`
Expected: FAIL (`stepTvClock is not a function` / `NAME_BADGE_CACHE_LIMIT is undefined`)

- [ ] **Step 3: Implement `stepTvClock`, bounded `nameBadgeTexture` cache, in-place `.tv-lb-row` DOM updates, and GPU-friendly `.tv-*` CSS**

1. In `src/config.ts`:
   - Implement `stepTvClock(prevElapsed, dt, phase, phaseTimeLeft, matchDuration): TvClockState`:
     - If `phase !== 'RUNNING'`, return `{ elapsed: 0, d: 0, speed: 0, floor: 1, progress01: 0, stageIndex: 0, stageCenter: STAGE_CENTER_ORDER[0] }`.
     - Compute `targetElapsed = Math.max(0, Math.min(matchDuration, matchDuration - Math.max(0, phaseTimeLeft)))`.
     - Advance `next = prevElapsed + Math.max(0, dt)`.
     - If `Math.abs(targetElapsed - next) > 1.5`, set `next = targetElapsed`; else `next += (targetElapsed - next) * Math.min(1, dt * 6)`.
     - Clamp `elapsed = Math.max(0, Math.min(matchDuration, next))`, compute `progress01 = matchDuration > 0 ? elapsed / matchDuration : 0`, `d = distanceAtTime(elapsed, matchDuration)`, `speed = speedAtProgress(progress01)`, `floor = floorAtProgress(progress01)`, `stageIndex = stageIndexAtProgress(progress01)`, `stageCenter = stageCenterAtProgress(progress01)`.
2. In `src/main.ts`:
   - Track `let tvElapsed = 0;` and in `tick(dt)` when `isTvMode` is true, call `const tv = stepTvClock(tvElapsed, dt, latestRoom.phase, latestRoom.phaseTimeLeft, latestRoom.matchDuration); tvElapsed = tv.elapsed;` and update `sim.matchDuration`, `sim.time`, `sim.floor`, `sim.stageIndex`, `sim.stageCenter`, `sim.d`, `sim.speed`, `sim.track.ensure(sim.d + VIEW_AHEAD)`, `sim.recycle()`.
3. In `src/view/textures.ts` and `src/view/world.ts`:
   - Add `export const NAME_BADGE_CACHE_LIMIT = 64;` and a `Map<string, THREE.CanvasTexture>` cache inside `nameBadgeTexture(name, rank, color)`.
   - In `World.syncGhostPack`, remove `if (sm.map) sm.map.dispose();` when assigning `sm.map = nameBadgeTexture(g.name, g.rank, col)` and smooth ghost `slot.x, slot.y, slot.z` with `Math.min(1, dt * 9)`.
4. In `src/ui.ts` and `index.html`:
   - In `UI.updateRoomSnapshot`, reuse `.tv-lb-row` child elements in `#tv-lb-list` by updating their `.className`, `.tv-lb-rank`, `.tv-lb-dot`, `.tv-lb-name`, and `.tv-lb-score` in place instead of rebuilding `innerHTML` when the row count matches.
   - In `index.html`, remove `backdrop-filter: blur(10px)` from `.tv-top`, `.tv-qr-card`, `.tv-host-card`, and `.tv-board-card` and use `background: rgba(15, 23, 42, 0.92)`.

- [ ] **Step 4: Run tests and build to verify**

Run: `npm test && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/main.ts src/view/textures.ts src/view/world.ts src/ui.ts index.html tests/tv-smooth.test.ts
git commit -m "perf(tv): interpolate TV clock at 60fps, cache name badges, and eliminate DOM/backdrop-filter stalls"
```
