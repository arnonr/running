# TV Mode Bot-Only Smooth 60 FPS & Smart Bot Reflexes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate frame stuttering, camera shake jitter, and abrupt bot position jumps in TV Live Arena (`?mode=tv`) when running with bots only, while reducing per-frame CPU/GPU overhead.

**Architecture:** Preserve millisecond precision on `phaseTimeLeft` in `MatchRoomCore.getSnapshot` and use rate-modulated monotonic drift correction in `stepTvClock` so track speed never oscillates at 10 Hz. Add a deterministic `Sim.botEvadeActionAt` lookahead helper consumed by `World.syncGhostPack` so TV bots smoothly steer around trains, jump low/hurdle barriers, and roll under overhead barriers without shaking the TV camera. Share procedural materials across all 11 `createCenterAttachments` rigs, cache animated scene-graph nodes to eliminate per-frame `.traverse()` calls, and skip hidden mobile HUD updates in TV mode.

**Tech Stack:** TypeScript, Three.js, HTML5 Canvas, Vitest

**Spec:** `docs/superpowers/specs/2026-10-29-tv-bot-smooth-performance-design.md`

## Global Constraints

- `MatchRoomCore.getSnapshot` must preserve millisecond precision on `phaseTimeLeft` (`.toFixed(3)`) while keeping `RoomSnapshot` wire-compatible.
- `stepTvClock` must advance `elapsed` and `d` monotonically without 10 Hz velocity spikes (`Δelapsed / dt` clamped within `[0.8, 1.2]` unless snapping when `Math.abs(drift) > 1.5`).
- Bots (`g.isBot`) must never trigger `this.shake` on the TV camera in `World.syncGhostPack`.
- `createCenterAttachments` must reuse shared procedural `THREE.Material` / `THREE.CanvasTexture` instances across calls so creating 11 attachment rigs does not allocate duplicate textures.
- `updateCenterAttachments` and `updateAvatarMotion` must use cached node arrays (`userData.animNodes` / `userData.motionNodes`) instead of per-frame `.traverse()`.

## Review Focus

- Rate-modulated TV clock stability: when `phaseTimeLeft` steps by `0.1s` after being held constant for 6 frames at 60 FPS, the per-frame step `Δd` in `stepTvClock` must remain within `±20%` of nominal frame distance instead of spiking by `>40%`.
- Bot obstacle evasion on TV: when a bot approaches a `train`/`mtrain`, `low`/`hurdle`, or `overhead` barrier within lookahead distance, `sim.botEvadeActionAt` must pick an open lane, jump, or slide so `sim.ghostObstacleHitAt` returns `null`.
- Zero camera shake from bots: even if all 3 lanes are blocked or a bot is forced through an obstacle in `World.syncGhostPack`, `world.shake` must remain `0` when `g.isBot` is true.
- Shared texture memory across ghost slots: calling `createCenterAttachments()` twice must share identical `map` texture references on corresponding meshes.
- Cached animation node updates: calling `updateCenterAttachments` and `updateAvatarMotion` must animate rotor/afterburner/ponytail/skirt transforms via cached node lists without scene-graph traversal regressions.

---

### Task 1: Monotonic High-Precision TV Clock, Smooth Bot Trajectories & Smart Bot Obstacle Reflexes

**Files:**
- Modify: `src/config.ts:296-335`
- Modify: `src/net.ts:386-416`
- Modify: `src/net.ts:513-549`
- Modify: `src/sim/sim.ts:592-620`
- Modify: `src/view/world.ts:1624-1900`
- Test: `tests/tv-smooth.test.ts`

**Interfaces:**
- Produces:
  - `src/config.ts`:
    - `export function stepTvClock(prevElapsed: number, dt: number, phase: string, phaseTimeLeft: number, matchDuration: number): TvClockState`
  - `src/sim/sim.ts`:
    - `export interface BotEvadeAction { targetLane: number; jump: boolean; slide: boolean }`
    - `Sim.prototype.botEvadeActionAt(lane: number, d: number, y: number, supportY: number, activeCenter: CenterId | null): BotEvadeAction`

- [ ] **Step 1: Write the failing tests in `tests/tv-smooth.test.ts`**

Add tests to `tests/tv-smooth.test.ts` verifying:
1. `stepTvClock` keeps per-frame `Δelapsed` within `[0.8 * dt, 1.2 * dt]` when `phaseTimeLeft` steps at 10 Hz (`0.1s` intervals) and `MatchRoomCore.getSnapshot()` exports millisecond-precision `phaseTimeLeft` and smooth non-square-wave bot `y`.
2. `sim.botEvadeActionAt` steers bots around blocking trains to a safe lane (or a lane with a ramp), triggers `jump: true` ahead of `low`/`hurdle` barriers, and triggers `slide: true` ahead of `overhead` barriers.

