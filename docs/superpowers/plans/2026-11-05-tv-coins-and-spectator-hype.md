# TV Coin Collection & Spectator Hype System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make coins and 9-Center capsules visually magnet-pull and burst when touched by runners on the TV Live Arena (`?mode=tv`) without affecting mobile players' tracks, while adding multi-moment spectator hype features (`#1` 3D leader crown, Live Broadcast Feed, Final 30s Sprint Fever, and Podium Top 3 spotlight with 3D fireworks).

**Architecture:** Add `Sim.collectGhostPickupsAt` and call it per active ghost slot in `World.syncGhostPack` when `tvMode` is enabled so coins/capsules on the TV's local `Sim` are collected at the exact rendered 3D position of each runner and spawn particle bursts. Attach a 3D rotating golden crown mesh to the `#1` ghost slot and render `👑 #1` on Rank-1 nameplates. Add a stateful `TvBroadcastTracker` in `src/ui.ts` that diffs consecutive `RoomSnapshot` updates on TV to drive a 3-slot `#tv-feed` ticker, `.final-sprint` 30s countdown effects, `#tv-podium-card` Top-3 overlay, 3D podium fireworks, and synthesized WebAudio stingers.

**Tech Stack:** TypeScript, Three.js, HTML5 Canvas, WebAudio API, Vitest

**Spec:** `docs/superpowers/specs/2026-11-05-tv-coins-and-spectator-hype-design.md`

## Global Constraints

- Must preserve existing `RoomSnapshot` wire compatibility across WebSocket (`server/index.ts`), HTTP `/api/sync`, and `BroadcastChannel` (`src/net.ts`).
- Coins and 9-Center capsules removed on the TV client (`isTvMode = true`) must never alter or remove coins/capsules on any mobile player's `Sim` instance.
- `#tv-feed` must display at most `3` concurrent event banners (`pointer-events: none`), auto-expiring after `3.4s` so the 3D track stays unobstructed.
- `lead` change alerts must only fire after `elapsed >= 3.0s` of `RUNNING` with a `2.5s` cooldown; bot `power` alerts must be throttled to `6.0s`.
- All existing and new Vitest unit tests must pass in a headless Node environment without WebGL or DOM errors.

## Review Focus

- Magnet coin pull range & bounds: when a TV ghost has `activeCenter === 5` (5G Magnet) vs `null`, `sim.collectGhostPickupsAt` pulls coins within `1.5 * MAGNET_RANGE` ahead of `d` without pulling coins beyond `1.5 * MAGNET_RANGE + 2` or behind `d - 2`.
- Airborne coin height filtering: a ground-level TV ghost (`y = 0`) running beneath a high train-roof coin (`y = 3.5`) must not collect that coin unless the ghost is elevated or has an active magnet Center.
- Baseline snapshot & early-start lead-change suppression: connecting mid-race or during the first `3.0s` of `RUNNING` must seed the current `#1` leader without firing a false overtake alert, and rank swaps within `2.5s` must be debounced.
- Last-heart guard under `maxLives <= 1` or simultaneous elimination: `TvBroadcastTracker` must never emit `last_heart` when `snap.maxLives <= 1` or when a runner is marked `eliminated: true` on the same snapshot.
- Round reset & phase transition cleanup: transitioning from `RUNNING` or `PODIUM` to `LOBBY` (or changing `matchId`) must clear `.final-sprint`, hide `#tv-podium-card`, and reset `TvBroadcastTracker` state for the next round.

---

### Task 1: TV Ghost Coin & 9-Center Capsule Collection + 3D Leader Crown

**Files:**
- Modify: `src/sim/sim.ts:919-965`
- Modify: `src/view/textures.ts:611-655`
- Modify: `src/view/world.ts:60-87`
- Modify: `src/view/world.ts:1153-1225`
- Modify: `src/view/world.ts:1700-1985`
- Test: `tests/tv-smooth.test.ts`

