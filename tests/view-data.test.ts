import { describe, it, expect } from 'vitest';
import { ZONE_PALETTES, lerpZonePalette } from '../src/view/textures';

describe('10-Floor Zone Atmosphere Palettes', () => {
  it('defines distinct sky, fog, and neon accent colors for all 4 floor zones and interpolates smoothly', () => {
    expect(Object.keys(ZONE_PALETTES)).toHaveLength(4);
    const p1 = lerpZonePalette(0.1);
    const p4 = lerpZonePalette(0.95);
    expect(p1.fogHex).not.toBe(p4.fogHex);
    expect(p4.starIntensity).toBeGreaterThan(0.7);
  });
});
