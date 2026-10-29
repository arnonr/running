import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MatchRoomCore, MultiChannelRoomRegistry, NetClient, type RunnerNetState } from '../src/net';
import { Audio } from '../src/audio';
import { PlayerView } from '../src/view/player';
import { World, TV_ANCHOR_Z } from '../src/view/world';
import { Sim } from '../src/sim/sim';

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

  it('queues brand-new QR joiners during PODIUM for next round instead of hijacking Rank #1 with 0 score, while allowing existing podium runners to update metadata', () => {
    // Case A: Early-terminated mixed round on PODIUM (all humans eliminated)
    const room = new MatchRoomCore('1');
    room.addDemoBots(2);
    room.join({ id: 'h1', name: 'แชมป์รอบนี้', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.5);
    room.tick(45);
    room.updateRunnerState('h1', { score: 3200, d: 600, lives: 0, eliminated: true });
    room.tick(0.1);
    expect(room.phase).toBe('PODIUM');
    expect(room.getSnapshot().top10[0].id).toBe('h1');

    // Brand-new spectator scans QR during PODIUM (NetClient defaults immediate: true)
    const podJoin = room.join(
      { id: 'qr-spectator', name: 'ผู้ชมเพิ่งสแกน', role: 'public', color: '#f59e0b' },
      { immediate: true },
    );
    expect(podJoin.queuedForNextRound).toBe(true);
    const podSnap = room.getSnapshot();
    expect(podSnap.top10[0].id).toBe('h1');
    expect(podSnap.activeRunners.some((r) => r.id === 'qr-spectator')).toBe(false);
    expect(podSnap.waitingQueue.some((w) => w.id === 'qr-spectator')).toBe(true);

    // Case B: Bot-only or surviving-human round reaching PODIUM by timer expiry
    const survRoom = new MatchRoomCore('2');
    survRoom.addDemoBots(2);
    survRoom.join({ id: 'winner', name: 'ผู้ชนะ', role: 'uni', color: '#22c55e' }, { immediate: true });
    survRoom.hostCommand({ action: 'start_now' });
    survRoom.tick(3.5);
    survRoom.updateRunnerState('winner', { score: 8800, d: 2900, lives: 2, eliminated: false });
    survRoom.tick(180);
    expect(survRoom.phase).toBe('PODIUM');

    // Existing survivor updating profile metadata during PODIUM keeps score and stays active
    const metaJoin = survRoom.join(
      { id: 'winner', name: 'ผู้ชนะ ตัวจริง', role: 'uni', color: '#22c55e' },
      { immediate: true },
    );
    expect(metaJoin.queuedForNextRound).toBe(false);
    expect(survRoom.getSnapshot().top10[0].name).toBe('ผู้ชนะ ตัวจริง');
    expect(survRoom.getSnapshot().top10[0].score).toBe(8800);

    // Brand-new joiner on bot/survivor PODIUM also queues in waitingQueue and promotes on enterLobby
    const newOnSurvPodium = survRoom.join(
      { id: 'newcomer-2', name: 'มาใหม่', role: 'junior', color: '#ec4899' },
      { immediate: true },
    );
    expect(newOnSurvPodium.queuedForNextRound).toBe(true);
    expect(survRoom.getSnapshot().activeRunners.some((r) => r.id === 'newcomer-2')).toBe(false);

    survRoom.tick(15.5);
    expect(survRoom.phase).toBe('LOBBY');
    expect(survRoom.getSnapshot().activeRunners.some((r) => r.id === 'newcomer-2')).toBe(true);
  });

  it('ignores trailing life/elimination packets outside RUNNING and keeps PODIUM scores/survival immutable', () => {
    const room = new MatchRoomCore('1');
    room.join({ id: 'champ', name: 'แชมป์รอด', role: 'uni', color: '#22c55e' }, { immediate: true });
    room.join({ id: 'runner2', name: 'ที่สอง', role: 'senior', color: '#38bdf8' }, { immediate: true });

    // Trailing elimination packet in LOBBY must not eliminate or poison roundLives/eliminatedIds
    room.updateRunnerState('champ', { lives: 0, eliminated: true, survivedSec: 12 });
    let snap = room.getSnapshot();
    expect(snap.eliminatedIds).toHaveLength(0);
    expect(snap.activeRunners.find((r) => r.id === 'champ')?.eliminated).toBe(false);
    expect(snap.activeRunners.find((r) => r.id === 'champ')?.lives).toBe(3);

    // Trailing elimination packet in COUNTDOWN must not poison eliminatedIds
    room.hostCommand({ action: 'start_now' });
    expect(room.phase).toBe('COUNTDOWN');
    room.updateRunnerState('champ', { lives: 0, eliminated: true, survivedSec: 5 });
    expect(room.getSnapshot().eliminatedIds).toHaveLength(0);
    expect(room.getSnapshot().activeRunners.find((r) => r.id === 'champ')?.eliminated).toBe(false);

    // Enter RUNNING: runner2 dies at 40s, champ survives full 180s into PODIUM
    room.tick(3.5);
    room.tick(40);
    room.updateRunnerState('runner2', { score: 4000, d: 650, lives: 0, eliminated: true });
    room.updateRunnerState('champ', { score: 7500, d: 2800, lives: 2, eliminated: false });
    room.tick(140.5);
    expect(room.phase).toBe('PODIUM');

    // Late in-flight packet arriving during PODIUM cannot eliminate champ or mutate finalized PODIUM score/d
    room.updateRunnerState('champ', {
      name: 'แชมป์รอด 10 ชั้น',
      score: 10,
      d: 5,
      lives: 0,
      eliminated: true,
      survivedSec: 1,
    });
    snap = room.getSnapshot();
    expect(snap.top10[0].id).toBe('champ');
    expect(snap.top10[0].name).toBe('แชมป์รอด 10 ชั้น');
    expect(snap.top10[0].eliminated).toBe(false);
    expect(snap.top10[0].lives).toBe(2);
    expect(snap.top10[0].score).toBe(7500);
    expect(snap.top10[0].d).toBe(2800);
  });
});

