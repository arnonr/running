import { describe, expect, it } from 'vitest';
import { MatchRoomCore, MultiChannelRoomRegistry, NetClient } from '../src/net';

describe('MatchRoomCore: Lives Authority, Early Podium, Winner Ranking & Anti-Respawn', () => {
  it('terminates RUNNING into PODIUM immediately when all humans die (ignoring bots), while bot-only rounds run full duration', () => {
    // Bot-only round runs full 180s
    const botRoom = new MatchRoomCore('1');
    botRoom.addDemoBots(3);
    botRoom.hostCommand({ action: 'start_now' });
    botRoom.tick(3.6);
    expect(botRoom.phase).toBe('RUNNING');
    botRoom.tick(60);
    expect(botRoom.phase).toBe('RUNNING');

    // Mixed round: 2 humans + 3 bots -> ends early as soon as 2nd human dies
    const room = new MatchRoomCore('1');
    room.addDemoBots(3);
    room.join({ id: 'h1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.join({ id: 'h2', name: 'เมย์', role: 'uni', color: '#ec4899' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    room.tick(20); // elapsed = 20s

    room.updateRunnerState('h1', { score: 8000, d: 300, lives: 0, eliminated: true });
    room.tick(0.1);
    expect(room.phase).toBe('RUNNING'); // h2 still alive!

    room.tick(35); // elapsed ~ 55.1s
    room.updateRunnerState('h2', { score: 1500, d: 750, lives: 0, eliminated: true });
    room.tick(0.1);
    expect(room.phase).toBe('PODIUM');

    // Ranking: h2 (survived ~55.1s, lower score) beats h1 (survived ~20s, higher score), and BOTH humans beat all bots!
    const snap = room.getSnapshot();
    expect(snap.top10[0].id).toBe('h2');
    expect(snap.top10[0].eliminated).toBe(true);
    expect(snap.top10[1].id).toBe('h1');
    expect(snap.top10[1].eliminated).toBe(true);
    expect(snap.top10[2].isBot).toBe(true);
  });

  it('ranks survivors above eliminated humans, measures late-joiner actual survivedSec, and tie-breaks simultaneous deaths by score then distance', () => {
    const room = new MatchRoomCore('1');
    room.join({ id: 'starter', name: 'คนเริ่ม', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.join({ id: 'survivor', name: 'คนรอด', role: 'uni', color: '#22c55e' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);

    // starter dies at 30s (survivedSec = 30s)
    room.tick(30);
    room.updateRunnerState('starter', { score: 1200, d: 420, lives: 0, eliminated: true });

    // latecomer joins at 40s and dies at 55s -> actual survivedSec = 15s (< 30s!)
    room.tick(10); // elapsed = 40s
    room.join({ id: 'late', name: 'มาสาย', role: 'junior', color: '#f59e0b' }, { immediate: true });
    room.tick(15); // elapsed = 55s
    room.updateRunnerState('late', { score: 9000, d: 800, lives: 0, eliminated: true });
    room.updateRunnerState('survivor', { score: 500, d: 820, lives: 1, eliminated: false });

    const ranked = room.getSnapshot().activeRunners;
    expect(ranked.map((r) => r.id)).toEqual(['survivor', 'starter', 'late']);
    expect(ranked[1].survivedSec).toBeCloseTo(30, 1);
    expect(ranked[2].survivedSec).toBeCloseTo(15, 1);

    // Simultaneous crash within 0.05s tie-breaks by score
    const tieRoom = new MatchRoomCore('2');
    tieRoom.join({ id: 'a', name: 'A', role: 'senior', color: '#38bdf8' }, { immediate: true });
    tieRoom.join({ id: 'b', name: 'B', role: 'senior', color: '#22c55e' }, { immediate: true });
    tieRoom.hostCommand({ action: 'start_now' });
    tieRoom.tick(3.5);
    tieRoom.tick(25);
    tieRoom.updateRunnerState('a', { score: 1000, d: 350, lives: 0, eliminated: true });
    tieRoom.updateRunnerState('b', { score: 2500, d: 340, lives: 0, eliminated: true });
    expect(tieRoom.getSnapshot().activeRunners.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('locks eliminated players from respawning mid-round (even after channel leave/rejoin) and persists remaining roundLives and starter joinedAtElapsed across refresh', () => {
    const room = new MatchRoomCore('1');
    room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.join({ id: 'p2', name: 'เมย์', role: 'uni', color: '#ec4899' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    room.tick(12);

    // p1 drops to 1 life, then refreshes/leaves and rejoins same matchId -> stays at 1 life (no 3/3 heal!)
    room.updateRunnerState('p1', { lives: 1, score: 600, d: 160 });
    room.leave('p1');
    const rejoinAlive = room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    expect(rejoinAlive.queuedForNextRound).toBe(false);
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p1')?.lives).toBe(1);

    // Advance 18s more (elapsed = 30s) before p1 dies -> starter joinedAtElapsed=0 was preserved across leave+join!
    room.tick(18);

    // p1 now dies -> late state packets cannot move/revive p1, and re-joining (even with immediate=true or after leave) queues for next round
    room.updateRunnerState('p1', { lives: 0, eliminated: true, score: 700, d: 180 });
    room.updateRunnerState('p1', { lives: 3, eliminated: false, score: 99999, d: 999 });
    const afterLatePacket = room.getSnapshot().activeRunners.find((r) => r.id === 'p1')!;
    expect(afterLatePacket.eliminated).toBe(true);
    expect(afterLatePacket.score).toBe(700);
    expect(afterLatePacket.survivedSec).toBeCloseTo(30, 1);
    expect(room.getSnapshot().eliminatedIds).toContain('p1');

    const respawnAttempt = room.join({ id: 'p1', name: 'นนท์ ใหม่', role: 'senior', color: '#38bdf8' }, { immediate: true });
    expect(respawnAttempt.queuedForNextRound).toBe(true);
    expect(room.getSnapshot().waitingQueue.some((w) => w.id === 'p1')).toBe(true);
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p1')?.eliminated).toBe(true);
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p1')?.name).toBe('นนท์ ใหม่');

    // Channel-switch toggle (leave + join) also cannot bypass eliminatedIds in the same matchId
    room.leave('p1');
    const afterToggle = room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    expect(afterToggle.queuedForNextRound).toBe(true);
    expect(room.getSnapshot().activeRunners.some((r) => r.id === 'p1')).toBe(false);
  });

  it('preserves disconnected eliminated runners on TV through PODIUM, prunes them on enterLobby, and auto-eliminates >10s silent AFK phones', () => {
    const room = new MatchRoomCore('1');
    room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.join({ id: 'p2', name: 'เมย์', role: 'uni', color: '#ec4899' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    room.tick(10);

    // p1 dies and locks phone (disconnect) -> remains in activeRunners on TV!
    room.updateRunnerState('p1', { score: 900, d: 140, lives: 0, eliminated: true });
    room.disconnect('p1');
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p1')?.eliminated).toBe(true);

    // p2 stops sending packets (frozen/backgrounded HTTP phone) for > 10s of incremental ticks (dt <= 1.0)
    for (let i = 0; i < 22; i++) {
      room.tick(0.5); // 11.0s total silentSec -> auto-eliminates p2 and triggers early PODIUM!
    }
    expect(room.phase).toBe('PODIUM');
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p1')).toBeDefined();
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'p2')?.eliminated).toBe(true);

    // When PODIUM finishes -> enterLobby prunes disconnected p1 while keeping connected p2 reset to fresh lives
    room.tick(15.5);
    expect(room.phase).toBe('LOBBY');
    const nextRunners = room.getSnapshot().activeRunners;
    expect(nextRunners.some((r) => r.id === 'p1')).toBe(false);
    const p2Reset = nextRunners.find((r) => r.id === 'p2')!;
    expect(p2Reset.eliminated).toBe(false);
    expect(p2Reset.lives).toBe(3);
  });

  it('handles Admin set_max_lives (3, 5, 0) in LOBBY and mid-race without reviving eliminated runners, and flags life changes urgent', () => {
    const reg = new MultiChannelRoomRegistry(0);
    const room = reg.getRoom('1');
    room.join({ id: 'p1', name: 'A', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.join({ id: 'p2', name: 'B', role: 'uni', color: '#22c55e' }, { immediate: true });

    reg.applyMessage({ type: 'host', channel: '1', command: { action: 'set_max_lives', maxLives: 5 } });
    expect(room.getSnapshot().maxLives).toBe(5);
    expect(room.getSnapshot().activeRunners.every((r) => r.lives === 5)).toBe(true);

    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    const { urgent } = reg.applyMessage({
      type: 'state',
      channel: '1',
      id: 'p1',
      state: { lives: 0, eliminated: true },
    });
    expect(urgent).toBe(true);

    // Admin switches to unlimited (0) mid-race -> p2 becomes immortal (maxLives=0), p1 stays eliminated
    room.hostCommand({ action: 'set_max_lives', maxLives: 0 });
    const snap = room.getSnapshot();
    expect(snap.maxLives).toBe(0);
    expect(snap.activeRunners.find((r) => r.id === 'p1')?.eliminated).toBe(true);
    expect(snap.activeRunners.find((r) => r.id === 'p2')?.maxLives).toBe(0);
    expect(snap.activeRunners.find((r) => r.id === 'p2')?.eliminated).toBe(false);
  });

  it('routes disconnect immediately to leave in LOBBY/COUNTDOWN and forfeits alive runners on disconnect during RUNNING via Registry and NetClient', () => {
    const reg = new MultiChannelRoomRegistry(0);
    const room = reg.getRoom('1');
    room.join({ id: 'lobby-p', name: 'ล็อบบี้', role: 'senior', color: '#38bdf8' }, { immediate: true });
    expect(room.getSnapshot().activeRunners).toHaveLength(1);

    // Disconnect in LOBBY removes immediately
    const { urgent } = reg.applyMessage({ type: 'disconnect', channel: '1', id: 'lobby-p' });
    expect(urgent).toBe(true);
    expect(room.getSnapshot().activeRunners).toHaveLength(0);

    // Disconnect of alive runner during RUNNING forfeits runner (eliminated=true) while preserving TV entry
    room.join({ id: 'live-p', name: 'วิ่งสด', role: 'uni', color: '#22c55e' }, { immediate: true });
    room.join({ id: 'live-p2', name: 'เพื่อนวิ่ง', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    room.tick(14);
    room.disconnect('live-p');
    const forfeited = room.getSnapshot().activeRunners.find((r) => r.id === 'live-p')!;
    expect(forfeited).toBeDefined();
    expect(forfeited.eliminated).toBe(true);
    expect(forfeited.lives).toBe(0);
    expect(forfeited.survivedSec).toBeCloseTo(14, 1);

    // NetClient.disconnect updates local room and snapshot cleanly
    const netLobbyDisconnect = new NetClient(false, '4');
    netLobbyDisconnect.join({ id: 'ch4-p', name: 'CH4', role: 'junior', color: '#f59e0b' }, { immediate: true });
    expect(netLobbyDisconnect.getSnapshot().activeRunners.some((r) => r.id === 'ch4-p')).toBe(true);
    netLobbyDisconnect.disconnect('ch4-p');
    expect(netLobbyDisconnect.getSnapshot().activeRunners.some((r) => r.id === 'ch4-p')).toBe(false);

    netLobbyDisconnect.destroy();
  });
});
