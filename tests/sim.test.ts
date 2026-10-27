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
});