```ts
  it('keeps per-frame TV velocity smooth within ±20% across 10Hz snapshot steps and exports high-precision phaseTimeLeft', () => {
    const dt = 1 / 60;
    let elapsed = 10.0;
    for (let f = 0; f < 6; f++) {
      const st = stepTvClock(elapsed, dt, 'RUNNING', 170.0, 180);
      const step = st.elapsed - elapsed;
      expect(step).toBeGreaterThanOrEqual(dt * 0.79);
      expect(step).toBeLessThanOrEqual(dt * 1.21);
      elapsed = st.elapsed;
    }
    // Snapshot now steps by 0.1s to 169.9s
    const afterStep = stepTvClock(elapsed, dt, 'RUNNING', 169.9, 180);
    const stepAfter = afterStep.elapsed - elapsed;
    expect(stepAfter).toBeGreaterThanOrEqual(dt * 0.79);
    expect(stepAfter).toBeLessThanOrEqual(dt * 1.21);

    const room = new MatchRoomCore('1');
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    room.tick(0.033);
    const snap = room.getSnapshot();
    expect(snap.phaseTimeLeft).toBeCloseTo(180 - 0.033, 2);
  });

  it('computes smart bot obstacle evasion (lane steer for trains, jump for low/hurdle, slide for overhead)', () => {
    const sim = new Sim(202610);
    sim.noSpawn = true;
    sim.reset(202610, false, 180);

    // Train blocking lane 1 at d = 100..114 -> bot at d = 90 in lane 1 steers to lane 0 or 2
    sim.addOb({ kind: 'train', lane: 1, d0: 100, d1: 114, cars: 2 });
    const evTrain = sim.botEvadeActionAt(1, 90, 0, 0, null);
    expect(evTrain.targetLane).not.toBe(1);

    // Low barrier in lane 0 at d = 140 -> bot at d = 134 in lane 0 jumps
    sim.addOb({ kind: 'low', lane: 0, d0: 140, d1: 140 + OB.low.depth });
    const evLow = sim.botEvadeActionAt(0, 134, 0, 0, null);
    expect(evLow.jump).toBe(true);

    // Overhead barrier in lane 2 at d = 170 -> bot at d = 164 in lane 2 slides
    sim.addOb({ kind: 'overhead', lane: 2, d0: 170, d1: 170 + OB.overhead.depth });
    const evOver = sim.botEvadeActionAt(2, 164, 0, 0, null);
    expect(evOver.slide).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tv-smooth.test.ts`
Expected: FAIL (`sim.botEvadeActionAt is not a function` and `stepAfter` / `snap.phaseTimeLeft` precision mismatch)

- [ ] **Step 3: Implement `stepTvClock` rate modulation, high-precision `MatchRoomCore` bot curves, `Sim.botEvadeActionAt`, and `World.syncGhostPack` bot reflexes**

1. In `src/config.ts`:
   - Update `stepTvClock(prevElapsed, dt, phase, phaseTimeLeft, matchDuration)`:
     - Compute `targetElapsed = Math.max(0, Math.min(matchDuration, matchDuration - Math.max(0, phaseTimeLeft)))`.
     - Compute `safeDt = Math.max(0, dt)` and `drift = targetElapsed - (prevElapsed + safeDt)`.
     - If `Math.abs(drift) > 1.5`, snap `next = targetElapsed`; otherwise modulate step velocity smoothly: `const rate = Math.max(0.8, Math.min(1.2, 1 + drift * 2.0)); next = Math.max(prevElapsed, prevElapsed + safeDt * rate);`.
2. In `src/net.ts`:
   - In `MatchRoomCore.tick()`, stagger bot lane changes (`Math.floor((elapsed + idx * 1.15) / 3.4)`) and replace the square-wave jump (`Math.sin(elapsed * 3 + idx) > 0.85 ? 1.5 : 0`) with a smooth sine arch (`const jumpWave = Math.sin(elapsed * 2.8 + idx * 1.3); r.y = jumpWave > 0.72 ? +(((jumpWave - 0.72) / 0.28) * 1.55).toFixed(2) : 0;`).
   - In `MatchRoomCore.getSnapshot()`, export `phaseTimeLeft: +Math.max(0, this.phaseTimeLeft).toFixed(3)` and `referenceDistance: +this.referenceDistance.toFixed(2)`.
3. In `src/sim/sim.ts`:
   - Add `botEvadeActionAt(lane: number, d: number, y: number, supportY: number, activeCenter: CenterId | null): { targetLane: number; jump: boolean; slide: boolean }`:
     - If `activeCenter === 1 || activeCenter === 9`, return `{ targetLane: lane, jump: false, slide: false }`.
     - Scan `this.obs` in `[d - 1, d + 18]`:
       - If an obstacle in `lane` is a `train` or `mtrain` not reachable by roof (`Math.max(y, supportY) < o.yt - PLAYER.stepUp * 1.6`) and has no leading `ramp` in `lane`, pick the closest lane in `[0, 1, 2]` that has no blocking `train`/`mtrain` in `[d - 2, d + 20]` (or has a leading `ramp`).
       - If an obstacle in `targetLane` within `[d - 0.5, d + 9.5]` is `low` or `hurdle`, set `jump = true`.
       - If an obstacle in `targetLane` within `[d - 0.5, d + 9.5]` is `overhead`, set `slide = true`.