**Interfaces:**
- Produces:
  - `src/sim/sim.ts`:
    - `export interface GhostPickupResult { coins: number; centers: CenterId[] }`
    - `Sim.prototype.collectGhostPickupsAt(x: number, y: number, d: number, sliding: boolean, activeCenter: CenterId | null, dt: number): GhostPickupResult`
  - `src/view/world.ts`:
    - `export function createLeaderCrownMesh(): THREE.Group`
  - `src/view/textures.ts`:
    - `nameBadgeTexture(name: string, rank: number, color: string): THREE.CanvasTexture` (renders `👑 #1` prefix and gold accent when `rank === 1`)

- [ ] **Step 1: Write the failing tests in `tests/tv-smooth.test.ts`**

Add tests to `tests/tv-smooth.test.ts` verifying:
1. `sim.collectGhostPickupsAt` collects overlapping coins and 9-Center capsules on the TV `Sim` instance, respects vertical height bounds (ground runner at `y = 0` does not collect roof coin at `y = 3.5`), pulls nearby coins when `activeCenter` is a magnet (`1, 2, 5, 9`) without pulling coins beyond `1.5 * MAGNET_RANGE + 2`, and leaves a separate mobile `Sim` instance with the same seed untouched.
2. `createLeaderCrownMesh()` builds a 3D crown group with child meshes and `nameBadgeTexture` caches Rank-1 badges cleanly.

```ts
  it('collects coins and 9-Center capsules for TV ghost runners (including magnet pull and height bounds) without affecting mobile Sim', () => {
    const tvSim = new Sim(202610);
    const mobileSim = new Sim(202610);
    tvSim.noSpawn = true;
    mobileSim.noSpawn = true;
    tvSim.reset(202610, false, 180);
    mobileSim.reset(202610, false, 180);

    // Ground coin at lane 1, d = 50, y = 0.85; roof coin at lane 1, d = 50, y = 3.5; capsule at lane 1, d = 50.2
    tvSim.addCoin(1, 50, 0.85);
    tvSim.addCoin(1, 50, 3.5);
    tvSim.addCenterPickup(4, 1, 50.2, 1.15);

    mobileSim.addCoin(1, 50, 0.85);
    mobileSim.addCoin(1, 50, 3.5);
    mobileSim.addCenterPickup(4, 1, 50.2, 1.15);

    // Ground runner at (lane 1, y = 0, d = 50) collects ground coin + capsule #4, but NOT the roof coin (y = 3.5)
    const res1 = tvSim.collectGhostPickupsAt(laneX(1), 0, 50, false, null, 1 / 60);
    expect(res1.coins).toBe(1);
    expect(res1.centers).toEqual([4]);
    expect(tvSim.coinList).toHaveLength(1);
    expect(tvSim.coinList[0].y).toBeCloseTo(3.5, 2);
    expect(tvSim.pickups).toHaveLength(0);

    // Mobile Sim still has all 2 coins and 1 capsule untouched
    expect(mobileSim.coinList).toHaveLength(2);
    expect(mobileSim.pickups).toHaveLength(1);

    // Magnet pull: coin at lane 0, d = 62, y = 0.85; distant coin at d = 95
    tvSim.addCoin(0, 62, 0.85);
    tvSim.addCoin(0, 95, 0.85);
    // Runner at lane 1, d = 55 with Center #5 (1.5x magnet range) pulls the d=62 coin closer, leaves d=95 coin untouched
    tvSim.collectGhostPickupsAt(laneX(1), 0, 55, false, 5, 0.1);
    const pulledCoin = tvSim.coinList.find((c) => c.d < 62 && c.d > 54);
    const farCoin = tvSim.coinList.find((c) => c.d === 95);
    expect(pulledCoin?.pulled).toBe(true);
    expect(farCoin?.pulled).toBe(false);
  });

  it('builds a 3D leader crown mesh for Rank #1 on TV', async () => {
    const { createLeaderCrownMesh } = await import('../src/view/world');
    const crown = createLeaderCrownMesh();
    expect(crown.children.length).toBeGreaterThanOrEqual(4);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tv-smooth.test.ts`
Expected: FAIL (`tvSim.collectGhostPickupsAt is not a function` / `createLeaderCrownMesh is not a function`)

