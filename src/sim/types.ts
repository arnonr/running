export type ObKind = 'low' | 'hurdle' | 'overhead' | 'train' | 'ramp' | 'mtrain';
export type CenterId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type ZoneId = 1 | 2 | 3 | 4;
export type Hint = 'jump' | 'slide' | 'lane' | 'ramp';

export interface Ob {
  id: number;
  kind: ObKind;
  lane: number;
  d0: number; // near end (absolute distance along the track)
  d1: number; // far end
  yb: number; // solid from this height ...
  yt: number; // ... to this height
  halfW: number;
  walk: boolean; // can be stood on
  cars: number; // trains: number of cars
  variant: number;
  hint: Hint | null;
  hinted: boolean;
  meet: number; // moving trains: runner distance where they meet
  len: number; // moving trains: real length
  pd0: number; // where it was last step
  pd1: number;
}

export interface Coin {
  id: number;
  lane: number;
  d: number;
  y: number;
  x: number; // usually laneX(lane); moves when pulled by magnet
  pulled: boolean;
  bonus?: boolean;
}

export interface CenterPickup {
  id: number;
  centerId: CenterId;
  lane: number;
  d: number;
  y: number;
}

export type SimEvent =
  | { type: 'jump'; super: boolean }
  | { type: 'land'; fall: number }
  | { type: 'slide' }
  | { type: 'lane'; dir: number }
  | { type: 'bump'; dir: number }
  | { type: 'stumble'; x: number; y: number; penalty: number; lostLife?: boolean; livesLeft?: number; maxLives?: number }
  | { type: 'hit'; kind: ObKind; x: number; y: number; penalty: number; lostLife?: boolean; livesLeft?: number; maxLives?: number }
  | {
      type: 'eliminated';
      kind: ObKind;
      x: number;
      y: number;
      score: number;
      coins: number;
      distance: number;
      survivedSec: number;
      hitCount: number;
    }
  | { type: 'shieldBlock'; x: number; y: number; remaining: number }
  | { type: 'armorSmash'; kind: ObKind; x: number; y: number; bonus: number }
  | { type: 'coin'; x: number; y: number; streak: number }
  | { type: 'centerPower'; centerId: CenterId; x: number; y: number; firstTime: boolean }
  | { type: 'centerPowerEnd'; centerId: CenterId }
  | { type: 'floorChange'; floor: number; zoneId: ZoneId }
  | { type: 'centerStageChange'; centerId: CenterId; stageIndex: number; floor: number }
  | { type: 'finish'; score: number; coins: number; distance: number }
  | { type: 'hint'; hint: Hint };
