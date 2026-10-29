import { describe, it, expect } from 'vitest';
import {
  ZONE_PALETTES,
  lerpZonePalette,
  CENTER_BIOMES,
  lerpCenterBiome,
  centerGateBannerTexture,
  centerBillboardTexture,
  centerCapsuleTexture,
} from '../src/view/textures';
import { SCENERY_POOL_LIMITS } from '../src/view/world';
import { STAGE_CENTER_ORDER, VIEW_AHEAD } from '../src/config';

describe('10-Floor Zone & 9-Center Open-Horizon Biome Palettes', () => {
  it('defines distinct sky, fog, and neon accent colors for all 4 floor zones and interpolates smoothly', () => {
    expect(Object.keys(ZONE_PALETTES)).toHaveLength(4);
    const p1 = lerpZonePalette(0.1);
    const p4 = lerpZonePalette(0.95);
    expect(p1.fogHex).not.toBe(p4.fogHex);
    expect(p4.starIntensity).toBeGreaterThan(0.7);
  });

  it('defines 9 distinct CenterBiomePalettes and interpolates across STAGE_CENTER_ORDER safely', () => {
    expect(Object.keys(CENTER_BIOMES)).toHaveLength(9);
    const horizonSet = new Set<string>();
    for (const id of STAGE_CENTER_ORDER) {
      const b = CENTER_BIOMES[id];
      expect(b).toBeDefined();
      expect(b.skyTopHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(b.skyMidHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(b.skyHorizonHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(b.groundTintHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(b.trackTintHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      horizonSet.add(b.skyHorizonHex);
    }
    expect(horizonSet.size).toBe(9);

    // Check safe clamping for negative, >1, and NaN progress values
    for (const p of [-1, 0, 0.25, 0.5, 0.75, 1, 2, NaN]) {
      const pal = lerpCenterBiome(p);
      expect(pal.skyTopHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(pal.skyHorizonHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(pal.groundTintHex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }

    // Check stage progression matches STAGE_CENTER_ORDER
    for (let i = 0; i < 9; i++) {
      const pal = lerpCenterBiome((i + 0.3) / 9);
      expect(pal.centerId).toBe(STAGE_CENTER_ORDER[i]);
    }
  });

  it('allocates sufficient InstancedMesh pool capacities for all 18m/36m slots across VIEW_AHEAD so kinetic parts never detach', () => {
    const maxSlots18m = Math.ceil((VIEW_AHEAD + 16) / 18) + 1;
    const minStaticNeeded = maxSlots18m * 2 + Math.ceil(maxSlots18m / 2) * 2;
    const minKineticNeeded = maxSlots18m * 2;
    const minBillboardsNeeded = Math.ceil((VIEW_AHEAD + 18) / 36) + 1;

    expect(SCENERY_POOL_LIMITS.staticPerCenter).toBeGreaterThanOrEqual(minStaticNeeded);
    expect(SCENERY_POOL_LIMITS.kineticPerCenter).toBeGreaterThanOrEqual(minKineticNeeded);
    expect(SCENERY_POOL_LIMITS.billboardsPerCenter).toBeGreaterThanOrEqual(minBillboardsNeeded);
  });

  it('aligns CENTER_BIOMES stage titles for #4, #5, #7 and bounds 3D signage fillText width without mid-word slicing', () => {
    expect(CENTER_BIOMES[4].stageTitleTh).toContain('สิ่งแวดล้อมและการอนุรักษ์พลังงาน');
    expect(CENTER_BIOMES[5].stageTitleTh).toContain('นวัตกรรมไร้สายล้ำหน้ายุค 5G');
    expect(CENTER_BIOMES[7].stageTitleTh).toContain('เทคโนโลยีชีวภาพและเคมีชีวภาพ');

    const fillCalls: Array<{ text: string; maxWidth?: number }> = [];
    const prevDoc = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: () => {
        const ctx: any = new Proxy(
          {
            fillText: (text: string, _x: number, _y: number, maxWidth?: number) => {
              fillCalls.push({ text, maxWidth });
            },
            createLinearGradient: () => ({ addColorStop: () => {} }),
            createRadialGradient: () => ({ addColorStop: () => {} }),
          },
          {
            get: (target, prop) => (prop in target ? target[prop] : () => ctx),
            set: () => true,
          },
        );
        return { width: 0, height: 0, getContext: () => ctx };
      },
    };
    try {
      for (const id of [4, 5, 7] as const) {
        expect(centerGateBannerTexture(id, 2)).toBeDefined();
        expect(centerBillboardTexture(id)).toBeDefined();
        expect(centerCapsuleTexture(id)).toBeDefined();
      }
    } finally {
      (globalThis as any).document = prevDoc;
    }

    const nameCalls = fillCalls.filter(
      (c) =>
        c.text.includes('สิ่งแวดล้อมและการอนุรักษ์พลังงาน') ||
        c.text.includes('นวัตกรรมไร้สายล้ำหน้ายุค 5G') ||
        c.text.includes('เทคโนโลยีชีวภาพและเคมีชีวภาพ'),
    );
    // Gate + Billboard + Capsule for each of #4, #5, #7 = 9 calls, all with numeric maxWidth!
    expect(nameCalls).toHaveLength(9);
    for (const call of nameCalls) {
      expect(typeof call.maxWidth).toBe('number');
      expect(call.maxWidth!).toBeGreaterThan(100);
    }
  });
});
