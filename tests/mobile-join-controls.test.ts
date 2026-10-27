import { describe, expect, it } from 'vitest';
import { MatchRoomCore } from '../src/net';
import { Sim } from '../src/sim/sim';

describe('Mobile Live Join & Mid-Match Sync', () => {
  it('immediately places a mobile player into activeRunners when joining with immediate=true during RUNNING', () => {
    const room = new MatchRoomCore();
    room.addDemoBots(2);
    room.hostCommand({ action: 'start_now' });
    room.tick(3.6); // -> RUNNING
    room.tick(30);  // advance 30s into the match
    expect(room.phase).toBe('RUNNING');
    expect(room.referenceDistance).toBeGreaterThan(100);

    const res = room.join(
      { id: 'mobile-1', name: 'มือถือทดสอบ', role: 'uni', color: '#38bdf8', avatar: 'kin' },
      { immediate: true },
    );
    expect(res.queuedForNextRound).toBe(false);

    const snap = room.getSnapshot();
    const active = snap.activeRunners.find((r) => r.id === 'mobile-1');
    expect(active).toBeDefined();
    expect(active?.d).toBeCloseTo(room.referenceDistance, 1);
    expect(snap.waitingQueue.find((p) => p.id === 'mobile-1')).toBeUndefined();
  });

  it('auto-triggers COUNTDOWN when a player taps immediate join during LOBBY', () => {
    const room = new MatchRoomCore();
    expect(room.phase).toBe('LOBBY');

    room.join(
      { id: 'mobile-2', name: 'นนท์ มือถือ', role: 'senior', color: '#22c55e', avatar: 'non' },
      { immediate: true },
    );
    expect(room.phase).toBe('COUNTDOWN');
  });

  it('syncs Sim to mid-match elapsed time with spawn invulnerability and safe obstacle clearance', () => {
    const sim = new Sim(202610);
    sim.reset(202610, false, 180);
    sim.start();
    sim.syncToElapsed(85);

    expect(sim.time).toBe(85);
    expect(sim.d).toBeGreaterThan(200);
    expect(sim.floor).toBeGreaterThanOrEqual(2);
    expect(sim.invulnerableT).toBeGreaterThanOrEqual(2.0);
    // No obstacle should be within [sim.d - 2, sim.d + 12] right on spawn
    const unsafe = sim.obs.filter((o) => o.d1 >= sim.d - 2 && o.d0 <= sim.d + 12);
    expect(unsafe).toHaveLength(0);
  });
});
