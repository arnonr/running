// The game rules, with no three.js in it: the runner, obstacles, coins, 9-Center power-ups, 180s timer, and score.
import {
  PLAYER, GRAVITY, JUMP_V, SUPER_JUMP_V, OB, laneX, speedAtProgress, MAGNET_RANGE, VIEW_AHEAD, LANE_COUNT,
  trainLength, moverFront, moverSpan, DEFAULT_MATCH_DURATION, POWER_DURATION, PICKUP_PULL_RANGE,
  floorAtProgress, zoneAtProgress, baseMultForFloor, stageIndexAtProgress, stageCenterAtProgress,
  distanceAtTime,
} from '../config';
import type { Ob, Coin, CenterPickup, SimEvent, ObKind, Hint, CenterId, ZoneId } from './types';
import { Track, type Spec } from './track';
export type { Spec };

const MAX_STEP = 1 / 120;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);

export interface SimSnapshot {
  lane: number;
  x: number;
  y: number;
  vy: number;
  d: number;
  speed: number;
  grounded: boolean;
  sliding: boolean;
  alive: boolean;
  running: boolean;
  finished: boolean;
  floor: number;
  zoneId: ZoneId;
  stageIndex: number;
  stageCenter: CenterId;
  time: number;
  timeLeft: number;
  progress01: number;
  coins: number;
  score: number;
  mult: number;
  hitCount: number;
  activeCenter: CenterId | null;
  centerTimer: number;
  shieldHits: number;
  invulnerableT: number;
  collectedCenters: CenterId[];
  sinceStumble: number;
  groundY: number;
  obs: number;
  coinCount: number;
  pickups: number;
  created: { obs: number; coins: number; pickups: number };
  pooled: { obs: number; coins: number; pickups: number };
}

export class Sim {
  // runner
  lane = 1;
  fromX = 0;
  laneT = 1;
  x = 0;
  y = 0;
  vy = 0;
  grounded = true;
  groundY = 0;
  slideT = 0;
  fastFall = false;
  slideQueued = false;
  coyoteT = 0;
  jumpBufT = 0;
  d = 0;
  speed = 0;
  alive = true;
  running = false;
  finished = false;
  time = 0;
  matchDuration = DEFAULT_MATCH_DURATION;
  floor = 1;
  zoneId: ZoneId = 1;
  stageIndex = 0;
  stageCenter: CenterId = 1;
  sinceStumble = 99;
  stumbleSlow = 0;
  frontHitSlow = false;
  invulnerableT = 0;
  hitCount = 0;
  ignoreId = -1;
  ignoreT = 0;
  airTime = 0;
  peakY = 0;

  // pickups / score / 9 Centers
  coins = 0;
  coinStreak = 0;
  coinStreakT = 0;
  score = 0;
  baseMult = 1;
  activeCenter: CenterId | null = null;
  centerTimer = 0;
  shieldHits = 0;
  collectedCenters: Set<CenterId> = new Set();

  // world
  obs: Ob[] = [];
  coinList: Coin[] = [];
  pickups: CenterPickup[] = [];
  events: SimEvent[] = [];
  track: Track;
  invincible = false; // test switch
  noSpawn = false; // test switch
  speedOverride = 0;
  private nextId = 1;

  // pools
  private freeObs: Ob[] = [];
  private freeCoins: Coin[] = [];
  private freePickups: CenterPickup[] = [];
  created = { obs: 0, coins: 0, pickups: 0 };

  constructor(seed = 1) {
    this.track = new Track(seed, {
      ob: (s) => this.addOb(s),
      coin: (lane, d, y) => this.addCoin(lane, d, y),
      centerPickup: (centerId, lane, d, y) => this.addCenterPickup(centerId, lane, d, y),
    });
  }

  get timeLeft(): number {
    return Math.max(0, this.matchDuration - this.time);
  }

  get progress01(): number {
    return Math.max(0, Math.min(1, this.time / Math.max(1, this.matchDuration)));
  }

