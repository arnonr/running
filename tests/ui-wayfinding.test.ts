import { describe, it, expect } from 'vitest';
import { groupCentersByExhibitionFloor } from '../src/ui';

describe('Smart Wayfinding Exhibition Directory Grouping', () => {
  it('groups all 9 TechnoPark centers into actual exhibition floors (1, 2, 8, 9, 10) and marks unlocked centers', () => {
    const groups = groupCentersByExhibitionFloor([1, 3, 6, 9]);
    expect(groups.map((g) => g.floor)).toEqual([1, 2, 8, 9, 10]);

    const floor1 = groups.find((g) => g.floor === 1)!;
    expect(floor1.centers.map((c) => c.id)).toEqual([1, 3, 4, 5]);
    expect(floor1.centers.find((c) => c.id === 1)?.unlocked).toBe(true);
    expect(floor1.centers.find((c) => c.id === 4)?.unlocked).toBe(false);

    const floor8 = groups.find((g) => g.floor === 8)!;
    expect(floor8.centers.map((c) => c.id)).toEqual([6, 7]);
    expect(floor8.centers.find((c) => c.id === 6)?.unlocked).toBe(true);

    expect(floor1.centers.find((c) => c.id === 4)?.shortTh).toBe('สิ่งแวดล้อมและการอนุรักษ์พลังงาน');
    expect(floor1.centers.find((c) => c.id === 5)?.shortTh).toBe('นวัตกรรมไร้สายล้ำหน้ายุค 5G');
    expect(floor8.centers.find((c) => c.id === 7)?.shortTh).toBe('เทคโนโลยีชีวภาพและเคมีชีวภาพ');
  });
});
