# TV Mode Multiplayer 60 FPS Smooth Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate TV mode (`?mode=tv`) frame stuttering and track hitching when ~6 human players and Admin-controlled bots (up to 10 total runners) race simultaneously on a notebook connected to an external TV/monitor.

**Architecture:** Always drive TV mode's track distance (`sim.d`) and velocity (`sim.speed`) from `stepTvClock` instead of slaving to `leadHuman.d`, and throttle TV DOM leaderboard updates during `RUNNING` to 10 Hz (`0.10s`) inside `tick(dt)` instead of synchronously rebuilding DOM on every 80 Hz WebSocket snapshot. Decouple 3D runner nameplate textures from temporary power-up colors (`activeCenter`) with a 256-entry non-disposing cache, smooth ghost pack `targetZ`/`targetX` transitions, cap TV mode WebGL `pixelRatio` at `1.25` with `1024` shadow maps and disabled ghost `SkinnedMesh` shadow casting, eliminate per-frame `THREE.Color` allocations and nested obstacle loops, and replace the final-sprint `box-shadow` animation with a GPU-composited `opacity` pseudo-element.

**Tech Stack:** TypeScript, Three.js, HTML5 Canvas / CSS, Vitest

**Spec:** `docs/superpowers/specs/2026-11-06-tv-multiplayer-smooth-60fps-design.md`

## Global Constraints

- In TV mode (`isTvMode === true`) during `RUNNING`, `sim.d` and `sim.speed` must always be driven by `stepTvClock` (`tv.d` and `tv.speed`) so track movement is strictly monotonic at 60 FPS regardless of human rank swaps, stumbles, or network jitter.
- Admin bot controls (`add_bot`, `remove_bot`, `clear_bots`) must remain fully functional alongside human players up to the 10-runner pack limit.
- Phase transitions (`LOBBY`, `COUNTDOWN`, `RUNNING`, `PODIUM`) and `TvBroadcastTracker` audio/banner events must still be processed immediately on snapshot arrival; only `ui.updateRoomSnapshot` during steady-state `RUNNING` in TV mode is throttled to `0.10s` (10 Hz).
- `NAME_BADGE_CACHE_LIMIT` must be `256`, and 3D nameplate badges in `World.syncGhostPack` must key on the runner's stable profile color (`g.color`) while `slot.ring` continues to reflect `activeCenter` colors.
- In TV mode, renderer `pixelRatio` must be capped at `1.25` (`computeRendererPixelRatio`), `shadowSize` must be `1024`, and all 10 ghost `charClone` meshes must have `castShadow = false` and `receiveShadow = false`.

## Review Focus

- Human lead overtake with lower distance `d`: when Player B (at `d = 210m`, higher score from capsules) overtakes Player A (at `d = 225m`) for Rank #1, TV track distance `sim.d` must continue advancing monotonically at `tv.speed * dt` without freezing or snapping backward.
- Runtime TV mode toggle (`toggleTvMode`): switching between normal mode and TV mode at runtime must immediately recalculate `renderer.setPixelRatio(computeRendererPixelRatio(...))` and flush any pending `latestRoom` snapshot to `ui.updateRoomSnapshot`.
- Phase change during throttled `RUNNING` window: when the room transitions from `RUNNING` to `PODIUM` (or `LOBBY`) less than `0.10s` after the previous DOM update, `shouldFlushTvSnapshotUi` must return `true` immediately so the podium screen is never delayed.
- 10-runner rank permutation badge cache stability: when 10 runners (6 humans + 4 bots) cycle through all 10 ranks (`1..10`) while activating all 9 Center power-ups, total unique `nameBadgeTexture` keys for the match must stay `<= 100` (well within `NAME_BADGE_CACHE_LIMIT = 256`) with zero texture cache evictions.
- Multi-ramp and multi-train support parity: replacing the nested `this.obs.some(...)` ramp check in `Sim.ghostSupportAt` and `Sim.botEvadeActionAt` must still recognize a leading ramp within `1.5m` of a train's `d0` and keep ghost runners at `OB.train.yt` (`2.65m`) along the entire train roof.