  reset(seed: number, tutorial = false, matchDuration = DEFAULT_MATCH_DURATION) {
    for (const o of this.obs) this.freeObs.push(o);
    for (const c of this.coinList) this.freeCoins.push(c);
    for (const cp of this.pickups) this.freePickups.push(cp);
    this.obs.length = 0;
    this.coinList.length = 0;
    this.pickups.length = 0;
    this.events.length = 0;
    this.collectedCenters.clear();
    Object.assign(this, {
      lane: 1, fromX: 0, laneT: 1, x: 0, y: 0, vy: 0, grounded: true, groundY: 0, slideT: 0, fastFall: false,
      slideQueued: false, coyoteT: 0, jumpBufT: 0, d: 0, speed: 0, alive: true, running: false, finished: false,
      time: 0, matchDuration, floor: 1, zoneId: 1 as ZoneId, stageIndex: 0, stageCenter: 1 as CenterId,
      sinceStumble: 99, stumbleSlow: 0, frontHitSlow: false, invulnerableT: 0, hitCount: 0,
      ignoreId: -1, ignoreT: 0, airTime: 0, peakY: 0, coins: 0, coinStreak: 0,
      coinStreakT: 0, score: 0, baseMult: 1, activeCenter: null, centerTimer: 0, shieldHits: 0,
    });
    this.track.reset(seed, tutorial, matchDuration);
    if (!this.noSpawn) this.track.ensure(VIEW_AHEAD);
  }

  // ------------------------------------------------------------------ pools
  addOb(s: Spec): Ob {
    const o = this.freeObs.pop() || ({} as Ob);
    if (!o.id) this.created.obs++;
    const shape = OB[s.kind];
    Object.assign(o, {
      id: this.nextId++, kind: s.kind, lane: s.lane, d0: s.d0, d1: s.d1, yb: shape.yb, yt: shape.yt, halfW: shape.halfW,
      walk: shape.walk, cars: s.cars || 1, variant: s.variant || 0, hint: s.hint || null, hinted: false, meet: 0, len: 0,
      pd0: s.d0, pd1: s.d1,
    });
    if (s.kind === 'mtrain') {
      o.meet = s.d0;
      o.len = trainLength(o.cars);
      this.placeMover(o);
      o.pd0 = o.d0;
      o.pd1 = o.d1;
    }
    this.obs.push(o);
    return o;
  }

  addCoin(lane: number, d: number, y: number, bonus = false) {
    const c = this.freeCoins.pop() || ({} as Coin);
    if (!c.id) this.created.coins++;
    Object.assign(c, { id: this.nextId++, lane, d, y, x: laneX(lane), pulled: false, bonus });
    this.coinList.push(c);
  }

  addCenterPickup(centerId: CenterId, lane: number, d: number, y: number) {
    const cp = this.freePickups.pop() || ({} as CenterPickup);
    if (!cp.id) this.created.pickups++;
    Object.assign(cp, { id: this.nextId++, centerId, lane, d, y });
    this.pickups.push(cp);
  }

  private placeMover(o: Ob) {
    o.d0 = moverFront(o.meet, this.d);
    o.d1 = o.d0 + o.len;
  }

  static specOf(o: Ob): Spec {
    if (o.kind === 'mtrain') return { kind: 'mtrain', lane: o.lane, d0: o.meet, d1: o.meet + moverSpan(o.len), cars: o.cars };
    return { kind: o.kind, lane: o.lane, d0: o.d0, d1: o.d1, cars: o.cars };
  }

  clearWorld() {
    for (const o of this.obs) this.freeObs.push(o);
    for (const c of this.coinList) this.freeCoins.push(c);
    for (const cp of this.pickups) this.freePickups.push(cp);
    this.obs.length = 0;
    this.coinList.length = 0;
    this.pickups.length = 0;
  }

