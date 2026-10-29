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

  it('caches nameBadgeTexture instances and bounds the cache at NAME_BADGE_CACHE_LIMIT (64)', () => {
    expect(NAME_BADGE_CACHE_LIMIT).toBe(64);
    const t1 = nameBadgeTexture('น้องเมย์', 1, '#f472b6');
    const t2 = nameBadgeTexture('น้องเมย์', 1, '#f472b6');
    expect(t1).toBe(t2);

    // Fill beyond 64 unique keys and verify oldest is evicted
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
});