---

### Task 1: Monotonic TV Track Clock, TV PixelRatio Helper & Throttled TV Snapshot Scheduler

**Files:**
- Modify: `src/config.ts:296-347`
- Modify: `src/main.ts:20-23`
- Modify: `src/main.ts:68-89`
- Modify: `src/main.ts:122-126`
- Modify: `src/main.ts:389-406`
- Modify: `src/main.ts:481-515`
- Modify: `src/main.ts:950-992`
- Test: `tests/tv-smooth.test.ts`

**Interfaces:**
- Produces in `src/config.ts`:
  - `export function computeRendererPixelRatio(devicePixelRatio: number, mobile: boolean, tvMode: boolean): number`
  - `export function shouldFlushTvSnapshotUi(prevPhase: string, nextPhase: string, elapsedSinceLastFlushSec: number, minIntervalSec?: number): boolean`
  - `export function computeTvSimStep(tv: TvClockState): { d: number; speed: number }`

- [ ] **Step 1: Write the failing tests in `tests/tv-smooth.test.ts`**

Add a test block to `tests/tv-smooth.test.ts` asserting:
1. `computeRendererPixelRatio(dpr, mobile, tvMode)` caps `tvMode = true` at `1.25` (e.g. `dpr = 2` -> `1.25`, `dpr = 1` -> `1`), `mobile = true, tvMode = false` at `1.5`, and desktop `mobile = false, tvMode = false` at `2.0`.
2. `shouldFlushTvSnapshotUi(prevPhase, nextPhase, elapsedSec, 0.1)` returns `true` when `prevPhase !== nextPhase`, returns `true` when `nextPhase !== 'RUNNING'`, returns `false` when `prevPhase === 'RUNNING' && nextPhase === 'RUNNING' && elapsedSec < 0.1`, and returns `true` when `elapsedSec >= 0.1`.
3. `computeTvSimStep(tv)` always returns `{ d: tv.d, speed: tv.speed }` monotonically across 60 FPS frames even when human runners in `MatchRoomCore` swap Rank #1 with a lower track distance `d` or stumble.

```ts
  it('caps TV mode pixelRatio at 1.25, throttles RUNNING TV DOM flushes to 10Hz, and keeps TV track distance monotonic when humans swap #1', async () => {
    const {
      computeRendererPixelRatio,
      shouldFlushTvSnapshotUi,
      computeTvSimStep,
      stepTvClock,
    } = await import('../src/config');

    expect(computeRendererPixelRatio(2.5, false, true)).toBe(1.25);
    expect(computeRendererPixelRatio(1.0, false, true)).toBe(1.0);
    expect(computeRendererPixelRatio(3.0, true, false)).toBe(1.5);
    expect(computeRendererPixelRatio(2.5, false, false)).toBe(2.0);

    expect(shouldFlushTvSnapshotUi('COUNTDOWN', 'RUNNING', 0.01, 0.1)).toBe(true);
    expect(shouldFlushTvSnapshotUi('RUNNING', 'PODIUM', 0.02, 0.1)).toBe(true);
    expect(shouldFlushTvSnapshotUi('LOBBY', 'LOBBY', 0.01, 0.1)).toBe(true);
    expect(shouldFlushTvSnapshotUi('RUNNING', 'RUNNING', 0.04, 0.1)).toBe(false);
    expect(shouldFlushTvSnapshotUi('RUNNING', 'RUNNING', 0.1, 0.1)).toBe(true);

    let elapsed = 25.0;
    let prevD = stepTvClock(elapsed, 0, 'RUNNING', 155.0, 180).d;
    // Simulate human rank overtake where new #1 has higher score but 18m lower distance d
    for (let f = 0; f < 10; f++) {
      const tv = stepTvClock(elapsed, 1 / 60, 'RUNNING', 155.0 - f * 0.016, 180);
      elapsed = tv.elapsed;
      const step = computeTvSimStep(tv);
      expect(step.d).toBeGreaterThan(prevD);
      expect(step.speed).toBeCloseTo(tv.speed, 5);
      prevD = step.d;
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tv-smooth.test.ts`
Expected: FAIL (`computeRendererPixelRatio is not a function`)