describe('Audio & PlayerView 3D Elimination Behavior', () => {
  it('plays die animation clip, clamps final pose without looping, forces model visible, and clears active attachments when runner is eliminated', () => {
    const audio = new Audio();
    expect(() => audio.eliminated()).not.toThrow();

    // Also verify WebAudio synthesis calls when AudioContext is active
    const oscFreqs: Array<[number, number]> = [];
    const filterFreqs: Array<[string, number, number]> = [];
    audio.ctx = {
      currentTime: 10,
      createOscillator: () => {
        let f0 = 0;
        return {
          type: 'sine',
          frequency: {
            setValueAtTime: (v: number) => { f0 = v; },
            exponentialRampToValueAtTime: (v: number) => { oscFreqs.push([f0, v]); },
          },
          connect: () => ({ connect: () => {} }),
          start: () => {},
          stop: () => {},
        };
      },
      createBufferSource: () => ({
        buffer: null,
        connect: () => ({ connect: () => ({ connect: () => {} }) }),
        start: () => {},
        stop: () => {},
      }),
      createBiquadFilter: () => {
        const fObj: any = {
          type: 'bandpass',
          Q: { value: 1 },
          f0: 0,
          frequency: {
            setValueAtTime: (v: number) => { fObj.f0 = v; },
            exponentialRampToValueAtTime: (v: number) => { filterFreqs.push([fObj.type, fObj.f0, v]); },
          },
        };
        return fObj;
      },
      createGain: () => ({
        gain: {
          value: 1,
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
      }),
    } as any;
    expect(() => audio.eliminated()).not.toThrow();
    expect(filterFreqs).toEqual([['lowpass', 1600, 140]]);
    expect(oscFreqs).toEqual([
      [320, 180],
      [220, 110],
      [140, 55],
    ]);

    const gltfScene = new THREE.Group();
    const playerObj = new THREE.Group();
    playerObj.name = 'player';
    gltfScene.add(playerObj);
    const makeClip = (name: string) =>
      new THREE.AnimationClip(name, 0.8, [new THREE.NumberKeyframeTrack('.position[y]', [0, 0.8], [0, 0])]);
    const animations = ['idle', 'run', 'jump', 'jumpup', 'fall', 'roll', 'die', 'runlookback'].map(makeClip);

    const viewScene = new THREE.Scene();
    const pv = new PlayerView({ scene: gltfScene, animations } as any, viewScene);

    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180, 1);
    sim.start();
    sim.activateCenter(4);
    sim.shieldHits = 0; // shield spent, next front hit is fatal
    sim.invulnerableT = 0;
    sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 8, cars: 1 });
    sim.update(0.35);

    const events = sim.drainEvents();
    expect(sim.alive).toBe(false);
    pv.update(sim, 0.016, events);

    expect(pv.current).toBe('die');
    expect(pv.model.visible).toBe(true);
    expect(Object.values(pv.attachments).every((grp) => !grp.visible)).toBe(true);

    // Even if invulnerableT were non-zero or clip finishes (> 0.8s), model stays visible and die stays clamped at 0.8s
    sim.invulnerableT = 0.21;
    pv.update(sim, 0.5, []);
    pv.update(sim, 0.5, []);
    expect(pv.current).toBe('die');
    expect(pv.model.visible).toBe(true);
    expect(pv.actions.die.paused).toBe(true);
    expect(pv.actions.die.time).toBeCloseTo(0.8, 2);
  });
});