- [ ] **Step 3: Implement `Sim.collectGhostPickupsAt`, `createLeaderCrownMesh`, `World.syncGhostPack` TV pickup & crown visuals, and `nameBadgeTexture` `#1` crown styling**

1. In `src/sim/sim.ts`:
   - Export `interface GhostPickupResult { coins: number; centers: CenterId[] }`.
   - Implement `collectGhostPickupsAt(x: number, y: number, d: number, sliding: boolean, activeCenter: CenterId | null, dt: number): GhostPickupResult`:
     - Compute `h = sliding ? PLAYER.slideHeight : PLAYER.height`.
     - Compute `magnet = activeCenter === 1 || activeCenter === 2 || activeCenter === 5 || activeCenter === 9` and `magnetRange = (activeCenter === 5 || activeCenter === 9) ? MAGNET_RANGE * 1.5 : MAGNET_RANGE`.
     - Iterate `this.coinList` backward:
       - Let `ahead = c.d - d`. If `ahead > magnetRange + 2`, continue.
       - If `magnet && ahead < magnetRange && ahead > -2`, set `c.pulled = true`.
       - If `c.pulled`, interpolate `c.x += (x - c.x) * k`, `c.y += (y + 1 - c.y) * k`, `c.d += (d - c.d) * k` with `k = Math.min(1, dt * 15)`.
       - If `Math.abs(c.d - d) < 1.15 && Math.abs(c.x - x) < 1.15 && c.y > y - 0.7 && c.y < y + h + 0.8`, increment `coins`, push `c` to `this.freeCoins`, and splice `c` from `this.coinList`.
     - Iterate `this.pickups` backward:
       - Let `cx = laneX(cp.lane)` and `yMatch = activeCenter === 1 || Math.abs(cp.y - (y + h * 0.5)) < 2.5`.
       - If `Math.abs(cp.d - d) < PICKUP_PULL_RANGE * 0.65 && Math.abs(cx - x) < PICKUP_PULL_RANGE * 0.65 && yMatch`, push `cp.centerId` to `centers`, push `cp` to `this.freePickups`, and splice `cp` from `this.pickups`.
2. In `src/view/textures.ts`:
   - In `nameBadgeTexture(name, rank, color)`:
     - When `rank === 1`, draw border with `#facc15` (`lineWidth = 5`), render rank label as `👑 #1` in `#facc15`, and shift `shortName` X start to `92` (`maxWidth = W - 106`) so the crown and `#1` fit with clean spacing.
3. In `src/view/world.ts`:
   - Export `createLeaderCrownMesh(): THREE.Group` creating a golden crown (`CylinderGeometry` base band + 4 `ConeGeometry` crown spikes + glowing `TorusGeometry` halo ring) positioned at `y = 2.42`.
   - Add `crown: THREE.Group` to `GhostSlot` in `buildGhostPackPool` (initially `crown.visible = false`) and add it to `group`.
   - In `World.syncGhostPack`:
     - When `isRunning && g.eliminated`, set `slot.crown.visible = false`.
     - For active runners when `tvMode && isRunning && !g.eliminated`, call `const picked = sim.collectGhostPickupsAt(slot.x, slot.y, slotD, effectiveSliding, g.activeCenter, dt)`:
       - If `picked.coins > 0`, call `this.fx.burst(slot.x, slot.y + 0.85, slot.z, 5, 0xffd75a, { speed: 2.4, up: 1.5, size: 0.4, life: 0.35, grav: 3 })`.
       - For each `cid` of `picked.centers`, call `this.fx.burst(slot.x, slot.y + 1.0, slot.z, 22, CENTERS[cid].color, { speed: 4.8, up: 2.6, size: 0.55, life: 0.55, grav: 2 })`.
     - Update leader crown & ring on each visible ghost slot:
       - `const isLeader = isRunning && !g.eliminated && g.rank === 1;`
       - `slot.crown.visible = isLeader;`
       - If `isLeader`, set `slot.crown.rotation.y = this.time * 2.4`, `slot.crown.position.y = 2.42 + Math.sin(this.time * 4.5) * 0.08`, and `slot.ring.scale.setScalar(1.22 + Math.sin(this.time * 6) * 0.06)`; otherwise `slot.ring.scale.setScalar(1)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tv-smooth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sim/sim.ts src/view/textures.ts src/view/world.ts tests/tv-smooth.test.ts
git commit -m "feat(tv): collect track coins and capsules on TV ghosts and add 3D #1 leader crown"
```

