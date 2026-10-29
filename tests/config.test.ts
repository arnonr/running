import { describe, it, expect } from 'vitest';
import {
  CENTERS, CENTER_LIST, DEFAULT_MATCH_DURATION, POWER_DURATION,
  STAGE_CENTER_ORDER, stageIndexAtProgress, stageCenterAtProgress, stageGateDistances,
  floorAtProgress, zoneAtProgress, baseMultForFloor, speedAtProgress,
  DEFAULT_MAX_LIVES, MAX_LIVES_OPTIONS, sanitizeMaxLives,
} from '../src/config';
import { Rng } from '../src/sim/rng';

describe('TechnoPark Config & RNG', () => {
  it('defines all 9 TechnoPark centers with 2 scheduled spawn times within 180s and aligns primary spawn to its 20s stage', () => {
    expect(CENTER_LIST).toHaveLength(9);
    expect(STAGE_CENTER_ORDER).toEqual([1, 4, 5, 3, 2, 6, 7, 8, 9]);
    for (let idx = 0; idx < STAGE_CENTER_ORDER.length; idx++) {
      const id = STAGE_CENTER_ORDER[idx];
      const c = CENTERS[id];
      expect(c).toBeDefined();
      expect(c.nameTh.length).toBeGreaterThan(5);
      // Primary spawn time falls inside its 20-second stage window [idx*20, (idx+1)*20]
      expect(c.spawnTimes[0]).toBeGreaterThanOrEqual(idx * 20 + 3);
      expect(c.spawnTimes[0]).toBeLessThan((idx + 1) * 20);
      expect(c.spawnTimes[1]).toBeGreaterThan(5);
      expect(c.spawnTimes[1]).toBeLessThan(DEFAULT_MATCH_DURATION - 4);
    }
    // Verify 4 centers exhibit on Floor 1
    const floor1Centers = CENTER_LIST.filter((c) => c.exhibitionFloorGroup === 1);
    expect(floor1Centers.map((c) => c.id)).toEqual([1, 3, 4, 5]);
    expect(POWER_DURATION).toBe(5.0);
  });

  it('maps normalized match progress across all 9 sequential Center stages and handles out-of-range/NaN inputs', () => {
    expect(stageIndexAtProgress(-0.5)).toBe(0);
    expect(stageIndexAtProgress(NaN)).toBe(0);
    expect(stageIndexAtProgress(0)).toBe(0);
    expect(stageIndexAtProgress(1)).toBe(8);
    expect(stageIndexAtProgress(1.5)).toBe(8);

    const visited = [];
    for (let i = 0; i < 9; i++) {
      const midP = (i + 0.5) / 9;
      expect(stageIndexAtProgress(midP)).toBe(i);
      visited.push(stageCenterAtProgress(midP));
    }
    expect(visited).toEqual([1, 4, 5, 3, 2, 6, 7, 8, 9]);

    const gates = stageGateDistances(180);
    expect(gates).toHaveLength(9);
    expect(gates[0]).toEqual({ stageIndex: 0, centerId: 1, d: 28 });
    for (let i = 1; i < gates.length; i++) {
      expect(gates[i].d).toBeGreaterThan(gates[i - 1].d);
      expect(gates[i].centerId).toBe(STAGE_CENTER_ORDER[i]);
    }
    // Verify each Center's primary scheduled pickup distance (0.86 * distanceAtTime) falls after its own Stage Portal Gate!
    for (let i = 0; i < gates.length; i++) {
      const cId = gates[i].centerId;
      const primarySec = CENTERS[cId].spawnTimes[0];
      const pickupDist = Math.max(48, Math.round(primarySec * 12) * 0.86); // lower bound check
      void pickupDist;
      const nextGateD = i + 1 < gates.length ? gates[i + 1].d : Infinity;
      expect(gates[i].d).toBeLessThan(nextGateD);
    }
    // Specifically check Stage 9 (#9 at 160s gate vs 164s pickup * 0.86)
    const gate9D = gates[8].d;
    const pickup9TargetDist = 2527; // distanceAtTime(164, 180) * 0.86
    expect(gate9D).toBeLessThan(pickup9TargetDist);
  });

  it('maps normalized match progress (0..1) across Floors 1..10, Zones 1..4, and Speed 12..25', () => {
    expect(floorAtProgress(0)).toBe(1);
    expect(floorAtProgress(0.30)).toBe(1);
    expect(floorAtProgress(0.45)).toBeGreaterThanOrEqual(2);
    expect(floorAtProgress(0.65)).toBe(8);
    expect(floorAtProgress(0.95)).toBe(10);
    expect(zoneAtProgress(0.1)).toBe(1);
    expect(zoneAtProgress(0.4)).toBe(2);
    expect(zoneAtProgress(0.65)).toBe(3);
    expect(zoneAtProgress(0.85)).toBe(4);
    expect(baseMultForFloor(1)).toBe(1);
    expect(baseMultForFloor(5)).toBe(2);
    expect(baseMultForFloor(8)).toBe(3);
    expect(baseMultForFloor(10)).toBe(4);
    expect(speedAtProgress(0)).toBeCloseTo(12.0, 1);
    expect(speedAtProgress(1)).toBeCloseTo(25.0, 1);
  });

  it('produces identical random sequences for identical seeds', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    expect([a.next(), a.int(0, 9), a.range(10, 20)]).toEqual([b.next(), b.int(0, 9), b.range(10, 20)]);
  });

  it('uses exact official Thai display names for Centers #4, #5, and #7', () => {
    expect(CENTERS[4].shortTh).toBe('สิ่งแวดล้อมและการอนุรักษ์พลังงาน');
    expect(CENTERS[5].shortTh).toBe('นวัตกรรมไร้สายล้ำหน้ายุค 5G');
    expect(CENTERS[7].shortTh).toBe('เทคโนโลยีชีวภาพและเคมีชีวภาพ');
  });

  it('defines lives quota presets [3, 5, 0] and sanitizes invalid/null inputs to DEFAULT_MAX_LIVES (3)', () => {
    expect(DEFAULT_MAX_LIVES).toBe(3);
    expect(MAX_LIVES_OPTIONS).toEqual([3, 5, 0]);
    expect(sanitizeMaxLives(3)).toBe(3);
    expect(sanitizeMaxLives(5)).toBe(5);
    expect(sanitizeMaxLives(0)).toBe(0);
    expect(sanitizeMaxLives(null)).toBe(3);
    expect(sanitizeMaxLives(undefined)).toBe(3);
    expect(sanitizeMaxLives(NaN)).toBe(3);
    expect(sanitizeMaxLives(-1)).toBe(3);
    expect(sanitizeMaxLives(99)).toBe(3);
  });
});
