# TV Mode Multiplayer 60 FPS Smooth Performance Design (6+ Human Players & Bots on External TV)

**Date:** 2026-11-06  
**Status:** Draft (Awaiting User Approval)  
**Scope:** Medium — spans the TV frame clock & snapshot scheduler in [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts), ghost pack positioning & GPU shadow setup in [`src/view/world.ts`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts), 3D nameplate texture caching in [`src/view/textures.ts`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts), ghost pickup/obstacle collision helpers in [`src/sim/sim.ts`](file:///Users/macbook-arnon/Projects/running/src/sim/sim.ts), particle color reuse in [`src/view/fx.ts`](file:///Users/macbook-arnon/Projects/running/src/view/fx.ts), and CSS compositing in [`index.html`](file:///Users/macbook-arnon/Projects/running/index.html).

---

## 1. Context & Problem Statement

In booth/event setups, TV mode (`?mode=tv`) is displayed from a **notebook connected to an external TV/monitor** while ~6 human players run simultaneously on their phones alongside Admin-controlled bots (up to 10 total active runners in [`MatchRoomCore`](file:///Users/macbook-arnon/Projects/running/src/net.ts#L502)). While mobile clients run smoothly at 60 FPS, the TV screen stutters during multiplayer races due to five compounding bottlenecks:

1. **Non-Monotonic TV Track Distance (`leadHuman.d` Slaving):**
   - In [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts#L967-L984), when no humans are in the room (`leadHuman === undefined`), `sim.d` and `sim.speed` are driven purely by [`stepTvClock`](file:///Users/macbook-arnon/Projects/running/src/config.ts#L306-L347), which advances monotonically at 60 FPS.
   - As soon as human players join, [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts#L967-L980) overrides `tv.d` with `leadHuman = latestRoom.activeRunners.find(r => !r.isBot && !r.eliminated)`. Because `activeRunners` is sorted by **score** (`r.score`), whenever a player with higher coin/capsule bonus but lower track distance `d` overtakes #1—or when #1 stumbles or mobile snapshots arrive with network jitter—`diffD = leadHuman.d - nextD` becomes negative.
   - `sim.d = Math.max(sim.d, nextD + diffD * Math.min(1, dt * 10))` clamps `sim.d` to its previous value (`0 m/s` track movement), visibly freezing the entire 3D track until `leadHuman.d` catches up, or snapping `sim.d = leadHuman.d` across `25m+` when `Math.abs(diffD) > 25`.

2. **Unthrottled WebSocket Snapshot DOM Thrashing (up to ~80 Hz):**
   - With 6 human players publishing state at 20 Hz + urgent action events + the server's 30 Hz bot tick, [`broadcastSnapshotThrottled`](file:///Users/macbook-arnon/Projects/running/server/index.ts#L170-L182) (`minIntervalMs = 12`) sends up to ~80 snapshots/sec.
   - [`net.onSnapshot`](file:///Users/macbook-arnon/Projects/running/src/main.ts#L481-L485) synchronously calls [`ui.updateRoomSnapshot`](file:///Users/macbook-arnon/Projects/running/src/ui.ts#L1057-L1221) on every packet outside `requestAnimationFrame`, rebuilding leaderboard HTML/styles up to 80 times/sec on the main thread.

3. **Mid-Race 2D Canvas Redraws & GPU Texture Uploads for Nameplates:**
   - In [`World.syncGhostPack`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts#L2079-L2085), each runner's 3D badge key is `${g.rank}:${g.name}:${col}` where `col` switches to `CENTERS[g.activeCenter].color` on every capsule pickup and `g.rank` swaps constantly among 10 runners.
   - With [`NAME_BADGE_CACHE_LIMIT = 64`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts#L609), rank and power-up changes evict entries and trigger `document.createElement('canvas')`, `ctx.fillText`, `new THREE.CanvasTexture`, and `oldTex.dispose()` mid-frame.

4. **Ghost Pack Position Snapping & Redundant Per-Frame Collision/Color Loops:**
   - In [`World.syncGhostPack`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts#L1866-L1878), `rankZ = TV_ANCHOR_Z + (g.rank - anchorRank) * 1.45` jumps by `±1.45m` whenever two close runners swap rank, and `spreadX` depends on `sameLaneCount` in slot order so runners shift sideways when another runner changes lanes.
   - [`Sim.ghostSupportAt`](file:///Users/macbook-arnon/Projects/running/src/sim/sim.ts#L597-L620) runs a nested `this.obs.some(...)` inside its obstacle loop (`O(obs²)` per ghost), [`Sim.collectGhostPickupsAt`](file:///Users/macbook-arnon/Projects/running/src/sim/sim.ts#L670-L704) scans all ~300 coins for each of the 10 ghosts every frame, and [`World.sync`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts#L1436-L1522) / [`FX.burst`](file:///Users/macbook-arnon/Projects/running/src/view/fx.ts#L53-L90) allocate temporary `THREE.Color` instances every frame.

5. **Notebook + External TV GPU Fill-Rate & Skinned Shadow Overhead:**
   - On a notebook (`mobile = false`), [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts#L68-L88) sets `pixelRatio = Math.min(devicePixelRatio, 2)` and `shadowSize = 2048`. Driving an external 1080p/4K TV with HiDPI scaling taxes notebook integrated/hybrid GPUs.
   - All 10 ghost `SkinnedMesh` clones inherit `castShadow = true` from `this.player.model`, forcing the GPU to skin 10 × 65-bone characters twice per frame (shadow map pass + main camera pass) even though every ghost already renders a glowing ground ring (`slot.ring`).
   - During the last 30 seconds, `.tv-layer.final-sprint` in [`index.html`](file:///Users/macbook-arnon/Projects/running/index.html#L512-L529) animates a full-screen `box-shadow: inset 0 0 58px ...` at 60 Hz, triggering main-thread paint overhead.

---

## 2. Architecture & Component Design

### 2.1 Monotonic 60 FPS TV Track Clock (`src/main.ts` & `src/config.ts`)
- **Design:** In TV mode (`isTvMode === true`) during `latestRoom.phase === 'RUNNING'`, always drive `sim.d` and `sim.speed` directly from [`stepTvClock`](file:///Users/macbook-arnon/Projects/running/src/config.ts#L306-L347):
  - `sim.d = tv.d`
  - `sim.speed = tv.speed`
- **Why:** [`stepTvClock`](file:///Users/macbook-arnon/Projects/running/src/config.ts#L306-L347) already integrates the exact analytical speed curve [`tvSpeedAtElapsed`](file:///Users/macbook-arnon/Projects/running/src/config.ts#L287-L290) at 60 FPS with gentle 2% drift correction (`diff * Math.min(1, dt * 2.0)`) against `phaseTimeLeft`. Removing the `leadHuman.d` override guarantees the TV camera, track chunks, obstacles, coins, and 9-Center scenery move forward monotonically at a locked 60 FPS regardless of how many humans are playing, who is in 1st place, or mobile network jitter.
- **Pure Helper:** Extract a pure helper `computeTvSimStep(tv: TvClockState)` (or directly assign `sim.d = tv.d; sim.speed = tv.speed`) so unit tests can verify that TV track distance never stalls or jumps backward when `activeRunners` swap lead or stumble.

### 2.2 Smooth Ghost Pack Z/X Positioning (`src/view/world.ts`)
- **Design:**
  1. **Continuous Z Target (`targetZ`):** In [`World.syncGhostPack`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts#L1875-L1878), reduce the discrete rank step from `1.45m` to `0.65m` and blend it with the continuous server-computed `g.packOffsetZ` (`packShift = g.packOffsetZ * 0.38`), clamped to `[-11.0, -1.2]`, and smooth `slot.z` with a critically damped exponential factor (`kz = Math.min(1, dt * 4.2)` instead of `5.5`) so rank swaps glide smoothly over ~0.4s instead of snapping.
  2. **Deterministic Lateral Spread (`spreadX`):** When multiple runners share the same lane (`sameLaneCount > 0`), compute `spreadX` from a deterministic slot index `(i % 3 - 1) * 0.16` blended smoothly via `kx = Math.min(1, dt * 10)` so a runner in lane 1 does not abruptly jump sideways when another runner leaves lane 1.

### 2.3 Throttled TV Snapshot UI Updates (`src/main.ts`)
- **Design:**
  - When `net.onSnapshot(snap)` fires in TV mode:
    - Immediately process phase transitions (`LOBBY`, `COUNTDOWN`, `RUNNING`, `PODIUM`) and broadcast event detection (`tvTracker.update`, audio cues) so sound effects and phase changes have zero latency.
    - If `prevPhase !== snap.phase` or `snap.phase !== 'RUNNING'`, call `ui.updateRoomSnapshot(snap, savedProfile.id)` immediately.
    - During `RUNNING` in TV mode, mark `tvUiSnapshotDirty = true` instead of rebuilding the DOM on every 12ms WebSocket packet.
  - Inside `tick(dt)` in [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts), flush `ui.updateRoomSnapshot(latestRoom, savedProfile.id)` when `tvUiSnapshotDirty` is true and at least `0.10s` (10 Hz) has elapsed since the last TV DOM update.
- **Why:** Cuts main-thread DOM work during 6-player races from ~80 updates/sec down to a predictable 10 updates/sec synchronized with `requestAnimationFrame`.

### 2.4 Zero-Churn 3D Nameplate Badges (`src/view/textures.ts` & `src/view/world.ts`)
- **Design:**
  - In [`World.syncGhostPack`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts#L2066-L2085), keep the ground aura ring (`slot.ring`) dynamically colored by `col = g.activeCenter ? CENTERS[g.activeCenter].color : g.color`, but pass the runner's **stable profile color (`g.color`)** to `nameBadgeTexture(g.name, g.rank, g.color)`.
  - Increase `NAME_BADGE_CACHE_LIMIT` in [`src/view/textures.ts`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts#L609) from `64` to `256` and do **not** call `oldTex.dispose()` on cache eviction while sprites may still reference the texture (with 10 runners × 10 ranks × 1 stable color per runner = at most 100 unique badges per match, all 100 fit permanently in the 256-entry cache with zero mid-race evictions).

### 2.5 Notebook External-TV GPU & CPU Optimizations (`src/main.ts`, `src/view/world.ts`, `src/sim/sim.ts`, `src/view/fx.ts`, `index.html`)
- **TV Renderer PixelRatio & Shadow Map (`src/main.ts`, `src/view/world.ts`):**
  - Helper `computeRendererPixelRatio(devicePixelRatio: number, mobile: boolean, tvMode: boolean): number`:
    - When `tvMode` is true, cap `pixelRatio` at `1.25` (e.g. on a 2x Retina/4K external display, renders at 1.25x instead of 2.0x—cutting fragment shader invocations by **61%** while keeping crisp anti-aliased edges on TV).
    - Update `renderer.setPixelRatio(...)` and `resize()` whenever `toggleTvMode` is called at runtime.
  - When `isTvMode || mobile`, initialize `World` with `shadowSize: 1024` (instead of `2048`).
  - In [`World.buildGhostPackPool`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts#L1209-L1211), traverse `charClone` to set `castShadow = false` and `receiveShadow = false` on ghost meshes. Each ghost already has a brightground ring (`slot.ring`) directly beneath its feet, so disabling 10 × 65-bone shadow-map skinning passes saves ~10 skinned draw calls and thousands of vertex bone transforms every frame.
- **Fast Ghost Collision & Pickup Loops (`src/sim/sim.ts`):**
  - In [`Sim.ghostSupportAt`](file:///Users/macbook-arnon/Projects/running/src/sim/sim.ts#L597-L620), remove the O(obs²) nested `this.obs.some(...)` ramp check and replace it with a single pass over nearby obstacles (`Math.abs(o.d0 - d) <= 45`) that detects whether a ramp is in the same lane within `[o.d0 - 30, o.d0 + 4]`.
  - In [`Sim.collectGhostPickupsAt`](file:///Users/macbook-arnon/Projects/running/src/sim/sim.ts#L670-L704), add an early distance window check (`if (c.d < d - magnetR || c.d > d + magnetR) continue`) before computing `dx`, `dy`, and `dz`, and skip the coin loop entirely when a ghost is simply rendering on a non-TV client.
- **Zero Per-Frame Color Allocations (`src/view/world.ts` & `src/view/fx.ts`):**
  - Reuse module-level scratch `THREE.Color` instances (`_scratchColorA`, `_scratchColorB`, `_fxBaseColor`, `_fxJitterColor`) instead of calling `new THREE.Color(...)` and `base.clone()` inside [`World.sync`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts#L1436-L1522) and [`FX.burst`](file:///Users/macbook-arnon/Projects/running/src/view/fx.ts#L53-L90).
- **GPU-Composited Final Sprint Border (`index.html`):**
  - Replace `@keyframes tvSprintPulse` (which animates `box-shadow` every frame on `.tv-layer.final-sprint`) with a static `box-shadow` on `.tv-layer.final-sprint::after` that animates only `opacity` (`will-change: opacity`), keeping the exact same red pulse visual with zero main-thread repaint cost.

---

## 3. Data Flow & Error Handling

1. **Snapshot Arrival (`NetClient` -> `main.ts`):**
   - `latestRoom` is updated immediately on every WebSocket/HTTP/BroadcastChannel message.
   - Phase changes (`LOBBY` -> `COUNTDOWN` -> `RUNNING` -> `PODIUM`) and `TvBroadcastTracker` events execute immediately.
   - Leaderboard/status DOM updates during `RUNNING` in TV mode are coalesced via `tvUiSnapshotDirty` and flushed at most every `100ms` inside `tick(dt)`.
2. **60 FPS Frame Loop (`tick(dt)` in `main.ts` -> `World.sync`):**
   - `stepTvClock` computes `tv.elapsed`, `tv.d`, `tv.speed`, `tv.floor`, `tv.stageIndex`, `tv.stageCenter`.
   - `sim.d = tv.d` and `sim.speed = tv.speed` advance monotonically.
   - `world.sync` positions all active runners (`visibleGhosts`, up to 10 humans + bots) smoothly relative to `TV_ANCHOR_Z`.
3. **Fallback / Edge Cases:**
   - When switching between normal mode and TV mode via `toggleTvMode`, `renderer.setPixelRatio` is recalculated and `tvUiSnapshotDirty` is flushed immediately so UI state is never stale.
   - Admin bot controls (`add_bot`, `remove_bot`, `clear_bots`) continue to work identically in both `LOBBY` and `RUNNING` phases.

---

## 4. Verification & Testing Plan

- **Unit Tests (`src/__tests__/tvClock.test.ts` & `src/__tests__/uiState.test.ts`):**
  - Test `computeRendererPixelRatio` for mobile, desktop, and TV mode (verifying TV mode caps at `1.25`).
  - Test that TV mode track distance follows `stepTvClock` monotonically even when human runners swap #1 rank or have lower `d`.
  - Test `Sim.ghostSupportAt` single-pass ramp + elevated train roof support to ensure identical physics behavior with O(N) complexity.
  - Test `nameBadgeTexture` caching with 10 runners across rank changes to verify zero texture eviction under 256 entries.
- **Full Suite & Build Verification:**
  - Run `npm test` (Vitest) and `npm run build` (`tsc --noEmit && vite build`) to confirm zero regressions.
