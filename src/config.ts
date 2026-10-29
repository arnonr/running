import type { CenterId, ZoneId } from './sim/types';

export const GAME_TITLE = {
  en: 'TECHNO SURFERS 3D: 10 Floors to Space',
  th: 'เทคโนเซิร์ฟเฟอร์ 3D: วิ่งทะลุมิติ พิชิต 9 ศูนย์นวัตกรรม',
};

export const DEFAULT_MATCH_DURATION = 180; // 3 minutes (180 seconds)
export const POWER_DURATION = 5.0; // 5 seconds per Center power-up
export const PICKUP_PULL_RANGE = 2.2; // generous pull radius so players rarely miss capsules

export const LANE_W = 2.5;
export const LANE_COUNT = 3;
export const laneX = (lane: number) => (lane - 1) * LANE_W;

export const PLAYER = {
  halfW: 0.32,
  halfD: 0.3,
  height: 1.7,
  slideHeight: 0.8,
  laneTime: 0.15, // seconds for a lane change
  jumpHeight: 1.75,
  jumpApexTime: 0.34,
  superJumpHeight: 4.0,
  fastFallSpeed: 26,
  slideTime: 0.62,
  coyote: 0.11,
  buffer: 0.16,
  stepUp: 0.45,
  grazeX: 0.85,
  feetTol: 0.12,
  headTol: 0.12,
  stumbleWindow: 4.5,
  frontHitPenalty: 50,
  sideHitPenalty: 20,
  frontHitSlowDuration: 1.2,
  frontHitInvulnDuration: 1.5,
};

export const GRAVITY = (2 * PLAYER.jumpHeight) / (PLAYER.jumpApexTime * PLAYER.jumpApexTime);
export const JUMP_V = GRAVITY * PLAYER.jumpApexTime;
export const SUPER_JUMP_V = Math.sqrt(2 * GRAVITY * PLAYER.superJumpHeight);

export const SPEED = { start: 12.0, max: 25.0, ramp: 2600 };
export const speedAt = (d: number) =>
  SPEED.start + (SPEED.max - SPEED.start) * (1 - Math.exp(-Math.max(0, d) / SPEED.ramp));
export const levelAt = (d: number) => Math.min(1, Math.max(0, d) / 3200);

export const STAGE_CENTER_ORDER: readonly CenterId[] = [1, 4, 5, 3, 2, 6, 7, 8, 9];

export function stageIndexAtProgress(progress01: number): number {
  const safe = Number.isFinite(progress01) ? progress01 : 0;
  const p = Math.max(0, Math.min(0.999999, safe));
  return Math.min(8, Math.floor(p * 9));
}

export function stageCenterAtProgress(progress01: number): CenterId {
  return STAGE_CENTER_ORDER[stageIndexAtProgress(progress01)];
}

export function speedAtProgress(progress01: number): number {
  const safe = Number.isFinite(progress01) ? progress01 : 0;
  const p = Math.max(0, Math.min(1, safe));
  return SPEED.start + (SPEED.max - SPEED.start) * p;
}

export function zoneAtProgress(progress01: number): ZoneId {
  const safe = Number.isFinite(progress01) ? progress01 : 0;
  const p = Math.max(0, Math.min(1, safe));
  if (p < 1 / 3) return 1; // 0:00 - 1:00 (Floor 1)
  if (p < 5 / 9) return 2; // 1:00 - 1:40 (Floors 2 - 6)
  if (p < 7 / 9) return 3; // 1:40 - 2:20 (Floor 8)
  return 4; // 2:20 - 3:00 (Floors 9 - 10)
}

export function floorAtProgress(progress01: number): number {
  const safe = Number.isFinite(progress01) ? progress01 : 0;
  const p = Math.max(0, Math.min(1, safe));
  if (p < 1 / 3) return 1; // 0 - 60s -> Floor 1
  if (p < 5 / 9) {
    // 60 - 100s -> Floors 2..6 (and 7 transition)
    const sub = (p - 1 / 3) / (2 / 9);
    return Math.min(7, 2 + Math.floor(sub * 5.2));
  }
  if (p < 7 / 9) return 8; // 100 - 140s -> Floor 8
  const sub = (p - 7 / 9) / (2 / 9);
  return sub < 0.45 ? 9 : 10; // 140 - 180s -> Floor 9 then Floor 10
}

