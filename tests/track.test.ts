import { describe, it, expect } from 'vitest';
import { Track } from '../src/sim/track';
import { CENTER_LIST, distanceAtTime } from '../src/config';
import type { CenterId } from '../src/sim/types';

describe('Track Generator & 9-Center Capsule Spawner', () => {
  it('generates solvable chunks up to 3400m and spawns all 9 Center pickups at least twice within reachable 180s distance', () => {
    const counts = new Map<CenterId, number>();
    const track = new Track(42, {
      ob: () => {},
      coin: () => {},
      centerPickup: (centerId) => {
        counts.set(centerId, (counts.get(centerId) || 0) + 1);
      },
    });
    const maxReachable = distanceAtTime(180, 180) * 0.92;
    track.ensure(maxReachable);
    expect(track.frontier).toBeGreaterThanOrEqual(maxReachable);
    expect(track.failures).toBe(0);
    for (const c of CENTER_LIST) {
      expect(counts.get(c.id) || 0).toBeGreaterThanOrEqual(2);
    }
  });

  it('scales Center pickup distances proportionally for 90s short rounds', () => {
    const counts = new Map<CenterId, number>();
    const track = new Track(99, {
      ob: () => {},
      coin: () => {},
      centerPickup: (centerId) => {
        counts.set(centerId, (counts.get(centerId) || 0) + 1);
      },
    });
    track.reset(99, false, 90);
    const maxReachable90 = distanceAtTime(90, 90) * 0.92;
    track.ensure(maxReachable90);
    for (const c of CENTER_LIST) {
      expect(counts.get(c.id) || 0).toBeGreaterThanOrEqual(2);
    }
  });
});