---

### Task 2: TV Live Broadcast Feed, Final 30s Sprint Fever, Podium Top 3 Spotlight & Audio Cues

**Files:**
- Modify: `src/ui.ts:528-595`
- Modify: `src/ui.ts:927-1045`
- Modify: `src/audio.ts:116-127`
- Modify: `src/main.ts:477-666`
- Modify: `src/main.ts:915-1005`
- Modify: `src/view/world.ts:1463-1483`
- Modify: `index.html:443-510`
- Test: `tests/tv-smooth.test.ts`

**Interfaces:**
- Produces:
  - `src/ui.ts`:
    - `export type TvBroadcastEventKind = 'lead' | 'power' | 'last_heart' | 'eliminated'`
    - `export interface TvBroadcastEvent { id: string; kind: TvBroadcastEventKind; icon: string; titleTh: string; accentHex: string; centerId?: CenterId }`
    - `export class TvBroadcastTracker { update(snap: RoomSnapshot, nowSec?: number): TvBroadcastEvent[]; reset(): void }`
    - `UI.prototype.pushTvBroadcastEvents(events: TvBroadcastEvent[]): void`
  - `src/audio.ts`:
    - `Audio.prototype.leadChange(): void`
    - `Audio.prototype.lastHeart(): void`
    - `Audio.prototype.finalSprint(): void`

- [ ] **Step 1: Write the failing tests in `tests/tv-smooth.test.ts`**

Add tests to `tests/tv-smooth.test.ts` verifying:
1. `TvBroadcastTracker` suppresses lead-change events on the initial baseline snapshot and during the first `3.0s` of `RUNNING`, emits `lead` when a new runner overtakes `#1` after `3.0s`, debounces rapid lead changes within `2.5s`, emits `power` immediately for humans and throttles bot `power` alerts to `6.0s`, emits `last_heart` when a human runner drops from `> 1` to `1` life (`maxLives > 1`), never emits `last_heart` when `maxLives <= 1` or when simultaneously `eliminated`, and emits `eliminated` when a human runner dies.
2. `UI` in TV mode toggles `.final-sprint` on `#tv-layer` when `RUNNING` has `phaseTimeLeft <= 30`, shows `#tv-podium-card` with Top 3 finishers during `PODIUM`, and clears both when returning to `LOBBY`.