- [ ] **Step 3: Implement `computeRendererPixelRatio`, `shouldFlushTvSnapshotUi`, and `computeTvSimStep` in `src/config.ts` and wire them in `src/main.ts`**

1. In `src/config.ts`:
   - Export `computeRendererPixelRatio(devicePixelRatio: number, mobile: boolean, tvMode: boolean): number`:
     - Clamp `dpr = Math.max(1, devicePixelRatio || 1)`.
     - If `tvMode`, return `Math.min(dpr, 1.25)`.
     - If `mobile`, return `Math.min(dpr, 1.5)`.
     - Return `Math.min(dpr, 2.0)`.
   - Export `shouldFlushTvSnapshotUi(prevPhase: string, nextPhase: string, elapsedSinceLastFlushSec: number, minIntervalSec = 0.1): boolean`:
     - If `prevPhase !== nextPhase || nextPhase !== 'RUNNING'`, return `true`.
     - Return `elapsedSinceLastFlushSec >= minIntervalSec`.
   - Export `computeTvSimStep(tv: TvClockState): { d: number; speed: number }`:
     - Return `{ d: tv.d, speed: tv.speed }`.
2. In `src/main.ts`:
   - Import `computeRendererPixelRatio`, `shouldFlushTvSnapshotUi`, `computeTvSimStep` from `./config`.
   - Set initial `renderer.setPixelRatio(computeRendererPixelRatio(window.devicePixelRatio || 1, mobile, isTvMode))` and initialize `new World(core, { shadowSize: mobile || isTvMode ? 1024 : 2048 })`.
   - Add state variables `let tvUiSnapshotDirty = false;` and `let tvUiSnapshotTimer = 0;`.
   - In `toggleTvMode`: update `renderer.setPixelRatio(computeRendererPixelRatio(window.devicePixelRatio || 1, mobile, isTvMode))`, call `resize()`, and flush `ui.updateRoomSnapshot(latestRoom, savedProfile.id)` with `tvUiSnapshotDirty = false; tvUiSnapshotTimer = 0;`.
   - In `net.onSnapshot`: when `isTvMode` is true, if `shouldFlushTvSnapshotUi(prevPhase, snap.phase, tvUiSnapshotTimer)` is true, call `ui.updateRoomSnapshot(snap, savedProfile.id)` and reset `tvUiSnapshotDirty = false; tvUiSnapshotTimer = 0;`; otherwise set `tvUiSnapshotDirty = true;`. When `!isTvMode`, call `ui.updateRoomSnapshot(snap, savedProfile.id)` as before.
   - In `tick(dt)` under `if (isTvMode)`:
     - Advance `tvUiSnapshotTimer += dt;` and if `tvUiSnapshotDirty && shouldFlushTvSnapshotUi('RUNNING', latestRoom.phase, tvUiSnapshotTimer, 0.1)`, call `ui.updateRoomSnapshot(latestRoom, savedProfile.id)` and reset `tvUiSnapshotDirty = false; tvUiSnapshotTimer = 0;`.
     - Inside `if (latestRoom.phase === 'RUNNING')`, replace the `leadHuman` distance-slaving block with `const tvStep = computeTvSimStep(tv); sim.d = tvStep.d; sim.speed = tvStep.speed;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tv-smooth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/main.ts tests/tv-smooth.test.ts
git commit -m "perf(tv): lock TV track to monotonic stepTvClock, cap TV pixelRatio at 1.25, and throttle TV DOM updates to 10Hz"
```

---

### Task 2: Zero-Churn Nameplate Cache, Smooth Ghost Pack Positioning, Disabled Ghost Shadows & Fast Loops