export function baseMultForFloor(floor: number): number {
  if (floor <= 3) return 1;
  if (floor <= 7) return 2;
  if (floor <= 9) return 3;
  return 4;
}

export function distanceAtTime(sec: number, totalDuration = DEFAULT_MATCH_DURATION): number {
  // Integral of linear speed ramp from SPEED.start (12) to SPEED.max (25) over totalDuration
  const t = Math.max(0, Math.min(totalDuration, sec));
  const p = totalDuration > 0 ? t / totalDuration : 0;
  const vEnd = speedAtProgress(p);
  return 0.5 * (SPEED.start + vEnd) * t;
}

export function stageGateDistances(
  matchDuration = DEFAULT_MATCH_DURATION,
): Array<{ stageIndex: number; centerId: CenterId; d: number }> {
  const dur = Math.max(10, Number.isFinite(matchDuration) ? matchDuration : DEFAULT_MATCH_DURATION);
  return STAGE_CENTER_ORDER.map((centerId, stageIndex) => ({
    stageIndex,
    centerId,
    d: stageIndex === 0 ? 28 : Math.round(distanceAtTime((stageIndex / 9) * dur, dur) * 0.86),
  }));
}

export const OB = {
  low: { halfW: 1.05, depth: 0.7, yb: 0, yt: 0.95, walk: true },
  hurdle: { halfW: 1.1, depth: 0.35, yb: 0.95, yt: 1.25, walk: false },
  overhead: { halfW: 1.15, depth: 0.35, yb: 1.1, yt: 2.65, walk: false },
  train: { halfW: 1.15, depth: 6.74, yb: 0, yt: 3.4, walk: true },
  ramp: { halfW: 1.15, depth: 7, yb: 0, yt: 3.4, walk: true },
  mtrain: { halfW: 1.15, depth: 6.74, yb: 0, yt: 3.4, walk: false },
} as const;

export const MOVER = { ratio: 0.6, trigger: 70 };
export const moverFront = (meet: number, d: number) =>
  meet + MOVER.ratio * Math.min(MOVER.trigger, meet - d);
export const moverSpan = (len: number) => len / (1 + MOVER.ratio);
export const CAR_LEN = 6.74;
export const CAR_GAP = 0.3;
export const trainLength = (cars: number) => cars * CAR_LEN + (cars - 1) * CAR_GAP;

export const MAGNET_RANGE = 22;
export const VIEW_AHEAD = 210;

export interface CenterMeta {
  id: CenterId;
  nameTh: string;
  shortTh: string;
  exhibitionFloorTh: string;
  exhibitionFloorGroup: 1 | 2 | 8 | 9 | 10;
  powerName: string;
  powerDescTh: string;
  color: string;
  icon: string;
  zoneId: ZoneId;
  spawnTimes: [number, number];
}

