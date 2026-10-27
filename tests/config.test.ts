import { describe, it, expect } from 'vitest';
import {
  CENTERS, CENTER_LIST, DEFAULT_MATCH_DURATION, POWER_DURATION,
  floorAtProgress, zoneAtProgress, baseMultForFloor, speedAtProgress,
} from '../src/config';
import { Rng } from '../src/sim/rng';

describe('TechnoPark Config & RNG', () => {
  it('defines all 9 TechnoPark centers with 2 scheduled spawn times within 180s', () => {
    expect(CENTER_LIST).toHaveLength(9);
    for (let id = 1; id <= 9; id++) {
      const c = CENTERS[id as keyof typeof CENTERS];
      expect(c).toBeDefined();
      expect(c.nameTh.length).toBeGreaterThan(5);
      expect(c.spawnTimes[0]).toBeGreaterThan(5);
      expect(c.spawnTimes[1]).toBeGreaterThan(c.spawnTimes[0]);
      expect(c.spawnTimes[1]).toBeLessThan(DEFAULT_MATCH_DURATION - 5);
    }
    // Verify 4 centers exhibit on Floor 1
    const floor1Centers = CENTER_LIST.filter((c) => c.exhibitionFloorGroup === 1);
    expect(floor1Centers.map((c) => c.id)).toEqual([1, 3, 4, 5]);
    expect(POWER_DURATION).toBe(5.0);
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
});
