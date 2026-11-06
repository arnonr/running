import { describe, it, expect } from 'vitest';
import { stepTvClock, OB, trainLength, laneX } from '../src/config';
import { nameBadgeTexture, NAME_BADGE_CACHE_LIMIT } from '../src/view/textures';
import { createCenterAttachments, updateCenterAttachments } from '../src/view/player';
import { MatchRoomCore } from '../src/net';
import { Sim } from '../src/sim/sim';

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

  it('caches nameBadgeTexture instances and bounds the cache at NAME_BADGE_CACHE_LIMIT (256)', () => {
    expect(NAME_BADGE_CACHE_LIMIT).toBe(256);
    const t1 = nameBadgeTexture('น้องเมย์', 1, '#f472b6');
    const t2 = nameBadgeTexture('น้องเมย์', 1, '#f472b6');
    expect(t1).toBe(t2);

    // Fill beyond 256 unique keys and verify oldest is evicted
    for (let i = 0; i < NAME_BADGE_CACHE_LIMIT + 2; i++) {
      nameBadgeTexture(`Runner-${i}`, (i % 10) + 1, '#38bdf8');
    }
    const t3 = nameBadgeTexture('น้องเมย์', 1, '#f472b6');
    expect(t3).not.toBe(t1);
  });

  it('creates 9-Center 3D attachments for TV ghost runners and propagates flying/stumbling/sliding states', () => {
    const attachments = createCenterAttachments();
    expect(Object.keys(attachments)).toHaveLength(9);

    updateCenterAttachments(attachments, 1, 1.5);
    expect(attachments[1].visible).toBe(true);
    expect(attachments[4].visible).toBe(false);

    updateCenterAttachments(attachments, 4, 2.0);
    expect(attachments[1].visible).toBe(false);
    expect(attachments[4].visible).toBe(true);

    const room = new MatchRoomCore();
    room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.6);
    room.updateRunnerState('p1', { activeCenter: 1, y: 4.2, sliding: true, stumbling: true });
    const r = room.getSnapshot().activeRunners.find((x) => x.id === 'p1');
    expect(r?.activeCenter).toBe(1);
    expect(r?.y).toBeCloseTo(4.2, 1);
    expect(r?.sliding).toBe(true);
    expect(r?.stumbling).toBe(true);
  });

  it('lifts TV ghost runners smoothly up ramps and along walkable train roofs (never running through ramps)', () => {
    const sim = new Sim(202610);
    sim.noSpawn = true;
    sim.reset(202610, false, 180);
    // Place a ramp at d = 100..107 in lane 1, followed by a 2-car train at d = 107..(107 + trainLength(2))
    const rampEnd = 100 + OB.ramp.depth;
    const trainEnd = rampEnd + trainLength(2);
    sim.addOb({ kind: 'ramp', lane: 1, d0: 100, d1: rampEnd });
    sim.addOb({ kind: 'train', lane: 1, d0: rampEnd, d1: trainEnd, cars: 2 });

    let supportY = 0;
    // Before ramp
    supportY = sim.ghostSupportAt(1, laneX(1), 98, supportY, true);
    expect(supportY).toBe(0);

    // Mid-ramp: climbs halfway up toward train roof height (2.65m)
    supportY = sim.ghostSupportAt(1, laneX(1), 100 + OB.ramp.depth * 0.5, supportY, true);
    expect(supportY).toBeGreaterThan(1.0);
    expect(supportY).toBeLessThan(OB.train.yt);

    // Top of ramp & along the train roof: stays at 2.65m without clipping through the train
    supportY = sim.ghostSupportAt(1, laneX(1), rampEnd + 2, supportY, true);
    expect(supportY).toBeCloseTo(OB.train.yt, 2);
    supportY = sim.ghostSupportAt(1, laneX(1), trainEnd - 2, supportY, true);
    expect(supportY).toBeCloseTo(OB.train.yt, 2);

    // No obstacle collision while running on top of the ramp or train roof
    expect(sim.ghostObstacleHitAt(1, laneX(1), supportY, rampEnd + 2, false, null, supportY)).toBeNull();

    // Past the end of the train: support drops back to 0m
    supportY = sim.ghostSupportAt(1, laneX(1), trainEnd + 2, supportY, true);
    expect(supportY).toBe(0);
  });

  it('detects TV ghost obstacle collisions for blinking/stumble effects and respects jump/slide/flying', () => {
    const sim = new Sim(202610);
    sim.noSpawn = true;
    sim.reset(202610, false, 180);
    const lowOb = sim.addOb({ kind: 'low', lane: 0, d0: 80, d1: 80 + OB.low.depth });
    const overOb = sim.addOb({ kind: 'overhead', lane: 2, d0: 120, d1: 120 + OB.overhead.depth });

    // Running into low barrier at y = 0 triggers hit (which drives 16 Hz blink & runlookback on TV)
    expect(sim.ghostObstacleHitAt(0, laneX(0), 0, 80.2, false, null, 0)?.id).toBe(lowOb.id);
    // Jumping over low barrier (y = 1.2) clears it cleanly
    expect(sim.ghostObstacleHitAt(0, laneX(0), 1.2, 80.2, false, null, 0)).toBeNull();

    // Running upright into overhead barrier triggers hit
    expect(sim.ghostObstacleHitAt(2, laneX(2), 0, 120.2, false, null, 0)?.id).toBe(overOb.id);
    // Sliding/rolling under overhead barrier clears it cleanly
    expect(sim.ghostObstacleHitAt(2, laneX(2), 0, 120.2, true, null, 0)).toBeNull();
    // Flying with Center #1 or #9 is immune
    expect(sim.ghostObstacleHitAt(0, laneX(0), 0, 80.2, false, 1, 0)).toBeNull();
  });

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

  it('shares procedural materials/textures across createCenterAttachments instances and caches animated nodes', () => {
    const a1 = createCenterAttachments();
    const a2 = createCenterAttachments();

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

  it('collects coins and 9-Center capsules for TV ghost runners (including magnet pull and height bounds) without affecting mobile Sim', () => {
    const tvSim = new Sim(202610);
    const mobileSim = new Sim(202610);
    tvSim.noSpawn = true;
    mobileSim.noSpawn = true;
    tvSim.reset(202610, false, 180);
    mobileSim.reset(202610, false, 180);
    tvSim.coinList.length = 0;
    mobileSim.coinList.length = 0;

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
    tvSim.collectGhostPickupsAt(laneX(1), 0, 55, false, 5, 1 / 60);
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

  it('diffs RoomSnapshots in TvBroadcastTracker for lead changes, power-ups, last heart, and eliminations with cooldown guards', async () => {
    const { TvBroadcastTracker } = await import('../src/ui');
    const tracker = new TvBroadcastTracker();

    const makeSnap = (
      phaseTimeLeft: number,
      runners: Array<Partial<any> & { id: string; name: string; rank: number }>,
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
});
