# 9-Center Open-Horizon Biomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the 3-minute run into a 9-stage Open-Horizon tour across all 9 SUTO TechnoPark Innovation Centers, with a dynamic shader sky dome, horizon sun/ringed planet, Center Portal Gates, and 9 animated 3D Center landmark worlds.

**Architecture:** `src/config.ts` and `src/sim/sim.ts` map `progress01` (`0..1`) deterministically across `STAGE_CENTER_ORDER = [1, 4, 5, 3, 2, 6, 7, 8, 9]`, aligning scheduled Center power-up pickups with each 20-second stage and emitting `centerStageChange` events. `src/view/textures.ts` and `src/view/world.ts` replace the static sky and dark boxy side towers with a `THREE.ShaderMaterial` sky dome, interpolated `CENTER_BIOMES` palettes, stage-boundary Portal Gates, and 9 distinct animated `Instanced` 3D landmark & kinetic prop pools.

**Tech Stack:** TypeScript, Three.js (`r160`), HTML5 2D Canvas procedural textures, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-nine-center-biomes-design.md`

## Global Constraints

- Match duration defaults to `180` seconds divided into 9 equal sequential Center stages (`20s` each at `180s` duration, scaled proportionally for `90s` / `120s` host durations) in order `STAGE_CENTER_ORDER = [1, 4, 5, 3, 2, 6, 7, 8, 9]`.
- Zero camera-clipping walls: all side 3D landmarks sit on an open horizon (`|x| >= 5.8`) with no solid boxy building slabs blocking the camera when flying at `y = 4.2m`.
- Maintain 60 FPS by using `THREE.ShaderMaterial` uniform updates for the sky dome and `Instanced` mesh pools for all 9 Center worlds (no per-frame `CanvasTexture` allocation).
- Deterministic progression from `progress01` so mobile players and the `?mode=tv` arena screen always see the exact same Center biome simultaneously.

## Review Focus

1. **Out-of-range or `NaN` `progress01` in `stageIndexAtProgress` / `stageCenterAtProgress` / `lerpCenterBiome`:** Negative, `> 1`, or `NaN` inputs must clamp safely to valid stage index `0..8` and valid hex strings without throwing `TypeError`.
2. **Non-default match durations (`90s` or `120s` from TV Host controls):** Stage transitions (`centerStageChange`) and scheduled Center pickups must scale with `matchDuration` so all 9 Center stages and their corresponding pickups still occur within a `90s` or `120s` match.
3. **Portal Gate placement at `d = 0` vs stage boundaries:** Stage 1 (`#1`) gate must sit ahead of the starting line (`d = 28m`) so the player runs through it right after launch, while Stages 2..9 gates sit at `distanceAtTime(stageIdx * (matchDuration / 9), matchDuration)`.
4. **Active power-up vs current stage biome separation:** Picking up a Center capsule highlights the curb/particle accents with `CENTERS[activeCenter].color`, while the sky dome, ground, and 3D world remain anchored to `sim.stageCenter` so the world never flickers or desyncs from the stage tour.
5. **TV Mode (`?mode=tv`) `stageCenter` synchronization:** In `src/main.ts`, when `isTvMode` is true, `sim.stageCenter` must update from `stageCenterAtProgress(sim.progress01)` so the TV display transitions through all 9 Center worlds alongside the runners.

---

### Task 1: 9-Center Stage Progression, Pickup Schedule Alignment & Sim Events

**Files:**
- Modify: `src/sim/types.ts`
- Modify: `src/config.ts`
- Modify: `src/sim/sim.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/sim.test.ts`

**Interfaces:**
- Produces in `src/config.ts`:
  - `STAGE_CENTER_ORDER: readonly CenterId[]` (`[1, 4, 5, 3, 2, 6, 7, 8, 9]`)
  - `stageIndexAtProgress(progress01: number): number` (returns integer `0..8`)
  - `stageCenterAtProgress(progress01: number): CenterId`
  - `stageGateDistances(matchDuration?: number): Array<{ stageIndex: number; centerId: CenterId; d: number }>`
- Produces in `src/sim/types.ts`:
  - `SimEvent` union member: `| { type: 'centerStageChange'; centerId: CenterId; stageIndex: number; floor: number }`
- Produces in `src/sim/sim.ts`:
  - `sim.stageIndex: number` (`0..8`)
  - `sim.stageCenter: CenterId`

- [ ] **Step 1: Write failing tests in `tests/config.test.ts` and `tests/sim.test.ts`**