  // ------------------------------------------------------------------ 9 Center Abilities
  activateCenter(centerId: CenterId) {
    const firstTime = !this.collectedCenters.has(centerId);
    const wasAirborne = this.activeCenter === 1 || !this.grounded;
    this.collectedCenters.add(centerId);
    this.activeCenter = centerId;
    this.centerTimer = POWER_DURATION;
    this.shieldHits = centerId === 4 ? 2 : 0;
    // Review Focus #3 & Spec 5.2: grant >= 1.0s invulnerability (1.5s if switching from airborne)
    this.invulnerableT = Math.max(this.invulnerableT, wasAirborne ? 1.5 : 1.0);
    const pickupBonus = firstTime ? 300 : 150;
    this.events.push({ type: 'centerPower', centerId, x: this.x, y: this.y, firstTime });

    switch (centerId) {
      case 1: // Jet Fighter Pack: fly high above obstacles + speed boost
        this.grounded = false;
        this.vy = 0;
        this.y = Math.max(this.y, 4.2);
        this.slideT = 0;
        this.score += pickupBonus;
        break;
      case 2: // Robo-Wingman Drones: laser-destroys barriers within 28m for +50 pts + 3-lane magnet
        this.score += pickupBonus;
        this.laserDestroyBarriers();
        break;
      case 3: // EV Express Train Armor: smash obstacles for +100 bonus
        this.score += pickupBonus;
        break;
      case 4: // Green Energy Shield: blocks up to 2 hits + spawns green energy coins
        this.shieldHits = 2;
        this.score += pickupBonus;
        if (!this.noSpawn) {
          for (let i = 1; i <= 4; i++) {
            this.addCoin(this.lane, this.d + i * 2.5, Math.max(0.8, this.y + 0.4), true);
          }
        }
        break;
      case 5: // 5G Super Magnet: wide magnet + 2x multiplier
        this.score += pickupBonus;
        break;
      case 6: // Radar Path Scanner: convert barriers ahead into coins
        this.score += pickupBonus;
        this.scanAndConvertBarriers();
        break;
      case 7: // Bio-Chem Bouncer Boots: super jump + 2x multiplier
        this.score += pickupBonus;
        break;
      case 8: // Med-Tech Recovery Drone: clear slowdown + +500 recovery bonus + coin burst
        this.stumbleSlow = 0;
        this.frontHitSlow = false;
        this.invulnerableT = Math.max(this.invulnerableT, 2.5);
        this.score += 500;
        if (!this.noSpawn) {
          for (let i = 1; i <= 6; i++) {
            this.addCoin(this.lane, this.d + i * 2.2, Math.max(0.8, this.y + 0.5), true);
          }
        }
        break;
      case 9: // Space Rocket Fever: low-gravity moon jump + star magnet + 3x score + obstacle immunity
        this.score += pickupBonus;
        break;
    }
  }

  private laserDestroyBarriers() {
    for (let i = this.obs.length - 1; i >= 0; i--) {
      const o = this.obs[i];
      if (o.d0 > this.d && o.d0 < this.d + 28 && (o.kind === 'low' || o.kind === 'hurdle' || o.kind === 'overhead')) {
        this.score += 50;
        this.events.push({ type: 'armorSmash', kind: o.kind, x: laneX(o.lane), y: this.y, bonus: 50 });
        this.freeObs.push(o);
        this.obs.splice(i, 1);
      }
    }
  }

