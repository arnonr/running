import { describe, it, expect } from 'vitest';
import { Track, solve, type Spec } from '../src/sim/track';
import type { CenterId } from '../src/sim/types';
import { speedAt } from '../src/config';

describe('Track Generator & 9-Center Capsule Spawner', () => {
  it('generates solvable chunks up to 3400m and spawns all 9 Center pickups at least twice', () => {
    const obs: Spec[] = [];
    const pickups: { centerId: CenterId; lane: number; d: number; y: number }[] = [];
    const track = new Track(42, {
      ob: (s) => obs.push(s),
      coin: () => {},
      centerPickup: (centerId, lane, d, y) => pickups.push({ centerId, lane, d, y }),
    });
    track.reset(42, false);
    track.ensure(3400);

    // Every center 1..9 must appear at least twice across the 3-minute (~3200m) track
    for (let id = 1 as CenterId; id <= 9; id = (id + 1) as CenterId) {
      const matches = pickups.filter((p) => p.centerId === id);
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }

    // No pickup may overlap a solid train body in the same lane
    for (const p of pickups) {
      const overlapsTrain = obs.some(
        (o) => (o.kind === 'train' || o.kind === 'mtrain' || o.kind === 'ramp') &&
          o.lane === p.lane && p.d >= o.d0 - 2 && p.d <= o.d1 + 2
      );
      expect(overlapsTrain).toBe(false);
    }

    // Full path solve verification
    const res = solve(obs, 0, track.frontier, [1], speedAt, false);
    expect(res.ok).toBe(true);
  });
});