export const CENTERS: Record<CenterId, CenterMeta> = {
  1: {
    id: 1,
    nameTh: 'ศูนย์ปฏิบัติการเทคโนโลยีอากาศยานและการป้องกันประเทศ',
    shortTh: 'อากาศยานและป้องกันประเทศ',
    exhibitionFloorTh: 'ชั้น 1 (โถงนิทรรศการหลัก)',
    exhibitionFloorGroup: 1,
    powerName: 'Jet Fighter Pack',
    powerDescTh: 'ติดไอพ่นเครื่องบินรบบินลอยเหนือพื้นราง เก็บเหรียญกลางอากาศไม่ต้องกลัวชน!',
    color: '#38bdf8',
    icon: '✈️',
    zoneId: 1,
    spawnTimes: [6, 95],
  },
  2: {
    id: 2,
    nameTh: 'ศูนย์ปฏิบัติการระบบอัตโนมัติและหุ่นยนต์',
    shortTh: 'ระบบอัตโนมัติและหุ่นยนต์',
    exhibitionFloorTh: 'ชั้น 2 (โรงประลองหุ่นยนต์)',
    exhibitionFloorGroup: 2,
    powerName: 'Robo-Wingman Drones',
    powerDescTh: 'เรียกโดรนขนาบซ้าย-ขวา เก็บเหรียญครบ 3 เลน พร้อมยิงเลเซอร์สลายแผงกั้น!',
    color: '#fb923c',
    icon: '🤖',
    zoneId: 2,
    spawnTimes: [85, 34],
  },
  3: {
    id: 3,
    nameTh: 'ศูนย์ปฏิบัติการเทคโนโลยีนวัตกรรมยานยนต์สมัยใหม่และระบบขนส่งทางราง',
    shortTh: 'ยานยนต์สมัยใหม่และระบบราง',
    exhibitionFloorTh: 'ชั้น 6 (ชมบูธนิทรรศการได้ที่ ชั้น 1)',
    exhibitionFloorGroup: 1,
    powerName: 'EV Express Train Armor',
    powerDescTh: 'สวมเกราะหัวรถไฟความเร็วสูง พุ่งชนรถไฟและแผงกั้นให้กระเด็นพร้อมรับโบนัส +100!',
    color: '#facc15',
    icon: '🚄',
    zoneId: 1,
    spawnTimes: [65, 150],
  },
  4: {
    id: 4,
    nameTh: 'ศูนย์ปฏิบัติการสิ่งแวดล้อมและการอนุรักษ์พลังงาน',
    shortTh: 'สิ่งแวดล้อมและพลังงานสะอาด',
    exhibitionFloorTh: 'จัดแสดงที่ ชั้น 1 (โถงนิทรรศการหลัก)',
    exhibitionFloorGroup: 1,
    powerName: 'Green Energy Shield',
    powerDescTh: 'โดมพลังงานสะอาดสีเขียว ป้องกันการชนได้ 2 ครั้ง พร้อมเสกเหรียญพลังงานสะอาด!',
    color: '#4ade80',
    icon: '🌿',
    zoneId: 1,
    spawnTimes: [25, 115],
  },
  5: {
    id: 5,
    nameTh: 'ศูนย์ปฏิบัติการนวัตกรรมไร้สายล้ำหน้ายุค 5G',
    shortTh: 'นวัตกรรมไร้สาย 5G',
    exhibitionFloorTh: 'จัดแสดงที่ ชั้น 1 (โถงนิทรรศการหลัก)',
    exhibitionFloorGroup: 1,
    powerName: '5G Super Magnet',
    powerDescTh: 'ปล่อยคลื่นความถี่ 5G ดูดเหรียญจากทั้ง 3 เลนและบนหลังคารถไฟเข้าหาตัวอัตโนมัติ!',
    color: '#c084fc',
    icon: '📡',
    zoneId: 1,
    spawnTimes: [45, 135],
  },
  6: {
    id: 6,
    nameTh: 'ศูนย์ปฏิบัติการเทคโนโลยีเรดาร์',
    shortTh: 'เทคโนโลยีเรดาร์',
    exhibitionFloorTh: 'ชั้น 8 (ห้องปฏิบัติการเรดาร์)',
    exhibitionFloorGroup: 8,
    powerName: 'Radar Path Scanner',
    powerDescTh: 'ปล่อยคลื่นเรดาร์สแกนไปข้างหน้า เปลี่ยนแผงกั้นทั้ง 3 เลนให้กลายเป็นเหรียญทอง!',
    color: '#2dd4bf',
    icon: '🛰️',
    zoneId: 3,
    spawnTimes: [105, 54],
  },
  7: {
    id: 7,
    nameTh: 'ศูนย์ปฏิบัติการเทคโนโลยีชีวภาพและเคมีชีวภาพ',
    shortTh: 'เทคโนโลยีชีวภาพและเคมี',
    exhibitionFloorTh: 'ชั้น 8 (แล็บชีวภาพและเคมีชีวภาพ)',
    exhibitionFloorGroup: 8,
    powerName: 'Bio-Chem Bouncer Boots',
    powerDescTh: 'ออร่าเกลียว DNA กระโดดสูงพิเศษขึ้นหลังคารถไฟในครั้งเดียว พร้อมแต้มคูณสอง (×2)!',
    color: '#a3e635',
    icon: '🧬',
    zoneId: 3,
    spawnTimes: [125, 74],
  },
  8: {
    id: 8,
    nameTh: 'ศูนย์ปฏิบัติการเทคโนโลยีและนวัตกรรมเครื่องมือแพทย์',
    shortTh: 'นวัตกรรมเครื่องมือแพทย์',
    exhibitionFloorTh: 'ชั้น 9 (แล็บเครื่องมือแพทย์)',
    exhibitionFloorGroup: 9,
    powerName: 'Med-Tech Recovery Drone',
    powerDescTh: 'โดรนการแพทย์ฟื้นฟูสถานะทันที บวกโบนัส +500 แต้ม และโปรยแคปซูลคะแนนก้อนใหญ่!',
    color: '#fb7185',
    icon: '➕',
    zoneId: 4,
    spawnTimes: [145, 15],
  },
  9: {
    id: 9,
    nameTh: 'สถาบันเทคโนโลยีอวกาศนานาชาติเพื่อการพัฒนาเศรษฐกิจ',
    shortTh: 'สถาบันเทคโนโลยีอวกาศฯ',
    exhibitionFloorTh: 'ชั้น 10 (รันเวย์อวกาศและดาวเทียม)',
    exhibitionFloorGroup: 10,
    powerName: 'Space Rocket Fever',
    powerDescTh: 'ติดจรวดอวกาศพุ่งทะยานความเร็วสูงสุด เหรียญทั้ง 3 เลนเปลี่ยนเป็นดวงดาวแต้ม ×3!',
    color: '#f472b6',
    icon: '🚀',
    zoneId: 4,
    spawnTimes: [164, 173],
  },
};