4. In `src/view/world.ts`:
   - In `World.syncGhostPack`:
     - For bots (`g.isBot`) when `isRunning`, call `sim.botEvadeActionAt(g.lane, slotD, slot.y, slot.supportY, g.activeCenter)` to override the bot's visual lane, trigger a smooth jump arc (`targetY = Math.max(targetY, slot.supportY + 1.55)`), or trigger `effectiveSliding = true`.
     - Replace slot-order `sameLaneCount` lateral snapping with deterministic per-runner offset when sharing a lane, and smooth `targetZ` with continuous `packOffsetZ` (`kz = Math.min(1, dt * 5.5)`).
     - Guard all `this.shake = ...` assignments in `syncGhostPack` with `if (!g.isBot)` so bots never shake the TV camera.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tv-smooth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/net.ts src/sim/sim.ts src/view/world.ts tests/tv-smooth.test.ts
git commit -m "perf(tv): stabilize 60fps TV clock and add smart bot obstacle reflexes without camera shake"
```

---

### Task 2: Shared Attachment Materials, Cached Animation Nodes & TV-Mode DOM Skip

**Files:**
- Modify: `src/view/player.ts:246-278`
- Modify: `src/view/player.ts:866-922`
- Modify: `src/view/avatars.ts:326-340`
- Modify: `src/view/avatars.ts:686-705`
- Modify: `src/main.ts:591-617`
- Test: `tests/tv-smooth.test.ts`

**Interfaces:**
- Consumes: `createCenterAttachments`, `updateCenterAttachments` (`src/view/player.ts`), `applyAvatarToCharacter`, `updateAvatarMotion` (`src/view/avatars.ts`)
- Produces:
  - `createCenterAttachments()` groups with pre-indexed `grp.userData.animNodes` and shared module-scoped `THREE.Material` instances
  - `applyAvatarToCharacter()` character roots with pre-indexed `characterRoot.userData.motionNodes`

- [ ] **Step 1: Write the failing test in `tests/tv-smooth.test.ts`**

Add a test in `tests/tv-smooth.test.ts` asserting that two separate `createCenterAttachments()` calls share the exact same material/texture instances and pre-populate `userData.animNodes`:

```ts
  it('shares procedural materials/textures across createCenterAttachments instances and caches animated nodes', () => {
    const a1 = createCenterAttachments();
    const a2 = createCenterAttachments();

    // Find first Mesh with a texture map in Center #1 and Center #9
    const findMappedMat = (grp: any) => {
      let mat: any = null;
      grp.traverse((o: any) => {
        if (!mat && o.isMesh && o.material?.map) mat = o.material;
      });
      return mat;
    };

    const m1 = findMappedMat(a1[1]);
    const m2 = findMappedMat(a2[1]);
    expect(m1).toBeDefined();
    expect(m1).toBe(m2);
    expect(m1.map).toBe(m2.map);

    expect(Array.isArray(a1[1].userData.animNodes)).toBe(true);
    expect(a1[1].userData.animNodes.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tv-smooth.test.ts`
Expected: FAIL (`expect(m1).toBe(m2)` fails because `createCenterAttachments` allocates new materials and textures on every call, and `a1[1].userData.animNodes` is `undefined`)

- [ ] **Step 3: Implement shared attachment materials, cached `animNodes` / `motionNodes`, and TV-mode mobile HUD skip**

1. In `src/view/player.ts`:
   - Extract a lazy singleton `getSharedAttachmentMaterials()` that creates the procedural `MeshPhongMaterial` and `MeshBasicMaterial` instances once and reuses them across all calls to `createCenterAttachments()`.
   - At the end of `createCenterAttachments()`, traverse each of the 9 groups once to collect all child objects having `isAfterburner`, `isRotor`, `droneSide`, `spinZ`, `spinY`, `orbitGroup`, `magnetSide`, `isFluxArc`, or `isMedDrone` in `userData` into `grp.userData.animNodes`.
   - In `updateCenterAttachments()`, iterate `const nodes = grp.userData.animNodes as THREE.Object3D[]` instead of calling `grp.traverse(...)` every frame.
2. In `src/view/avatars.ts`:
   - At the end of `attachBoneCostumes(characterRoot, avatarId)`, traverse `characterRoot` once to collect nodes with `userData.isPonytailPivot` or `userData.isSkirtGroup` into `characterRoot.userData.motionNodes`.
   - In `updateAvatarMotion(characterRoot, time, isRunning)`, iterate `characterRoot.userData.motionNodes` (falling back to `.traverse` only if undefined) instead of traversing the full skeleton every frame.
3. In `src/main.ts`:
   - In `tick(dt)`, wrap `world.player.setProfileBadge(...)` and `ui.hud(...)` inside `if (!isTvMode) { ... }` so TV mode never updates hidden mobile HUD DOM elements every frame.

- [ ] **Step 4: Run full test suite and production build**

Run: `npm test && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/view/player.ts src/view/avatars.ts src/main.ts tests/tv-smooth.test.ts
git commit -m "perf(view): share attachment textures, cache animation nodes, and skip mobile HUD in TV mode"
```