describe('World TV Ghost 3D Elimination & Podium Grid Behavior', () => {
  function makeMockCoreGltf() {
    const scene = new THREE.Group();
    const player = new THREE.Group();
    player.name = 'player';
    player.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.4), new THREE.MeshLambertMaterial()));
    scene.add(player);

    for (const partName of ['train', 'low', 'hurdle', 'overhead', 'coin']) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial());
      m.name = partName;
      scene.add(m);
    }

    const makeClip = (name: string) =>
      new THREE.AnimationClip(name, 0.8, [new THREE.NumberKeyframeTrack('.position[y]', [0, 0.8], [0, 0])]);
    const animations = ['idle', 'run', 'jump', 'jumpup', 'fall', 'roll', 'die', 'runlookback'].map(makeClip);
    return { scene, animations };
  }

  it('plays die + red burst on eliminated TV ghosts, drifts backward for 1.4s then hides during RUNNING, and reappears in idle on PODIUM grid', () => {
    const world = new World(makeMockCoreGltf() as any, { shadowSize: 512 });
    const burstSpy = vi.spyOn(world.fx, 'burst');

    world.event({
      type: 'eliminated',
      kind: 'train',
      x: 0,
      y: 0,
      score: 600,
      coins: 12,
      distance: 150,
      survivedSec: 18,
      hitCount: 3,
    });
    expect((world as any).shake).toBeCloseTo(0.5, 2);
    expect(burstSpy).toHaveBeenCalledWith(0, 1, -0.3, 28, 0xf43f5e, expect.any(Object));
    burstSpy.mockClear();

    const sim = new Sim(202610);
    sim.noSpawn = true;
    sim.reset(202610, false, 180);
    sim.d = 160;
    sim.speed = 18;

    const makeRunner = (overrides: Partial<RunnerNetState> & { id: string; name: string }): RunnerNetState => ({
      role: 'senior',
      color: '#38bdf8',
      avatar: 'non',
      score: 1000,
      d: 160,
      floor: 2,
      coins: 10,
      activeCenter: null,
      collectedCount: 0,
      lane: 1,
      x: 0,
      y: 0,
      sliding: false,
      stumbling: false,
      isBot: false,
      rank: 1,
      packOffsetZ: 0,
      lives: 3,
      maxLives: 3,
      eliminated: false,
      survivedSec: 15,
      ...overrides,
    });

    const runners: RunnerNetState[] = [
      makeRunner({ id: 'h1', name: 'นนท์', rank: 1, lane: 0, x: -2.4, activeCenter: 4 }),
      makeRunner({ id: 'h2', name: 'เมย์', rank: 2, lane: 2, x: 2.4, color: '#ec4899' }),
    ];

    // Frame 0: both runners alive and running on TV
    world.sync(sim, 0.05, false, runners, '', true);
    const slots = (world as any).ghostSlots as any[];
    const h1Slot = slots.find((s) => s.runnerId === 'h1')!;
    const h2Slot = slots.find((s) => s.runnerId === 'h2')!;
    expect(h1Slot.group.visible).toBe(true);
    expect(h1Slot.attachments[4].visible).toBe(true);
    expect(h1Slot.currentClip).toBe('run');
    burstSpy.mockClear();

    // h1 crashes and is eliminated (even if last y was airborne / on roof, e.g. y = 2.65); surviving h2 becomes Rank #1 anchor!
    runners[0].eliminated = true;
    runners[0].lives = 0;
    runners[0].rank = 2;
    runners[0].y = 2.65;
    runners[1].rank = 1;

    const zBeforeElim = h1Slot.z;
    world.sync(sim, 0.05, false, runners, '', true);
    expect(h1Slot.currentClip).toBe('die');
    expect(h1Slot.group.visible).toBe(true);
    expect(h1Slot.charClone.visible).toBe(true);
    expect(Object.values(h1Slot.attachments).every((grp: any) => !grp.visible)).toBe(true);
    expect(h1Slot.z).toBeCloseTo(zBeforeElim + 18 * 0.05 * 0.55, 4);
    const redBursts = burstSpy.mock.calls.filter((c) => c[3] === 26 && c[4] === 0xf43f5e);
    expect(redBursts).toHaveLength(1);

    // Advance 1.0s more (total 1.05s: past 0.8s clip duration, still <= 1.4s): die clamps without restarting, no duplicate burst
    world.sync(sim, 0.5, false, runners, '', true);
    world.sync(sim, 0.5, false, runners, '', true);
    expect(h1Slot.group.visible).toBe(true);
    expect(h1Slot.actions.die.paused).toBe(true);
    expect(h1Slot.actions.die.time).toBeCloseTo(0.8, 2);
    expect(burstSpy.mock.calls.filter((c) => c[3] === 26 && c[4] === 0xf43f5e)).toHaveLength(1);

    // Advance 0.5s more (total 1.55s > 1.4s): fallen h1 hides while surviving h2 keeps running anchored near TV_ANCHOR_Z
    world.sync(sim, 0.5, false, runners, '', true);
    expect(h1Slot.group.visible).toBe(false);
    expect(h2Slot.group.visible).toBe(true);
    expect(h2Slot.currentClip).toBe('run');
    expect(h2Slot.z).toBeCloseTo(TV_ANCHOR_Z, 0);

    // Transition to PODIUM (!isRunning: sim.speed = 0): eliminated h1 reappears on podium grid in 'idle' grounded at y = 0
    sim.d = 0;
    sim.speed = 0;
    world.sync(sim, 0.05, false, runners, '', true);
    expect(h1Slot.eliminatedTimer).toBe(0);
    expect(h1Slot.group.visible).toBe(true);
    expect(h1Slot.currentClip).toBe('idle');
    expect(h1Slot.y).toBeCloseTo(0, 3);

    // Next round RUNNING: h1 leaves and h3 takes h1Slot -> eliminatedTimer starts clean and replays 'die' from t=0 if h3 dies
    sim.d = 50;
    sim.speed = 16;
    const round2Runners: RunnerNetState[] = [
      makeRunner({ id: 'h3', name: 'คิน', rank: 1, lane: 1, x: 0, eliminated: true, lives: 0 }),
      makeRunner({ id: 'h2', name: 'เมย์', rank: 2, lane: 2, x: 2.4, color: '#ec4899' }),
    ];
    burstSpy.mockClear();
    world.sync(sim, 0.05, false, round2Runners, '', true);
    const h3Slot = slots.find((s) => s.runnerId === 'h3')!;
    expect(h3Slot).toBe(h1Slot);
    expect(h3Slot.group.visible).toBe(true);
    expect(h3Slot.currentClip).toBe('die');
    expect(h3Slot.actions.die.paused).toBe(false);
    expect(h3Slot.eliminatedTimer).toBeCloseTo(0.05, 4);
    expect(burstSpy.mock.calls.filter((c) => c[3] === 26 && c[4] === 0xf43f5e)).toHaveLength(1);
  });

  it('hides rival ghost slots on mobile (tvMode === false) when local runner is eliminated instead of snapping rivals into the TV idle grid', () => {
    const world = new World(makeMockCoreGltf() as any, { shadowSize: 512 });
    const sim = new Sim(202610);
    sim.noSpawn = true;
    sim.reset(202610, false, 180, 1);
    sim.start();
    sim.update(0.1);
    sim.drainEvents();

    const makeRunner = (overrides: Partial<RunnerNetState> & { id: string; name: string }): RunnerNetState => ({
      role: 'senior',
      color: '#38bdf8',
      avatar: 'non',
      score: 800,
      d: sim.d,
      floor: 1,
      coins: 5,
      activeCenter: null,
      collectedCount: 0,
      lane: 1,
      x: 0,
      y: 0,
      sliding: false,
      stumbling: false,
      isBot: false,
      rank: 1,
      packOffsetZ: 1.5,
      lives: 1,
      maxLives: 1,
      eliminated: false,
      survivedSec: 5,
      ...overrides,
    });

    const runners: RunnerNetState[] = [
      makeRunner({ id: 'me', name: 'เรา', rank: 1 }),
      makeRunner({ id: 'rival-alive', name: 'คู่แข่ง', rank: 2, lane: 0, x: -2.4 }),
      makeRunner({ id: 'rival-dead', name: 'คนตกแล้ว', rank: 3, lane: 2, x: 2.4, eliminated: true, lives: 0 }),
    ];

    // While local mobile runner is alive & running: rival-alive is visible, rival-dead fades out after 1.4s
    world.sync(sim, 0.05, false, runners, 'me', false);
    world.sync(sim, 1.5, false, runners, 'me', false);
    const slots = (world as any).ghostSlots as any[];
    expect(slots.find((s) => s.runnerId === 'rival-alive')?.group.visible).toBe(true);
    expect(slots.find((s) => s.runnerId === 'rival-dead')?.group.visible).toBe(false);

    // Local mobile runner crashes fatally -> sim.alive = false, sim.speed = 0 while latestRoom.phase is still RUNNING
    sim.invulnerableT = 0;
    sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 8, cars: 1 });
    sim.update(0.35);
    const evs = sim.drainEvents();
    expect(sim.alive).toBe(false);
    expect(sim.speed).toBe(0);

    world.player.update(sim, 0.016, evs);
    world.sync(sim, 0.016, false, runners, 'me', false);

    expect(world.player.root.visible).toBe(true);
    expect(world.player.current).toBe('die');
    expect(slots.every((s) => !s.group.visible && s.runnerId === '')).toBe(true);
  });
});
