import { describe, it, expect } from 'vitest';
import { MatchRoomCore, sanitizeNickname } from '../src/net';

describe('MatchRoomCore: Synchronized Rounds, Waiting Queue & Hybrid Controls', () => {
  it('sanitizes empty or HTML-injected nicknames (Review Focus #5)', () => {
    expect(sanitizeNickname('   ')).toBe('นักวิ่ง Techno');
    expect(sanitizeNickname('<script>alert(1)</script>นนท์')).toBe('alert(1)นนท์');
    expect(sanitizeNickname('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toHaveLength(16);
  });

  it('places players joining during RUNNING into waitingQueue and isolates active leaderboard (Review Focus #4)', () => {
    const room = new MatchRoomCore();
    room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' });
    room.join({ id: 'p2', name: 'เมย์', role: 'uni', color: '#22c55e' });
    expect(room.phase).toBe('LOBBY');

    // Host triggers start_now -> COUNTDOWN -> step 3.6s -> RUNNING
    room.hostCommand({ action: 'start_now' });
    expect(room.phase).toBe('COUNTDOWN');
    room.tick(3.6);
    expect(room.phase).toBe('RUNNING');
    expect(room.getSnapshot().activeRunners).toHaveLength(2);

    // Latecomer joins mid-run -> goes to waitingQueue, NOT activeRunners
    room.join({ id: 'p3', name: 'คนมาทีหลัง', role: 'junior', color: '#f59e0b' });
    room.updateRunnerState('p3', { lane: 1, x: 0, y: 0, d: 500, score: 99999, coins: 100, floor: 5, activeCenter: null, collectedCount: 5 });
    const snapMid = room.getSnapshot();
    expect(snapMid.waitingQueue.map((p) => p.id)).toEqual(['p3']);
    expect(snapMid.activeRunners.find((r) => r.id === 'p3')).toBeUndefined();
    expect(snapMid.top10.find((r) => r.id === 'p3')).toBeUndefined();

    // Update p1 and p2 -> verify rank sorting and clamped packOffsetZ in [-14, +10]
    room.updateRunnerState('p1', { lane: 0, x: -2.5, y: 0, d: 320, score: 4500, coins: 40, floor: 2, activeCenter: 2, collectedCount: 2 });
    room.updateRunnerState('p2', { lane: 2, x: 2.5, y: 0, d: 210, score: 2100, coins: 18, floor: 2, activeCenter: null, collectedCount: 1 });
    const snapRanked = room.getSnapshot();
    expect(snapRanked.top10[0].id).toBe('p1');
    expect(snapRanked.top10[0].packOffsetZ).toBeLessThanOrEqual(10);
    expect(snapRanked.top10[1].packOffsetZ).toBeGreaterThanOrEqual(-14);

    // Finish 180s match -> PODIUM (15s) -> next LOBBY automatically promotes p3 from waitingQueue
    room.tick(180.5);
    expect(room.phase).toBe('PODIUM');
    room.tick(15.5);
    expect(room.phase).toBe('LOBBY');
    const snapNext = room.getSnapshot();
    expect(snapNext.activeRunners.some((r) => r.id === 'p3')).toBe(true);
    expect(snapNext.waitingQueue).toHaveLength(0);
  });
});