Add tests in `tests/config.test.ts` verifying:
- `STAGE_CENTER_ORDER` has length 9 with all unique `CenterId`s `[1, 4, 5, 3, 2, 6, 7, 8, 9]`.
- `stageIndexAtProgress(p)` and `stageCenterAtProgress(p)` handle `p = -0.5`, `0`, `0.5`, `1.0`, `1.5`, and `NaN`, visiting all 9 centers in exact `STAGE_CENTER_ORDER`.
- Each center's `spawnTimes[0]` falls inside its own 20-second stage window `[stageIdx * 20, (stageIdx + 1) * 20]`.
- `stageGateDistances(180)` returns 9 gates in strictly increasing distance order starting at `d = 28`.

Add a test in `tests/sim.test.ts` verifying:
- Advancing `Sim` across `90s` (custom duration) transitions `sim.stageCenter` through all 9 centers in `STAGE_CENTER_ORDER` and emits `centerStageChange` events.

- [ ] **Step 2: Run Vitest to confirm tests fail**

Run: `npx vitest run tests/config.test.ts tests/sim.test.ts`
Expected: FAIL (`STAGE_CENTER_ORDER` / `stageCenterAtProgress` not exported).

- [ ] **Step 3: Implement stage progression helpers in `src/config.ts`, event type in `src/sim/types.ts`, and tracking in `src/sim/sim.ts`**

- In `src/sim/types.ts`, add `| { type: 'centerStageChange'; centerId: CenterId; stageIndex: number; floor: number }` to `SimEvent`.
- In `src/config.ts`:
  - Export `STAGE_CENTER_ORDER: readonly CenterId[] = [1, 4, 5, 3, 2, 6, 7, 8, 9]`.
  - Implement `stageIndexAtProgress(progress01: number): number` (guarding `Number.isFinite(progress01)` and clamping to `0..8`) and `stageCenterAtProgress(progress01: number): CenterId`.
  - Implement `stageGateDistances(matchDuration = DEFAULT_MATCH_DURATION)` returning `{ stageIndex, centerId, d }` where `stageIndex === 0` uses `d = 28` and `stageIndex > 0` uses `distanceAtTime((stageIndex / 9) * matchDuration, matchDuration)`.
  - Update `floorAtProgress(progress01)` so floors align cleanly with the 9 stages (`stage 0..3 -> Floor 1`, `stage 4 -> Floors 2..6`, `stage 5..6 -> Floor 8`, `stage 7 -> Floor 9`, `stage 8 -> Floor 10`).
  - Update `CENTERS[id].spawnTimes` so each center's primary pickup spawns inside its own 20s stage window (`#1: [6, 95]`, `#4: [25, 115]`, `#5: [45, 135]`, `#3: [65, 150]`, `#2: [85, 34]`, `#6: [105, 54]`, `#7: [125, 74]`, `#8: [145, 15]`, `#9: [164, 173]`).
- In `src/sim/sim.ts`:
  - Add `stageIndex = 0` and `stageCenter: CenterId = 1` to `Sim` (and `SimSnapshot`), reset them in `reset()`, and update them in `step(dt)` from `this.progress01`, pushing `{ type: 'centerStageChange', centerId: this.stageCenter, stageIndex: this.stageIndex, floor: this.floor }` whenever `nextStageIndex !== this.stageIndex`.

- [ ] **Step 4: Run Vitest to confirm tests pass**

Run: `npx vitest run tests/config.test.ts tests/sim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/sim/types.ts src/config.ts src/sim/sim.ts tests/config.test.ts tests/sim.test.ts
git commit -m "feat(sim,config): add 9-center sequential stage progression and gate distances"
```

---

### Task 2: 9-Center Open-Horizon Biomes, Dynamic Sky Dome & Animated 3D Worlds

**Files:**
- Modify: `src/view/textures.ts`
- Modify: `src/view/world.ts`
- Modify: `src/main.ts`
- Modify: `tests/view-data.test.ts`

**Interfaces:**
- Consumes from Task 1: `STAGE_CENTER_ORDER`, `stageIndexAtProgress`, `stageCenterAtProgress`, `stageGateDistances`, `sim.stageCenter`, `sim.stageIndex`, `centerStageChange` event.
- Produces in `src/view/textures.ts`:
  - `CenterBiomePalette` interface & `CENTER_BIOMES: Record<CenterId, CenterBiomePalette>`
  - `lerpCenterBiome(progress01: number): CenterBiomePalette`
  - `centerGateBannerTexture(centerId: CenterId, stageNumber: number): THREE.CanvasTexture`

- [ ] **Step 1: Write failing tests in `tests/view-data.test.ts`**

Add tests in `tests/view-data.test.ts` verifying:
- `CENTER_BIOMES` defines all 9 centers (`1..9`) with distinct `skyTopHex`, `skyMidHex`, `skyHorizonHex`, `groundTintHex`, `trackTintHex`, and `neonHex`.
- `lerpCenterBiome(p)` smoothly interpolates across all 9 stages in `STAGE_CENTER_ORDER` and handles out-of-range / `NaN` values (`-1`, `0`, `0.5`, `1`, `2`, `NaN`) returning valid `#rrggbb` colors.