```ts
  it('diffs RoomSnapshots in TvBroadcastTracker for lead changes, power-ups, last heart, and eliminations with cooldown guards', async () => {
    const { TvBroadcastTracker } = await import('../src/ui');
    const tracker = new TvBroadcastTracker();

    const makeSnap = (
      phaseTimeLeft: number,
      runners: Array<Partial< any > & { id: string; name: string; rank: number }>,
      maxLives = 3,
      phase: 'LOBBY' | 'COUNTDOWN' | 'RUNNING' | 'PODIUM' = 'RUNNING',
    ): any => ({
      channel: '1',
      matchId: 1,
      phase,
      phaseTimeLeft,
      matchDuration: 180,
      maxLives,
      eliminatedIds: runners.filter((r) => r.eliminated).map((r) => r.id),
      lobbyHold: true,
      matchSeed: 202610,
      referenceDistance: 100,
      currentFloor: 2,
      activeRunners: runners.map((r) => ({
        role: 'senior',
        color: '#38bdf8',
        avatar: 'non',
        lane: 1,
        x: 0,
        y: 0,
        d: 100,
        score: 500,
        coins: 10,
        floor: 2,
        activeCenter: null,
        collectedCount: 0,
        packOffsetZ: 0,
        lives: maxLives,
        maxLives,
        eliminated: false,
        survivedSec: 10,
        ...r,
      })),
      top10: [],
      waitingQueue: [],
      allDayBest: [],
    });

    // 1. Baseline snapshot at elapsed = 1.0s (phaseTimeLeft = 179s): no false lead alert
    expect(
      tracker.update(
        makeSnap(179, [
          { id: 'p1', name: 'นนท์', rank: 1 },
          { id: 'p2', name: 'เมย์', rank: 2 },
        ]),
        1.0,
      ),
    ).toEqual([]);

    // 2. Overtake at elapsed = 2.0s (< 3.0s grace): still suppressed
    expect(
      tracker.update(
        makeSnap(178, [
          { id: 'p2', name: 'เมย์', rank: 1 },
          { id: 'p1', name: 'นนท์', rank: 2 },
        ]),
        2.0,
      ),
    ).toEqual([]);

    // 3. Overtake at elapsed = 5.0s (>= 3.0s): emits 'lead' for p1
    const evLead = tracker.update(
      makeSnap(175, [
        { id: 'p1', name: 'นนท์', rank: 1 },
        { id: 'p2', name: 'เมย์', rank: 2 },
      ]),
      5.0,
    );
    expect(evLead.map((e) => e.kind)).toEqual(['lead']);
    expect(evLead[0].titleTh).toContain('นนท์');

    // 4. Rapid swap back at 6.0s (within 2.5s cooldown): debounced
    expect(
      tracker.update(
        makeSnap(174, [
          { id: 'p2', name: 'เมย์', rank: 1 },
          { id: 'p1', name: 'นนท์', rank: 2 },
        ]),
        6.0,
      ),
    ).toEqual([]);

    // 5. Power-up + Last Heart at 9.0s
    const evMix = tracker.update(
      makeSnap(171, [
        { id: 'p2', name: 'เมย์', rank: 1, activeCenter: 1 },
        { id: 'p1', name: 'นนท์', rank: 2, lives: 1 },
      ]),
      9.0,
    );
    expect(evMix.map((e) => e.kind)).toEqual(['power', 'last_heart']);

    // 6. Elimination at 12.0s (lives drops to 0 and eliminated = true -> only 'eliminated', not 'last_heart')
    const evElim = tracker.update(
      makeSnap(168, [
        { id: 'p2', name: 'เมย์', rank: 1, activeCenter: 1 },
        { id: 'p1', name: 'นนท์', rank: 2, lives: 0, eliminated: true },
      ]),
      12.0,
    );
    expect(evElim.map((e) => e.kind)).toEqual(['eliminated']);

    // 7. Unlimited lives (maxLives = 0) never emits 'last_heart', and LOBBY transition resets tracker state
    expect(
      tracker.update(
        makeSnap(160, [{ id: 'p2', name: 'เมย์', rank: 1, lives: 1 }], 0),
        15.0,
      ),
    ).toEqual([]);
    expect(tracker.update(makeSnap(45, [], 3, 'LOBBY'), 20.0)).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tv-smooth.test.ts`
Expected: FAIL (`TvBroadcastTracker is not a constructor`)

- [ ] **Step 3: Implement `TvBroadcastTracker`, TV Live Feed, Final 30s Sprint, Podium Top 3 Card, 3D Podium Fireworks, and WebAudio Stingers**

1. In `src/audio.ts`:
   - Add `leadChange()`, `lastHeart()`, and `finalSprint()` synthesized WebAudio methods on `Audio`.
