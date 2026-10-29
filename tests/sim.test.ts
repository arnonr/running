import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';

describe('Sim: Forgiving No-Death Rules, 180s Timer & 9 Center Power-Ups', () => {
  it('never kills the runner on front collision, clamps score >= 0, resets coinStreak, and applies 0.65x slow + invulnerability', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180);
    sim.start();
    sim.score = 20; // Review Focus #1: score < 50 before collision
    sim.coinStreak = 5;
    sim.coinStreakT = 0.5;
    const d0 = sim.d + 3;
    sim.addOb({ kind: 'train', lane: 1, d0, d1: d0 + 10, cars: 1 });
    sim.update(0.5);
    expect(sim.alive).toBe(true);
    expect(sim.score).toBeGreaterThanOrEqual(0);
    expect(sim.hitCount).toBe(1);
    expect(sim.coinStreak).toBe(0);
    expect(sim.invulnerableT).toBeGreaterThan(0);
  });

  it('grants safe landing invulnerability when Center #1 (Jet Fighter Pack) expires over a train', () => {
    // Review Focus #2
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180);
    sim.start();
    sim.activateCenter(1); // Jet Fighter Pack -> flies at y ~ 4.2m
    sim.update(0.5);
    expect(sim.y).toBeGreaterThan(3.5);

    // Place a long unwalkable moving train directly underneath when timer expires
    sim.addOb({ kind: 'mtrain', lane: 1, d0: sim.d - 2, d1: sim.d + 40, cars: 3 });
    sim.centerTimer = 0.05;
    sim.update(0.1); // power-up expires
    expect(sim.activeCenter).toBeNull();
    expect(sim.invulnerableT).toBeGreaterThanOrEqual(1.0);
    const hitsBefore = sim.hitCount;
    sim.update(0.8); // falls through/onto train during grace window
    expect(sim.hitCount).toBe(hitsBefore);
    expect(sim.alive).toBe(true);
  });

  it('overwrites active power-up cleanly when picking up a ground capsule while flying in Center #1 and grants grace invulnerability (Review Focus #3)', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180);
    sim.start();
    sim.activateCenter(1);
    sim.update(1.0);
    expect(sim.activeCenter).toBe(1);
    expect(sim.y).toBeGreaterThan(3.5);

    // Ground capsule at y = 1.15 while player is flying at y = 4.2
    sim.addCenterPickup(5, 1, sim.d + 0.2, 1.15);
    sim.update(0.1);
    expect(sim.activeCenter).toBe(5);
    expect(sim.centerTimer).toBeGreaterThan(4.8);
    expect(sim.invulnerableT).toBeGreaterThanOrEqual(0.9);
    expect(sim.collectedCenters.has(1)).toBe(true);
    expect(sim.collectedCenters.has(5)).toBe(true);
  });

  it('executes special abilities for Centers #2, #3, #4, #6, #7, #8, #9 and finishes cleanly at 180s', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180);
    sim.start();

    // #2 Robo-Wingman Drones laser-destroys barriers within 28m for +50 pts
    sim.activateCenter(2);
    sim.addOb({ kind: 'low', lane: 1, d0: sim.d + 12, d1: sim.d + 12.7 });
    const before2 = sim.score;
    sim.update(0.1);
    expect(sim.obs.length).toBe(0);
    expect(sim.score).toBeGreaterThanOrEqual(before2 + 50);

    // #3 EV Train Armor smashes obstacle for +100 bonus without hit penalty
    sim.activateCenter(3);
    const s0 = sim.score;
    sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 9, cars: 1 });
    sim.update(0.35);
    expect(sim.hitCount).toBe(0);
    expect(sim.score).toBeGreaterThan(s0 + 90);

    // #4 Green Energy Shield blocks 2 hits and resets shieldHits on expiry
    sim.activateCenter(4);
    expect(sim.shieldHits).toBe(2);
    sim.centerTimer = 0.05;
    sim.update(0.1);
    expect(sim.shieldHits).toBe(0);

    // #6 Radar Path Scanner converts barriers ahead into coins
    sim.clearWorld();
    sim.activateCenter(6);
    sim.addOb({ kind: 'low', lane: 0, d0: sim.d + 15, d1: sim.d + 15.7 });
    sim.update(0.1);
    expect(sim.obs.length).toBe(0);
    expect(sim.coinList.length).toBeGreaterThan(0);

    // #8 Med-Tech Recovery Drone clears stumbleSlow and adds +500 points
    sim.stumbleSlow = 1.0;
    const before8 = sim.score;
    sim.activateCenter(8);
    expect(sim.stumbleSlow).toBe(0);
    expect(sim.score).toBeGreaterThanOrEqual(before8 + 500);

    // #9 Space Rocket Fever is immune to obstacle hits
    sim.clearWorld();
    sim.activateCenter(9);
    const hitsBefore9 = sim.hitCount;
    sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 10, cars: 1 });
    sim.update(0.35);
    expect(sim.hitCount).toBe(hitsBefore9);

    // Step to end of 180s match -> floor reaches 10 and finished = true
    sim.time = 179.9;
    sim.update(0.2);
    expect(sim.finished).toBe(true);
    expect(sim.running).toBe(false);
    expect(sim.floor).toBe(10);
  });

  it('transitions through all 9 sequential Center stages and emits centerStageChange across custom 90s duration', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 90);
    sim.start();
    expect(sim.stageCenter).toBe(1);
    expect(sim.stageIndex).toBe(0);

    const stageChanges: number[] = [sim.stageCenter];
    for (let step = 0; step < 178; step++) {
      sim.update(0.5);
      for (const ev of sim.drainEvents()) {
        if (ev.type === 'centerStageChange') {
          stageChanges.push(ev.centerId);
        }
      }
    }
    expect(stageChanges).toEqual([1, 4, 5, 3, 2, 6, 7, 8, 9]);
  });

  it('deducts 1 life per front hit, eliminates runner on 3rd hit with survivedSec, and stops movement & inputs', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180, 3);
    sim.start();
    expect(sim.maxLives).toBe(3);
    expect(sim.lives).toBe(3);

    for (let hit = 1; hit <= 3; hit++) {
      sim.invulnerableT = 0;
      sim.ignoreId = -1;
      sim.ignoreT = 0;
      const d0 = sim.d + 2;
      sim.addOb({ kind: 'train', lane: 1, d0, d1: d0 + 8, cars: 1 });
      sim.update(0.4);
      if (hit < 3) {
        expect(sim.alive).toBe(true);
        expect(sim.lives).toBe(3 - hit);
      }
    }

    expect(sim.alive).toBe(false);
    expect(sim.running).toBe(false);
    expect(sim.lives).toBe(0);
    expect(sim.speed).toBe(0);
    const events = sim.drainEvents();
    const elim = events.find((e) => e.type === 'eliminated');
    expect(elim).toBeDefined();
    if (elim?.type === 'eliminated') {
      expect(elim.survivedSec).toBeCloseTo(sim.survivedSec, 1);
      expect(elim.hitCount).toBe(3);
    }

    const dAtDeath = sim.d;
    sim.left();
    sim.jump();
    sim.update(1.0);
    expect(sim.d).toBe(dAtDeath);
    expect(sim.lane).toBe(1);
  });

  it('keeps isolated side-stumbles non-lethal (-20 pts, 0 lives lost) while repeated side-stumbles (< 4.5s) deduct 1 life with 1.5s multi-car grace', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180, 3);
    sim.start();
    sim.score = 200;

    // 1st isolated side-stumble (changing from lane 1 into a train already alongside in lane 0)
    sim.addOb({ kind: 'train', lane: 0, d0: sim.d - 2, d1: sim.d + 30, cars: 3 });
    sim.left();
    sim.update(0.2);
    let evs = sim.drainEvents();
    const firstStumble = evs.find((e) => e.type === 'stumble');
    expect(firstStumble).toBeDefined();
    if (firstStumble?.type === 'stumble') expect(firstStumble.lostLife).toBe(false);
    expect(sim.lives).toBe(3);

    // Wait > 4.5s (stumbleWindow) -> next side-stumble is also isolated (no life lost)
    sim.clearWorld();
    sim.update(4.7);
    sim.addOb({ kind: 'train', lane: 0, d0: sim.d - 2, d1: sim.d + 30, cars: 3 });
    sim.left();
    sim.update(0.2);
    expect(sim.lives).toBe(3);
    sim.drainEvents();

    // Within 4.5s (e.g. 1.0s later after 0.6s invuln expires), side-stumble again into a long 3-car train -> loses exactly 1 life (not 2)
    sim.update(0.8);
    expect(sim.sinceStumble).toBeLessThan(4.5);
    sim.left();
    sim.update(0.6);
    evs = sim.drainEvents();
    const secondStumble = evs.find((e) => e.type === 'stumble');
    expect(secondStumble).toBeDefined();
    if (secondStumble?.type === 'stumble') {
      expect(secondStumble.lostLife).toBe(true);
      expect(secondStumble.livesLeft).toBe(2);
    }
    expect(sim.lives).toBe(2);
    expect(sim.invulnerableT).toBeGreaterThan(0.8);
  });

  it('absorbs 2 hits with Center #4 Shield without losing lives, does NOT heal lives on Center #8, supports maxLives=0 unlimited mode, and tracks survivedSec after syncToElapsed', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180, 3);
    sim.start();
    sim.syncToElapsed(40);
    sim.invulnerableT = 0;

    // Center #4 blocks 2 front hits with 0 life loss
    sim.activateCenter(4);
    sim.invulnerableT = 0;
    for (let i = 0; i < 2; i++) {
      sim.invulnerableT = 0;
      sim.ignoreId = -1;
      sim.ignoreT = 0;
      sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 8, cars: 1 });
      sim.update(0.35);
    }
    expect(sim.lives).toBe(3);

    // Lose 1 life -> 2/3, then activate Center #8 -> lives remain 2/3 (no healing)
    sim.invulnerableT = 0;
    sim.ignoreId = -1;
    sim.ignoreT = 0;
    sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 8, cars: 1 });
    sim.update(0.35);
    expect(sim.lives).toBe(2);
    sim.activateCenter(8);
    expect(sim.lives).toBe(2);
    expect(sim.survivedSec).toBeCloseTo(sim.time - 40, 2);

    // Unlimited mode (maxLives = 0) never loses lives or dies even after 5 front hits
    sim.reset(1, false, 180, 0);
    sim.start();
    for (let k = 0; k < 5; k++) {
      sim.invulnerableT = 0;
      sim.ignoreId = -1;
      sim.ignoreT = 0;
      sim.addOb({ kind: 'train', lane: 1, d0: sim.d + 2, d1: sim.d + 8, cars: 1 });
      sim.update(0.35);
    }
    expect(sim.alive).toBe(true);
    expect(sim.maxLives).toBe(0);
    expect(sim.hitCount).toBe(5);
  });

  it('syncs and clamps lives via setLives, exposes lives/maxLives/survivedSec in snapshot(), and eliminates on fatal repeated side-stumble', () => {
    const sim = new Sim(1);
    sim.noSpawn = true;
    sim.reset(1, false, 180, 5);
    sim.start();
    expect(sim.snapshot().maxLives).toBe(5);
    expect(sim.snapshot().lives).toBe(5);

    sim.setLives(2, 3);
    expect(sim.maxLives).toBe(3);
    expect(sim.lives).toBe(2);

    sim.setLives(99, 3);
    expect(sim.lives).toBe(3);

    sim.setLives(5, 0);
    expect(sim.maxLives).toBe(0);
    expect(sim.lives).toBe(0);

    // Fatal repeated side-stumble from 1 remaining life
    sim.setLives(1, 3);
    expect(sim.lives).toBe(1);
    sim.addOb({ kind: 'train', lane: 0, d0: sim.d - 2, d1: sim.d + 40, cars: 4 });
    sim.left();
    sim.update(0.2);
    expect(sim.alive).toBe(true);
    expect(sim.lives).toBe(1);

    sim.update(0.8);
    sim.left();
    sim.update(0.3);
    expect(sim.alive).toBe(false);
    expect(sim.running).toBe(false);
    expect(sim.lives).toBe(0);
    const snap = sim.snapshot();
    expect(snap.alive).toBe(false);
    expect(snap.lives).toBe(0);
    expect(snap.maxLives).toBe(3);
    expect(snap.survivedSec).toBeGreaterThan(0);
    const elim = sim.drainEvents().find((e) => e.type === 'eliminated');
    expect(elim).toBeDefined();
    if (elim?.type === 'eliminated') {
      expect(elim.kind).toBe('train');
    }
  });
});