- [ ] **Step 2: Run Vitest to verify failure**

Run: `npx vitest run tests/view-data.test.ts`
Expected: FAIL (`CENTER_BIOMES` / `lerpCenterBiome` not defined).

- [ ] **Step 3: Implement `CENTER_BIOMES`, `lerpCenterBiome`, and `centerGateBannerTexture` in `src/view/textures.ts`**

- Define `CenterBiomePalette` and `CENTER_BIOMES` for all 9 Centers with distinct atmospheric palettes (Azure Runway `#1`, Emerald Solar Valley `#4`, Cyber 5G Matrix `#5`, Golden Hyperloop `#3`, Industrial Amber Robotics `#2`, Teal Cloud Radar `#6`, Bioluminescent DNA Lab `#7`, Clean Rose-White Med-Tech `#8`, Deep Cosmic Nebula `#9`).
- Implement `lerpCenterBiome(progress01: number): CenterBiomePalette` that guards non-finite inputs, finds the active stage `0..8` from `STAGE_CENTER_ORDER`, and smoothly blends into the next stage during the final 18% of each stage.
- Implement `centerGateBannerTexture(centerId: CenterId, stageNumber: number)` rendering a wide glowing overhead portal sign (`STAGE X/9 · ศูนย์ที่ #ID: <shortTh> · <exhibitionFloorTh>`).

- [ ] **Step 4: Implement Open-Horizon Sky Dome, Horizon Sun/Planet, Center Portal Gates, and 9 Animated 3D Center Worlds in `src/view/world.ts` and wire HUD/events in `src/main.ts`**

- In `src/view/world.ts`:
  - Remove `labTowers` (`buildTechnoTowers`) so there are zero boxy walls blocking the horizon.
  - Add a procedural `SkyDome` (`THREE.SphereGeometry(230, 32, 20)` with `THREE.BackSide` and a custom `THREE.ShaderMaterial`) driven by `uSkyTop`, `uSkyMid`, `uSkyHorizon`, `uStarIntensity`, and `uTime`, plus a horizon Sun/Planet group at `z = -195` (glowing disc + tilted planetary ring that scales up in `#6` and `#9`).
  - Store material references for the outer ground plane (`groundMat`), sidewalk (`paveMat`), and track (`trackMat`) so their tint colors smoothly interpolate to `biome.groundTintHex` and `biome.trackTintHex` every frame.
  - Build `centerGates: Record<CenterId, Instanced>` spanning the 3 lanes (`width = 9.2m`, `height = 8.8m`) with glowing twin pillars and the overhead `centerGateBannerTexture(id, stageIdx + 1)`, placed at `stageGateDistances(sim.matchDuration)`.
  - Build 9 distinct Center Scenery pools (`centerSceneryStatic: Record<CenterId, Instanced>` and `centerSceneryKinetic: Record<CenterId, Instanced>`) where the kinetic part animates every frame (spinning wind turbine blades for `#4`, rotating radar dishes for `#6`, pivoting robot arms for `#2`, rotating DNA double-helix for `#7`, spinning 3D medical cross for `#8`, flying jet squadrons overhead for `#1`, expanding 5G signal rings for `#5`, pulsing hyperloop chevrons for `#3`, and orbiting satellites around rockets for `#9`).
- In `src/main.ts`:
  - Update TV mode (`isTvMode`) to also sync `sim.stageIndex = stageIndexAtProgress(sim.progress01)` and `sim.stageCenter = stageCenterAtProgress(sim.progress01)`.
  - Handle `centerStageChange` in `handleSimEvent` by playing `audio.level()` and showing a toast `🌟 ด่านที่ ${ev.stageIndex + 1}/9: เข้าสู่ ${CENTERS[ev.centerId].icon} ศูนย์ที่ #${ev.centerId} ${CENTERS[ev.centerId].shortTh}!`.
  - Pass `${CENTERS[sim.stageCenter].icon} ด่าน ${sim.stageIndex + 1}/9: ${CENTERS[sim.stageCenter].shortTh}` as `zoneNameTh` to `ui.hud(...)`.

- [ ] **Step 5: Run all tests and production build, then commit**

Run: `npm test && npm run build`
Expected: All 6 test suites pass and `tsc --noEmit && vite build` succeeds with zero errors.

```bash
git add src/view/textures.ts src/view/world.ts src/main.ts tests/view-data.test.ts docs/superpowers/plans/2026-10-27-nine-center-biomes.md
git commit -m "feat(view): add 9-center open-horizon biomes, dynamic sky dome, portal gates, and animated 3D worlds"
```