export const CENTER_LIST: CenterMeta[] = [
  CENTERS[1],
  CENTERS[2],
  CENTERS[3],
  CENTERS[4],
  CENTERS[5],
  CENTERS[6],
  CENTERS[7],
  CENTERS[8],
  CENTERS[9],
];

export interface TvClockState {
  elapsed: number;
  d: number;
  speed: number;
  floor: number;
  progress01: number;
  stageIndex: number;
  stageCenter: CenterId;
}

/**
 * Advances the TV Live Arena timeline smoothly at 60 FPS (`dt`) while gently correcting drift
 * toward the 10 Hz (`100ms`) room snapshot (`phaseTimeLeft`), preventing 10 FPS track stepping.
 */
export function stepTvClock(
  prevElapsed: number,
  dt: number,
  phase: string,
  phaseTimeLeft: number,
  matchDuration: number,
): TvClockState {
  if (phase !== 'RUNNING' || matchDuration <= 0) {
    return {
      elapsed: 0,
      d: 0,
      speed: 0,
      floor: 1,
      progress01: 0,
      stageIndex: 0,
      stageCenter: STAGE_CENTER_ORDER[0],
    };
  }

  const targetElapsed = Math.max(0, Math.min(matchDuration, matchDuration - Math.max(0, phaseTimeLeft)));
  const safeDt = Math.max(0, dt);
  const drift = targetElapsed - (prevElapsed + safeDt);
  let next: number;
  if (Math.abs(drift) > 1.5) {
    next = targetElapsed;
  } else {
    const rate = Math.max(0.8, Math.min(1.2, 1 + drift * 2.0));
    next = Math.max(prevElapsed, prevElapsed + safeDt * rate);
  }

  const elapsed = Math.max(0, Math.min(matchDuration, next));
  const progress01 = elapsed / matchDuration;
  return {
    elapsed,
    d: distanceAtTime(elapsed, matchDuration),
    speed: speedAtProgress(progress01),
    floor: floorAtProgress(progress01),
    progress01,
    stageIndex: stageIndexAtProgress(progress01),
    stageCenter: stageCenterAtProgress(progress01),
  };
}
