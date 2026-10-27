import { describe, expect, it } from 'vitest';
import { MatchRoomCore } from '../src/net';
import { Sim } from '../src/sim/sim';

describe('Admin-Controlled Rounds, Mid-Race Stop/Reset & Mobile Sync', () => {
  it('does NOT auto-start from LOBBY over time or when players join — waits for admin start_now', () => {
    const room = new MatchRoomCore();
    room.addDemoBots(2);
    room.join(
      { id: 'mobile-1', name: 'นนท์ มือถือ', role: 'senior', color: '#22c55e', avatar: 'non' },
      { immediate: true },
    );

    // Even after 120 seconds in LOBBY, phase remains LOBBY until admin clicks start_now
    room.tick(120);
    expect(room.phase).toBe('LOBBY');

    // Admin clicks start_now -> transitions to COUNTDOWN
    room.hostCommand({ action: 'start_now' });
    expect(room.phase).toBe('COUNTDOWN');
  });

  it('allows admin to stop a round mid-race (force_lobby) or restart mid-race (start_now)', () => {
    const room = new MatchRoomCore();
    room.join({ id: 'mobile-1', name: 'เมย์', role: 'uni', color: '#ec4899', avatar: 'may' });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.6); // -> RUNNING
    room.tick(25);
    expect(room.phase).toBe('RUNNING');
    expect(room.referenceDistance).toBeGreaterThan(100);

    // Admin stops mid-race -> returns to LOBBY at 0m with players preserved
    room.hostCommand({ action: 'force_lobby' });
    expect(room.phase).toBe('LOBBY');
    expect(room.referenceDistance).toBe(0);
    expect(room.getSnapshot().activeRunners.some((r) => r.id === 'mobile-1')).toBe(true);

    // Start again -> RUNNING -> Admin clicks start_now mid-race to restart immediately
    room.hostCommand({ action: 'start_now' });
    room.tick(3.6);
    room.tick(15);
    expect(room.phase).toBe('RUNNING');
    const prevMatchId = room.matchId;

    room.hostCommand({ action: 'start_now' });
    expect(room.phase).toBe('COUNTDOWN');
    expect(room.matchId).toBe(prevMatchId + 1);
  });

  it('immediately places a mobile player into activeRunners when joining with immediate=true during RUNNING', () => {
    const room = new MatchRoomCore();
    room.addDemoBots(2);
    room.hostCommand({ action: 'start_now' });
    room.tick(3.6); // -> RUNNING
    room.tick(30);  // advance 30s into the match
    expect(room.phase).toBe('RUNNING');

    const res = room.join(
      { id: 'mobile-late', name: 'มือถือตามมา', role: 'uni', color: '#38bdf8', avatar: 'kin' },
      { immediate: true },
    );
    expect(res.queuedForNextRound).toBe(false);

    const snap = room.getSnapshot();
    const active = snap.activeRunners.find((r) => r.id === 'mobile-late');
    expect(active).toBeDefined();
    expect(active?.d).toBeCloseTo(room.referenceDistance, 1);
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
    const unsafe = sim.obs.filter((o) => o.d1 >= sim.d - 2 && o.d0 <= sim.d + 12);
    expect(unsafe).toHaveLength(0);
  });
});