**Files:**
- Modify: `src/view/textures.ts:608-661`
- Modify: `src/view/world.ts:1205-1246`
- Modify: `src/view/world.ts:1435-1525`
- Modify: `src/view/world.ts:1864-1884`
- Modify: `src/view/world.ts:2066-2086`
- Modify: `src/view/fx.ts:52-95`
- Modify: `src/sim/sim.ts:597-690`
- Modify: `src/sim/sim.ts:978-995`
- Modify: `index.html:512-529`
- Test: `tests/tv-smooth.test.ts`

**Interfaces:**
- Produces in `src/view/textures.ts`:
  - `export const NAME_BADGE_CACHE_LIMIT = 256;`
- Produces in `src/view/world.ts`:
  - `export interface GhostPackTargetInput { slotIndex: number; lane: number; runnerX: number; isBot: boolean; rank: number; anchorRank: number; isAnchor: boolean; packOffsetZ: number; sameLaneCount: number }`
  - `export function computeGhostPackTargetTransform(input: GhostPackTargetInput): { targetX: number; targetZ: number }`

- [ ] **Step 1: Write the failing tests in `tests/tv-smooth.test.ts`**

Update the existing `NAME_BADGE_CACHE_LIMIT` assertion in `tests/tv-smooth.test.ts` from `64` to `256` and add a new test verifying:
1. `NAME_BADGE_CACHE_LIMIT` is `256` and 10 runners cycling across all 10 ranks (`1..10`) retain 100% cache hits without eviction.
2. `computeGhostPackTargetTransform` uses gentler rank spacing (`0.65m` per rank step instead of `1.45m`) combined with `packOffsetZ * 0.38`, clamped to `[-11.0, -1.2]`, and deterministic slot-based lateral spread (`((slotIndex % 3) - 1) * 0.16`).

```ts
  it('retains all 100 badge textures for 10 runners across ranks 1..10 without eviction and computes smooth ghost pack targets', async () => {
    const { computeGhostPackTargetTransform } = await import('../src/view/world');
    expect(NAME_BADGE_CACHE_LIMIT).toBe(256);

    const colors = [
      '#38bdf8', '#f472b6', '#4ade80', '#facc15', '#fb923c',
      '#a855f7', '#2dd4bf', '#f87171', '#60a5fa', '#e879f9',
    ];
    const firstPass: any[] = [];
    for (let r = 0; r < 10; r++) {
      for (let rank = 1; rank <= 10; rank++) {
        firstPass.push(nameBadgeTexture(`Player-${r}`, rank, colors[r]));
      }
    }
    let idx = 0;
    for (let r = 0; r < 10; r++) {
      for (let rank = 1; rank <= 10; rank++) {
        expect(nameBadgeTexture(`Player-${r}`, rank, colors[r])).toBe(firstPass[idx++]);
      }
    }

    const rank1 = computeGhostPackTargetTransform({
      slotIndex: 0,
      lane: 1,
      runnerX: 0,
      isBot: false,
      rank: 1,
      anchorRank: 5,
      isAnchor: false,
      packOffsetZ: 2.0,
      sameLaneCount: 0,
    });
    const rank2 = computeGhostPackTargetTransform({
      slotIndex: 1,
      lane: 1,
      runnerX: 0,
      isBot: false,
      rank: 2,
      anchorRank: 5,
      isAnchor: false,
      packOffsetZ: 2.0,
      sameLaneCount: 1,
    });
    // Adjacent rank step is 0.65m (instead of 1.45m) so rank swaps glide smoothly
    expect(Math.abs(rank2.targetZ - rank1.targetZ)).toBeCloseTo(0.65, 2);
    expect(rank1.targetX).toBeCloseTo(0, 3);
    expect(rank2.targetX).toBeCloseTo(0, 3);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tv-smooth.test.ts`
Expected: FAIL (`expected 64 to be 256` and `computeGhostPackTargetTransform is not a function`)

- [ ] **Step 3: Implement badge cache expansion, `computeGhostPackTargetTransform`, ghost shadow disable, scratch colors, fast obstacle/coin loops, and GPU-composited sprint pulse**