2. In `src/ui.ts` & `index.html`:
   - Export `TvBroadcastEventKind`, `TvBroadcastEvent`, and `TvBroadcastTracker`:
     - Track `matchId`, `leaderId`, `lastLeadAlertAt`, `lastBotPowerAt`, and per-runner `{ activeCenter, lives, eliminated }`.
     - Reset state whenever `snap.phase !== 'RUNNING'` or `snap.matchId !== this.matchId`.
     - During `RUNNING`, compute `elapsed = Math.max(0, snap.matchDuration - snap.phaseTimeLeft)`:
       - **Lead change (`'lead'`):** Find top non-eliminated runner (`rank === 1`). On the first `RUNNING` snapshot, record `this.leaderId` without emitting. On subsequent snapshots, if `elapsed >= 3.0` and `leader.id !== this.leaderId` and `nowSec - this.lastLeadAlertAt >= 2.5`, update `this.leaderId`, set `this.lastLeadAlertAt = nowSec`, and emit `{ kind: 'lead', icon: '👑', titleTh: `${leader.name} แซงขึ้นนำเป็นอันดับ #1!`, accentHex: '#facc15' }`.
       - **Power-up (`'power'`):** When `!r.eliminated && r.activeCenter !== null && prev && prev.activeCenter !== r.activeCenter`: if `!r.isBot` or `nowSec - this.lastBotPowerAt >= 6.0`, emit `{ kind: 'power', icon: CENTERS[r.activeCenter].icon, titleTh: `${r.name} เปิดพลัง #${r.activeCenter} ${CENTERS[r.activeCenter].shortTh}!`, accentHex: CENTERS[r.activeCenter].color, centerId: r.activeCenter }`.
       - **Last heart (`'last_heart'`):** When `!r.isBot && !r.eliminated && snap.maxLives > 1 && prev && (prev.lives ?? snap.maxLives) > 1 && r.lives === 1`, emit `{ kind: 'last_heart', icon: '💔', titleTh: `ลุ้นระทึก! ${r.name} เหลือ ❤️ ดวงสุดท้าย!`, accentHex: '#fb7185' }`.
       - **Eliminated (`'eliminated'`):** When `!r.isBot && r.eliminated && prev && !prev.eliminated`, emit `{ kind: 'eliminated', icon: '💥', titleTh: `${r.name} ชนครบกำหนด ตกรอบแล้ว!`, accentHex: '#f43f5e' }`.
   - In `UI.renderDOM` (`src/ui.ts`) and `index.html`:
     - Add `#tv-feed` and `#tv-sprint-banner` (`🔥 โค้งสุดท้าย 30 วินาทีเดือด! · เร่งสปีดสู่ชั้น 10!`) and `#tv-podium-card` (showing Top 3 finishers `🥇 #1`, `🥈 #2`, `🥉 #3` when `snap.phase === 'PODIUM'`) inside `#tv-layer`.
     - In `UI.updateRoomSnapshot`, toggle `.final-sprint` on `#tv-layer` when `snap.phase === 'RUNNING' && snap.phaseTimeLeft <= 30 && snap.phaseTimeLeft > 0`, and toggle `.on` on `#tv-podium-card` when `snap.phase === 'PODIUM'` (populating Top 3 cards from `snap.top10.slice(0, 3)`).
     - Add `pushTvBroadcastEvents(events: TvBroadcastEvent[])` on `UI` to render up to 3 auto-expiring `.tv-feed-item` banners in `#tv-feed`.
3. In `src/main.ts` & `src/view/world.ts`:
   - Instantiate `const tvTracker = new TvBroadcastTracker()` in `main.ts`.
   - In `net.onSnapshot`, when `isTvMode`:
     - Run `const tvEvents = tvTracker.update(snap, performance.now() / 1000)` and `ui.pushTvBroadcastEvents(tvEvents)`.
     - Play matching WebAudio stingers (`audio.leadChange()`, `audio.centerPower(ev.centerId)`, `audio.lastHeart()`, `audio.eliminated()`).
     - Start/stop background music on TV when entering/leaving `RUNNING`, and play `audio.finishFanfare()` on `PODIUM`.
     - Trigger `audio.finalSprint()` once per match when `snap.phase === 'RUNNING' && snap.phaseTimeLeft <= 30`, and trigger `audio.countdownBeep(false)` once per integer second for the final `5..1` seconds.
   - In `tick(dt)` (`src/main.ts`): boost `audio.tempo` by `+14` when `isTvMode && latestRoom.phase === 'RUNNING' && latestRoom.phaseTimeLeft <= 30`, and pass `latestRoom.phase === 'PODIUM'` to `world.sync` so `World.sync` launches periodic 3D firework bursts in the sky during `PODIUM` on TV.

- [ ] **Step 4: Run full test suite and production build**

Run: `npm test && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui.ts src/audio.ts src/main.ts src/view/world.ts index.html tests/tv-smooth.test.ts
git commit -m "feat(tv): add live broadcast feed, final 30s sprint fever, podium top 3 spotlight, and audio cues"
```