  private scanAndConvertBarriers() {
    for (let i = this.obs.length - 1; i >= 0; i--) {
      const o = this.obs[i];
      if (o.d0 > this.d && o.d0 < this.d + 45 && (o.kind === 'low' || o.kind === 'hurdle' || o.kind === 'overhead')) {
        this.addCoin(o.lane, o.d0, 1.0, true);
        this.freeObs.push(o);
        this.obs.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ input
  start() {
    this.running = true;
    this.finished = false;
  }

  /**
   * Synchronizes a newly-joined runner to the current elapsed time of an in-progress TV match,
   * granting 2.0s of spawn invulnerability and clearing immediate obstacles right in front of the player.
   */
  syncToElapsed(elapsed: number) {
    const safeElapsed = Math.max(0, Math.min(this.matchDuration - 1, elapsed));
    this.time = safeElapsed;
    this.d = distanceAtTime(safeElapsed, this.matchDuration);
    const p01 = this.progress01;
    this.floor = floorAtProgress(p01);
    this.zoneId = zoneAtProgress(p01);
    this.stageIndex = stageIndexAtProgress(p01);
    this.stageCenter = stageCenterAtProgress(p01);
    this.baseMult = baseMultForFloor(this.floor);
    this.speed = speedAtProgress(p01);
    this.invulnerableT = Math.max(this.invulnerableT, 2.5);
    this.score = Math.round(this.d * 3.0);

    if (!this.noSpawn) {
      this.track.ensure(this.d + VIEW_AHEAD);
    }
    for (let i = this.obs.length - 1; i >= 0; i--) {
      const o = this.obs[i];
      if (o.d1 < this.d - 8 || (o.d1 >= this.d - 2 && o.d0 <= this.d + 14)) {
        this.freeObs.push(o);
        this.obs.splice(i, 1);
      }
    }
  }
  left() { this.changeLane(-1); }
  right() { this.changeLane(1); }
  private changeLane(dir: number) {
    if (!this.alive || !this.running) return;
    const target = this.lane + dir;
    if (target < 0 || target >= LANE_COUNT) {
      this.events.push({ type: 'bump', dir });
      return;
    }
    this.fromX = this.x;
    this.lane = target;
    this.laneT = 0;
    this.events.push({ type: 'lane', dir });
  }
  jump() {
    if (!this.alive || !this.running) return;
    if (this.activeCenter === 1) return;
    if (this.grounded || this.coyoteT > 0) this.doJump();
    else this.jumpBufT = PLAYER.buffer;
  }
  down() {
    if (!this.alive || !this.running) return;
    if (this.activeCenter === 1) return;
    this.jumpBufT = 0;
    if (this.grounded) this.startSlide();
    else {
      this.fastFall = true;
      this.slideQueued = true;
    }
  }
  private doJump() {
    const sup = this.activeCenter === 7 || this.activeCenter === 9;
    this.vy = sup ? SUPER_JUMP_V : JUMP_V;
    this.grounded = false;
    this.coyoteT = 0;
    this.jumpBufT = 0;
    this.slideT = 0;
    this.fastFall = false;
    this.slideQueued = false;
    this.airTime = 0;
    this.peakY = this.y;
    this.events.push({ type: 'jump', super: sup });
  }
  private startSlide() {
    this.slideT = PLAYER.slideTime;
    this.events.push({ type: 'slide' });
  }

  get spawned() { return this.nextId - 1; }
  get sliding() { return this.slideT > 0; }
  get bodyH() { return this.sliding ? PLAYER.slideHeight : PLAYER.height; }
  get mult() {
    let m = this.baseMult;
    if (this.activeCenter === 9) m *= 3;
    else if (this.activeCenter === 5 || this.activeCenter === 7) m *= 2;
    return m;
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    if (!this.running || this.finished) return;
    let left = Math.min(dt, 0.5);
    while (left > 1e-6 && this.running && !this.finished) {
      const h = Math.min(MAX_STEP, left);
      this.step(h);
      left -= h;
    }
  }

  private step(dt: number) {
    this.time += dt;

    // Update Floor, Zone & 9-Center Stage from elapsed time
    const p01 = this.progress01;
    const nextFloor = floorAtProgress(p01);
    const nextZone = zoneAtProgress(p01);
    const nextStageIndex = stageIndexAtProgress(p01);
    const nextStageCenter = stageCenterAtProgress(p01);
    if (nextFloor !== this.floor || nextZone !== this.zoneId) {
      this.floor = nextFloor;
      this.zoneId = nextZone;
      this.baseMult = baseMultForFloor(this.floor);
      this.events.push({ type: 'floorChange', floor: this.floor, zoneId: this.zoneId });
    }
    if (nextStageIndex !== this.stageIndex) {
      this.stageIndex = nextStageIndex;
      this.stageCenter = nextStageCenter;
      this.events.push({
        type: 'centerStageChange',
        centerId: this.stageCenter,
        stageIndex: this.stageIndex,
        floor: this.floor,
      });
    }

    // Check 180s match finish
    if (this.time >= this.matchDuration) {
      this.time = this.matchDuration;
      this.floor = 10;
      this.zoneId = 4;
      this.stageIndex = 8;
      this.stageCenter = 9;
      this.finished = true;
      this.running = false;
      this.speed = 0;
      this.events.push({ type: 'finish', score: Math.floor(this.score), coins: this.coins, distance: Math.floor(this.d) });
      return;
    }

    const prevX = this.x, prevY = this.y, prevD = this.d, prevH = this.bodyH;

    // Timers
    this.sinceStumble += dt;
    this.stumbleSlow = Math.max(0, this.stumbleSlow - dt);
    if (this.stumbleSlow === 0) this.frontHitSlow = false;
    this.invulnerableT = Math.max(0, this.invulnerableT - dt);
    this.ignoreT = Math.max(0, this.ignoreT - dt);
    this.coyoteT = Math.max(0, this.coyoteT - dt);
    this.jumpBufT = Math.max(0, this.jumpBufT - dt);
    this.coinStreakT = Math.max(0, this.coinStreakT - dt);
    if (this.coinStreakT === 0) this.coinStreak = 0;
    if (this.slideT > 0) this.slideT = Math.max(0, this.slideT - dt);

    if (this.activeCenter !== null && this.centerTimer > 0) {
      const prevCenter = this.activeCenter;
      this.centerTimer = Math.max(0, this.centerTimer - dt);
      if (prevCenter === 2) {
        this.laserDestroyBarriers();
      } else if (prevCenter === 6) {
        this.scanAndConvertBarriers();
      }
      if (this.centerTimer === 0) {
        this.activeCenter = null;
        this.shieldHits = 0;
        // Review Focus #2 & Spec 5.2: safe landing invulnerability on power-up expiry
        const grace = (prevCenter === 1 || prevCenter === 9 || !this.grounded) ? 1.5 : 1.0;
        this.invulnerableT = Math.max(this.invulnerableT, grace);
        this.events.push({ type: 'centerPowerEnd', centerId: prevCenter });
      }
    }

    // Speed (Spec 5.1 & 5.3: linear progress ramp + 0.65x front hit slow / 0.85x side stumble slow)
    const base = this.speedOverride || speedAtProgress(p01);
    let speedFactor = 1;
    if (this.stumbleSlow > 0) {
      speedFactor = this.frontHitSlow ? 0.65 : 0.85;
    }
    if (this.activeCenter === 1 || this.activeCenter === 9) speedFactor *= 1.35;
    else if (this.activeCenter === 3) speedFactor *= 1.2;
    this.speed = base * speedFactor;
    this.d += this.speed * dt;
    this.score += this.speed * dt * 0.5 * this.mult;

    // Sideways movement
    if (this.laneT < 1) {
      this.laneT = Math.min(1, this.laneT + dt / PLAYER.laneTime);
      this.x = this.fromX + (laneX(this.lane) - this.fromX) * easeOut(this.laneT);
    } else this.x = laneX(this.lane);

    // Up and down movement
    if (this.activeCenter === 1) {
      this.grounded = false;
      this.vy = 0;
      this.y += (4.2 - this.y) * Math.min(1, dt * 10);
      this.peakY = Math.max(this.peakY, this.y);
    } else if (!this.grounded) {
      this.airTime += dt;
      const gravScale = this.activeCenter === 9 ? 0.55 : (this.vy < 0 ? 1.15 : 1);
      this.vy -= GRAVITY * dt * gravScale;
      if (this.fastFall) this.vy = Math.min(this.vy, -PLAYER.fastFallSpeed);
      this.y += this.vy * dt;
      this.peakY = Math.max(this.peakY, this.y);
    }

    this.updateMovers();

    if (this.activeCenter !== 1) {
      this.groundY = this.supportAt(this.x, this.d, this.grounded ? this.y : Math.max(this.y, prevY));
      if (this.grounded) {
        if (this.groundY < this.y - 0.05) {
          this.grounded = false;
          this.coyoteT = PLAYER.coyote;
          this.vy = 0;
          this.airTime = 0;
          this.peakY = this.y;
        } else this.y = this.groundY;
      }
      if (!this.grounded && this.y <= this.groundY && this.vy <= 0) this.land();
    }

    if (!this.invincible) {
      this.collide(prevX, prevY, prevD, prevH);
    }
    this.collectPickups(dt);
    this.hints();

    if (!this.noSpawn) this.track.ensure(this.d + VIEW_AHEAD);
    this.recycle();
  }

  private land() {
    const fall = this.peakY - this.groundY;
    this.y = this.groundY;
    this.vy = 0;
    this.grounded = true;
    this.fastFall = false;
    this.events.push({ type: 'land', fall });
    if (this.jumpBufT > 0) this.doJump();
    else if (this.slideQueued) {
      this.slideQueued = false;
      this.startSlide();
    }
  }

  updateMovers() {
    for (const o of this.obs) {
      o.pd0 = o.d0;
      o.pd1 = o.d1;
      if (o.kind === 'mtrain') this.placeMover(o);
    }
  }

  supportAt(x: number, d: number, feet: number) {
    let g = 0;
    for (const o of this.obs) {
      if (!o.walk) continue;
      if (d + PLAYER.halfD * 0.5 < o.d0 || d - PLAYER.halfD * 0.5 > o.d1) continue;
      if (Math.abs(x - laneX(o.lane)) > o.halfW + PLAYER.halfW - 0.25) continue;
      const top = this.topAt(o, d);
      if (feet >= top - PLAYER.stepUp && top > g) g = top;
    }
    return g;
  }

  /**
   * Computes the walkable support elevation (`ramp` slope `0 -> 2.65m` and `train` roof `2.65m`)
   * for a 3D ghost runner rendered on the TV Live Arena track at `(lane, x, d)`.
   */
  ghostSupportAt(lane: number, x: number, d: number, prevSupportY: number, sameLane = true): number {
    let g = 0;
    for (const o of this.obs) {
      if (!o.walk) continue;
      if (o.lane !== lane && Math.abs(x - laneX(o.lane)) > o.halfW + PLAYER.halfW - 0.2) continue;
      if (o.kind === 'ramp') {
        if (d + PLAYER.halfD >= o.d0 && d - PLAYER.halfD <= o.d1) {
          const top = this.topAt(o, Math.max(o.d0, Math.min(o.d1, d)));
          if (top > g) g = top;
        }
      } else if (d + PLAYER.halfD * 0.5 >= o.d0 && d - PLAYER.halfD * 0.5 <= o.d1) {
        const hasLeadingRamp = this.obs.some(
          (r) => r.kind === 'ramp' && r.lane === o.lane && Math.abs(r.d1 - o.d0) < 1.5,
        );
        if (
          prevSupportY >= o.yt - 1.15 ||
          (hasLeadingRamp && (prevSupportY >= 0.2 || d <= o.d0 + 4.0 || sameLane))
        ) {
          if (o.yt > g) g = o.yt;
        }
      }
    }
    return g;
  }

  /**
   * Checks whether a 3D ghost runner on the TV Live Arena track at `(lane, x, y, d)` is colliding
   * with a non-walkable obstacle (`low`, `hurdle`, `overhead`, or a `train`/`mtrain` when not on its roof).
   */
  ghostObstacleHitAt(
    lane: number,
    x: number,
    y: number,
    d: number,
    sliding: boolean,
    activeCenter: CenterId | null,
    supportY = 0,
  ): Ob | null {
    if (activeCenter === 1 || activeCenter === 9) return null;
    const effectiveY = Math.max(y, supportY);
    const h = sliding ? PLAYER.slideHeight : PLAYER.height;
    for (const o of this.obs) {
      if (o.kind === 'ramp') continue;
      if (d + PLAYER.halfD <= o.d0 || d - PLAYER.halfD >= o.d1) continue;
      if (o.lane !== lane && Math.abs(x - laneX(o.lane)) >= o.halfW + PLAYER.halfW - 0.1) continue;
      const top = this.topAt(o, d);
      if (o.walk && effectiveY >= top - PLAYER.stepUp * 1.6) continue;
      const feet = effectiveY + PLAYER.feetTol;
      const head = effectiveY + h - PLAYER.headTol;
      if (head > o.yb && feet < top) return o;
    }
    return null;
  }

  topAt(o: Ob, d: number) {
    if (o.kind === 'ramp') return Math.max(0, Math.min(1, (d - o.d0) / (o.d1 - o.d0))) * o.yt;
    return o.yt;
  }

  private overlaps(o: Ob, x: number, y: number, d: number, h: number) {
    if (d + PLAYER.halfD <= o.d0 || d - PLAYER.halfD >= o.d1) return false;
    if (Math.abs(x - laneX(o.lane)) >= o.halfW + PLAYER.halfW) return false;
    const top = this.topAt(o, d);
    const feet = y + PLAYER.feetTol, head = y + h - PLAYER.headTol;
    if (o.walk && y >= top - PLAYER.stepUp) return false;
    return head > o.yb && feet < top;
  }

  private collide(px: number, py: number, pd: number, ph: number) {
    if (this.activeCenter === 1 || this.activeCenter === 9) return; // immune to obstacles while flying / rocketing
    const h = this.bodyH;
    for (let i = this.obs.length - 1; i >= 0; i--) {
      const o = this.obs[i];
      if (o.d0 > this.d + 8 || o.d1 < this.d - 8) continue;
      if (o.id === this.ignoreId && this.ignoreT > 0) continue;
      if (!this.overlaps(o, this.x, this.y, this.d, h)) continue;

      // Center #3 EV Train Armor smashes through any obstacle for +100 bonus
      if (this.activeCenter === 3) {
        const bonus = 100 * this.mult;
        this.score += bonus;
        this.events.push({ type: 'armorSmash', kind: o.kind, x: laneX(o.lane), y: this.y, bonus });
        this.freeObs.push(o);
        this.obs.splice(i, 1);
        continue;
      }

      // Invulnerability grace window (after stumble or airborne power-up expiry)
      if (this.invulnerableT > 0) {
        this.ignoreId = o.id;
        this.ignoreT = 0.5;
        continue;
      }

      // Center #4 Green Energy Shield absorbs up to 2 hits
      if (this.shieldHits > 0) {
        this.shieldHits--;
        if (this.shieldHits === 0 && this.activeCenter === 4) {
          this.activeCenter = null;
          this.centerTimer = 0;
        }
        this.ignoreId = o.id;
        this.ignoreT = 1.0;
        this.invulnerableT = 0.8;
        this.events.push({ type: 'shieldBlock', x: this.x, y: this.y, remaining: this.shieldHits });
        return;
      }

      const dx = Math.abs(this.x - laneX(o.lane));
      const dBefore = !(pd + PLAYER.halfD <= o.pd0 || pd - PLAYER.halfD >= o.pd1);
      const xBefore = Math.abs(px - laneX(o.lane)) < o.halfW + PLAYER.halfW;
      if (!dBefore) {
        if (o.walk && this.y >= this.topAt(o, this.d) - PLAYER.stepUp * 1.6) {
          this.y = this.topAt(o, this.d);
          this.groundY = this.y;
          if (!this.grounded) this.land();
          continue;
        }
        if (dx > PLAYER.grazeX) {
          const away = Math.sign(this.x - px) === Math.sign(this.x - laneX(o.lane));
          if (away) {
            this.ignoreId = o.id;
            this.ignoreT = 0.4;
            continue;
          }
          this.bounce(o);
        } else {
          this.frontHit(o);
        }
        return;
      }
      if (!xBefore) {
        if (o.kind === 'ramp' && this.topAt(o, this.d) - this.y <= 1.0) {
          this.standOn(o);
          continue;
        }
        this.bounce(o);
        return;
      }
      const wasOver = py >= this.topAt(o, pd) - 0.05 || o.kind === 'ramp';
      if (wasOver) {
        if (o.walk) {
          this.y = this.topAt(o, this.d);
          this.groundY = this.y;
          if (!this.grounded) this.land();
        }
        continue;
      }
      if (py + ph - PLAYER.headTol <= o.yb + 0.05 && this.vy > 0) {
        this.vy = 0;
        this.y = Math.max(this.groundY, o.yb - h + PLAYER.headTol - 0.01);
        continue;
      }
      this.bounce(o);
      return;
    }
  }

  private standOn(o: Ob) {
    this.y = this.topAt(o, this.d);
    this.groundY = this.y;
    if (!this.grounded) this.land();
  }

  private bounce(o: Ob) {
    const back = o.lane + (this.x < laneX(o.lane) ? -1 : 1);
    if (back >= 0 && back < LANE_COUNT) {
      this.fromX = this.x;
      this.lane = back;
      this.laneT = 0;
    }
    this.ignoreId = o.id;
    this.ignoreT = 0.6;
    this.sinceStumble = 0;
    if (this.stumbleSlow < 0.6) {
      this.stumbleSlow = 0.6;
      this.frontHitSlow = false;
    }
    this.invulnerableT = Math.max(this.invulnerableT, 0.6);
    this.score = Math.max(0, this.score - PLAYER.sideHitPenalty);
    this.events.push({ type: 'stumble', x: this.x, y: this.y, penalty: PLAYER.sideHitPenalty });
  }

  /** Forgiving No-Death Front Collision: -50 pts (clamped >= 0), 1.2s slowdown (0.65x), 1.5s invulnerability, coinStreak reset. */
  private frontHit(o?: Ob) {
    this.alive = true; // Never kill the player during the 180s match
    this.hitCount++;
    this.slideT = 0;
    this.coinStreak = 0;
    this.coinStreakT = 0;
    this.sinceStumble = 0;
    this.stumbleSlow = PLAYER.frontHitSlowDuration;
    this.frontHitSlow = true;
    this.invulnerableT = PLAYER.frontHitInvulnDuration;
    this.score = Math.max(0, this.score - PLAYER.frontHitPenalty);
    if (o) {
      this.ignoreId = o.id;
      this.ignoreT = 1.5;
    }
    this.events.push({ type: 'hit', kind: o ? o.kind : 'train', x: this.x, y: this.y, penalty: PLAYER.frontHitPenalty });
  }

  private collectPickups(dt: number) {
    const h = this.bodyH;
    const magnet = this.activeCenter === 1 || this.activeCenter === 2 || this.activeCenter === 5 || this.activeCenter === 9;
    const magnetRange = (this.activeCenter === 5 || this.activeCenter === 9) ? MAGNET_RANGE * 1.5 : MAGNET_RANGE;

    for (let i = this.coinList.length - 1; i >= 0; i--) {
      const c = this.coinList[i];
      const ahead = c.d - this.d;
      if (ahead > magnetRange + 2) continue;
      if (magnet && ahead < magnetRange && ahead > -2) c.pulled = true;
      if (c.pulled) {
        const k = Math.min(1, dt * 15);
        c.x += (this.x - c.x) * k;
        c.y += (this.y + 1 - c.y) * k;
        c.d += (this.d - c.d) * k + this.speed * dt * 0.3;
      }
      if (Math.abs(c.d - this.d) < 1.0 && Math.abs(c.x - this.x) < 1.1 && c.y > this.y - 0.6 && c.y < this.y + h + 0.7) {
        this.coins++;
        this.coinStreak++;
        this.coinStreakT = 0.6;
        this.score += (c.bonus ? 10 : 5) * this.mult;
        this.events.push({ type: 'coin', x: c.x, y: c.y, streak: this.coinStreak });
        this.freeCoins.push(c);
        this.coinList.splice(i, 1);
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const cp = this.pickups[i];
      const x = laneX(cp.lane);
      const yMatch = this.activeCenter === 1 || Math.abs(cp.y - (this.y + h * 0.5)) < 2.5;
      if (Math.abs(cp.d - this.d) < PICKUP_PULL_RANGE * 0.65 && Math.abs(x - this.x) < PICKUP_PULL_RANGE * 0.65 && yMatch) {
        this.activateCenter(cp.centerId);
        this.freePickups.push(cp);
        this.pickups.splice(i, 1);
      }
    }
  }

  private hints() {
    for (const o of this.obs) {
      if (o.hint && !o.hinted && o.d0 - this.d < this.speed * 1.5 && o.d0 > this.d) {
        o.hinted = true;
        this.events.push({ type: 'hint', hint: o.hint as Hint });
      }
    }
  }

  public recycle() {
    const behind = this.d - 14;
    for (let i = this.obs.length - 1; i >= 0; i--) {
      if (this.obs[i].d1 < behind) this.freeObs.push(this.obs.splice(i, 1)[0]);
    }
    for (let i = this.coinList.length - 1; i >= 0; i--) {
      if (this.coinList[i].d < behind) this.freeCoins.push(this.coinList.splice(i, 1)[0]);
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      if (this.pickups[i].d < behind) this.freePickups.push(this.pickups.splice(i, 1)[0]);
    }
  }

  drainEvents(): SimEvent[] {
    const e = this.events.slice();
    this.events.length = 0;
    return e;
  }

  snapshot(): SimSnapshot {
    return {
      lane: this.lane,
      x: +this.x.toFixed(3),
      y: +this.y.toFixed(3),
      vy: +this.vy.toFixed(2),
      d: +this.d.toFixed(2),
      speed: +this.speed.toFixed(2),
      grounded: this.grounded,
      sliding: this.sliding,
      alive: this.alive,
      running: this.running,
      finished: this.finished,
      floor: this.floor,
      zoneId: this.zoneId,
      stageIndex: this.stageIndex,
      stageCenter: this.stageCenter,
      time: +this.time.toFixed(2),
      timeLeft: +this.timeLeft.toFixed(2),
      progress01: +this.progress01.toFixed(3),
      coins: this.coins,
      score: Math.floor(this.score),
      mult: this.mult,
      hitCount: this.hitCount,
      activeCenter: this.activeCenter,
      centerTimer: +this.centerTimer.toFixed(2),
      shieldHits: this.shieldHits,
      invulnerableT: +this.invulnerableT.toFixed(2),
      collectedCenters: Array.from(this.collectedCenters),
      sinceStumble: +this.sinceStumble.toFixed(2),
      groundY: +this.groundY.toFixed(2),
      obs: this.obs.length,
      coinCount: this.coinList.length,
      pickups: this.pickups.length,
      created: { ...this.created },
      pooled: {
        obs: this.freeObs.length,
        coins: this.freeCoins.length,
        pickups: this.freePickups.length,
      },
    };
  }
}