1. In `src/view/textures.ts`:
   - Change `export const NAME_BADGE_CACHE_LIMIT = 256;`.
   - In `nameBadgeTexture`, when evicting `oldestKey` from `nameBadgeCache`, delete it from the Map without calling `oldTex.dispose()`.
2. In `src/view/world.ts`:
   - Export `GhostPackTargetInput` and `computeGhostPackTargetTransform(input: GhostPackTargetInput): { targetX: number; targetZ: number }`:
     - `const spreadX = input.sameLaneCount === 0 ? 0 : ((input.slotIndex % 3) - 1) * 0.16;`
     - `const baseX = !input.isBot && Math.abs((input.runnerX ?? laneX(input.lane)) - laneX(input.lane)) > 0.02 ? input.runnerX : laneX(input.lane);`
     - `const targetX = baseX + spreadX;`
     - `const rankZ = TV_ANCHOR_Z + (input.rank - input.anchorRank) * 0.65;`
     - `const packShift = input.isAnchor ? 0 : input.packOffsetZ * 0.38;`
     - `const targetZ = Math.max(-11.0, Math.min(-1.2, rankZ - packShift));`
     - Return `{ targetX, targetZ }`.
   - In `World.buildGhostPackPool`: traverse `charClone` and set `castShadow = false` and `receiveShadow = false` on every mesh child.
   - In `World.syncGhostPack`:
     - Call `computeGhostPackTargetTransform` to compute `targetX` and `targetZ`, and interpolate with `kx = Math.min(1, dt * 10)` and `kz = Math.min(1, dt * 4.2)`.
     - Use stable profile color `g.color` for the nameplate badge (`const badgeKey = `${g.rank}:${g.name}:${g.color}`;` and `nameBadgeTexture(g.name, g.rank, g.color)`), while keeping `slot.ring` colored by `col = g.activeCenter ? CENTERS[g.activeCenter].color : g.color`.
   - In `World.sync`: replace per-frame `new THREE.Color(0xffffff)`, `new THREE.Color(1.0, 0.78, 0.25).multiplyScalar(0.6)`, `LIGHT.clone().multiplyScalar(...)`, and `LIGHT_RED.clone().multiplyScalar(...)` with module-level preallocated `THREE.Color` constants/scratch objects (`WHITE_COLOR`, `COIN_GOLD_HALO`, `scratchHaloColor`).
3. In `src/view/fx.ts`:
   - Add module-level `const burstScratchColor = new THREE.Color();` and `const updateScratchColor = new THREE.Color();`.
   - Use `burstScratchColor.set(color)` in `FX.burst` and `updateScratchColor.copy(p.color).multiplyScalar(Math.min(1, k * 1.6))` in `FX.update`.
4. In `src/sim/sim.ts`:
   - In `Sim.ghostSupportAt`: replace the nested `this.obs.some(...)` inside the obstacle loop with a single helper lookup that only checks obstacles within `Math.abs(r.d1 - o.d0) < 1.5` without closure allocation.
   - In `Sim.collectGhostPickupsAt`: update the early skip in the coin loop to `if (ahead > magnetRange + 2 || (ahead < -2 && !c.pulled)) continue;`.
5. In `index.html`:
   - Replace `@keyframes sprintPulse` on `.tv-layer.final-sprint` with a `::after` pseudo-element on `.tv-layer.final-sprint` that holds a static `box-shadow: inset 0 0 52px rgba(244, 63, 94, 0.5)` and animates only `opacity` (`0.45` <-> `1`, `will-change: opacity`).

- [ ] **Step 4: Run full test suite and production build to verify everything passes**

Run: `npm test && npm run build`
Expected: PASS (all test suites green and `tsc --noEmit && vite build` succeeds with zero errors)

- [ ] **Step 5: Commit**

```bash
git add src/view/textures.ts src/view/world.ts src/view/fx.ts src/sim/sim.ts index.html tests/tv-smooth.test.ts
git commit -m "perf(tv): eliminate badge texture churn, smooth ghost Z/X targets, disable ghost shadows, and remove per-frame allocations"
```
