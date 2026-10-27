import { DEFAULT_MATCH_DURATION, distanceAtTime, floorAtProgress, laneX } from './config';
import type { CenterId } from './sim/types';
import { sanitizeAvatarId, type AvatarId } from './view/avatars';

export type RoomPhase = 'LOBBY' | 'COUNTDOWN' | 'RUNNING' | 'PODIUM';
export type PlayerRole = 'junior' | 'senior' | 'uni' | 'public';

export const ROLE_LABELS: Record<PlayerRole, string> = {
  junior: 'ม.ต้น',
  senior: 'ม.ปลาย',
  uni: 'นักศึกษา',
  public: 'บุคคลทั่วไป',
};

export const AVATAR_COLORS = [
  '#38bdf8', // Sky Blue
  '#22c55e', // Emerald Green
  '#f59e0b', // Amber Gold
  '#ec4899', // Cyber Pink
  '#a855f7', // Neon Purple
  '#fb7185', // Coral Rose
];

export interface PlayerProfile {
  id: string;
  name: string;
  role: PlayerRole;
  color: string;
  avatar?: AvatarId;
  isBot?: boolean;
}

export interface RunnerNetState {
  id: string;
  name: string;
  role: PlayerRole;
  color: string;
  avatar: AvatarId;
  lane: number;
  x: number;
  y: number;
  d: number;
  score: number;
  coins: number;
  floor: number;
  activeCenter: CenterId | null;
  collectedCount: number;
  rank: number;
  packOffsetZ: number;
  isBot?: boolean;
}

export interface RoomSnapshot {
  matchId: number;
  phase: RoomPhase;
  phaseTimeLeft: number;
  matchDuration: number;
  lobbyHold: boolean;
  matchSeed: number;
  referenceDistance: number;
  currentFloor: number;
  activeRunners: RunnerNetState[];
  top10: RunnerNetState[];
  waitingQueue: PlayerProfile[];
  allDayBest: { name: string; score: number; role: PlayerRole }[];
}

export type HostCommand =
  | { action: 'start_now' }
  | { action: 'toggle_hold' }
  | { action: 'set_duration'; duration: number }
  | { action: 'add_bots'; count?: number }
  | { action: 'force_lobby' };

/** Strip HTML tags, control chars, and clamp nickname to 1..16 chars. */
export function sanitizeNickname(raw: string): string {
  const stripped = (raw || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .trim();
  if (!stripped) return 'นักวิ่ง Techno';
  return Array.from(stripped).slice(0, 16).join('');
}

const BOT_PRESETS: Array<{ name: string; role: PlayerRole; color: string; avatar: AvatarId }> = [
  { name: 'บอทสายฟ้า ⚡', role: 'senior', color: '#38bdf8', avatar: 'non' },
  { name: 'น้องเมย์ 🎀', role: 'junior', color: '#ec4899', avatar: 'may' },
  { name: 'ดร.พราว 🧬', role: 'uni', color: '#22c55e', avatar: 'praw' },
  { name: 'พี่คินวิศวะ 🤖', role: 'uni', color: '#f59e0b', avatar: 'kin' },
  { name: 'กัปตันสกาย 🚀', role: 'public', color: '#a855f7', avatar: 'sky' },
];

export class MatchRoomCore {
  matchId = 1;
  phase: RoomPhase = 'LOBBY';
  phaseTimeLeft = 45;
  matchDuration = DEFAULT_MATCH_DURATION;
  lobbyHold = false;
  matchSeed = 202610;
  referenceDistance = 0;
  currentFloor = 1;

  private activeMap = new Map<string, RunnerNetState>();
  private waitingMap = new Map<string, PlayerProfile>();
  private botSeeds = new Map<string, number>();
  allDayBest: { name: string; score: number; role: PlayerRole }[] = [
    { name: 'กัปตัน SUTO', score: 9850, role: 'uni' },
    { name: 'น้องภูมิ ม.ปลาย', score: 8420, role: 'senior' },
    { name: 'เมย์ Techno', score: 7690, role: 'junior' },
  ];

  join(profile: PlayerProfile): { queuedForNextRound: boolean } {
    const cleanAvatar = sanitizeAvatarId(profile.avatar);
    const cleanProfile: PlayerProfile = {
      ...profile,
      name: sanitizeNickname(profile.name),
      role: profile.role || 'senior',
      color: profile.color || AVATAR_COLORS[0],
      avatar: cleanAvatar,
    };

    if (this.phase === 'LOBBY') {
      this.waitingMap.delete(cleanProfile.id);
      const existing = this.activeMap.get(cleanProfile.id);
      this.activeMap.set(cleanProfile.id, {
        id: cleanProfile.id,
        name: cleanProfile.name,
        role: cleanProfile.role,
        color: cleanProfile.color,
        avatar: cleanAvatar,
        lane: existing ? existing.lane : 1,
        x: existing ? existing.x : 0,
        y: 0,
        d: 0,
        score: 0,
        coins: 0,
        floor: 1,
        activeCenter: null,
        collectedCount: 0,
        rank: 1,
        packOffsetZ: 0,
        isBot: cleanProfile.isBot,
      });
      return { queuedForNextRound: false };
    }

    // If player was already in activeMap during RUNNING/COUNTDOWN, just update their display metadata
    if (this.activeMap.has(cleanProfile.id)) {
      const r = this.activeMap.get(cleanProfile.id)!;
      r.name = cleanProfile.name;
      r.role = cleanProfile.role;
      r.color = cleanProfile.color;
      r.avatar = cleanAvatar;
      return { queuedForNextRound: false };
    }

    // Latecomer during COUNTDOWN / RUNNING / PODIUM -> waitingQueue for next round
    this.waitingMap.set(cleanProfile.id, cleanProfile);
    return { queuedForNextRound: true };
  }

  leave(id: string) {
    this.activeMap.delete(id);
    this.waitingMap.delete(id);
    this.botSeeds.delete(id);
  }

  updateRunnerState(
    id: string,
    state: Partial<Pick<RunnerNetState, 'lane' | 'x' | 'y' | 'd' | 'score' | 'coins' | 'floor' | 'activeCenter' | 'collectedCount'>>,
  ) {
    const r = this.activeMap.get(id);
    if (!r) return; // Ignore updates from waitingQueue players
    if (state.lane !== undefined) r.lane = state.lane;
    if (state.x !== undefined) r.x = state.x;
    if (state.y !== undefined) r.y = state.y;
    if (state.d !== undefined) r.d = state.d;
    if (state.score !== undefined) r.score = Math.max(0, Math.floor(state.score));
    if (state.coins !== undefined) r.coins = state.coins;
    if (state.floor !== undefined) r.floor = state.floor;
    if (state.activeCenter !== undefined) r.activeCenter = state.activeCenter;
    if (state.collectedCount !== undefined) r.collectedCount = state.collectedCount;
  }

  addDemoBots(count = 4) {
    for (let i = 0; i < count; i++) {
      const preset = BOT_PRESETS[i % BOT_PRESETS.length];
      const id = `bot-${i + 1}`;
      this.botSeeds.set(id, i + 1);
      this.join({
        id,
        name: preset.name,
        role: preset.role,
        color: preset.color,
        avatar: preset.avatar,
        isBot: true,
      });
    }
  }

  hostCommand(cmd: HostCommand) {
    switch (cmd.action) {
      case 'start_now': {
        if (this.phase === 'LOBBY' || this.phase === 'PODIUM') {
          if (this.phase === 'PODIUM') {
            this.enterLobby();
          }
          if (this.activeMap.size === 0 && this.waitingMap.size > 0) {
            this.promoteWaitingQueue();
          }
          if (this.activeMap.size === 0) {
            this.addDemoBots(4);
          }
          this.phase = 'COUNTDOWN';
          this.phaseTimeLeft = 3.5;
        }
        break;
      }
      case 'toggle_hold': {
        this.lobbyHold = !this.lobbyHold;
        break;
      }
      case 'set_duration': {
        const valid = [90, 120, 180].includes(cmd.duration) ? cmd.duration : DEFAULT_MATCH_DURATION;
        this.matchDuration = valid;
        if (this.phase === 'RUNNING') {
          this.phaseTimeLeft = Math.min(this.phaseTimeLeft, valid);
        }
        break;
      }
      case 'add_bots': {
        this.addDemoBots(cmd.count ?? 4);
        break;
      }
      case 'force_lobby': {
        this.enterLobby();
        break;
      }
    }
  }

  tick(dt: number) {
    if (dt <= 0) return;

    if (this.phase === 'LOBBY') {
      if (!this.lobbyHold && this.activeMap.size > 0) {
        this.phaseTimeLeft -= dt;
        if (this.phaseTimeLeft <= 0) {
          this.phase = 'COUNTDOWN';
          this.phaseTimeLeft = 3.5;
        }
      }
      return;
    }

    if (this.phase === 'COUNTDOWN') {
      this.phaseTimeLeft -= dt;
      if (this.phaseTimeLeft <= 0) {
        const overflow = -this.phaseTimeLeft;
        this.startRunningPhase();
        if (overflow > 0) this.tick(overflow);
      }
      return;
    }

    if (this.phase === 'RUNNING') {
      this.phaseTimeLeft -= dt;
      const elapsed = Math.max(0, Math.min(this.matchDuration, this.matchDuration - Math.max(0, this.phaseTimeLeft)));
      const p01 = this.matchDuration > 0 ? elapsed / this.matchDuration : 0;
      this.referenceDistance = distanceAtTime(elapsed, this.matchDuration);
      this.currentFloor = floorAtProgress(p01);

      // Update simulated bots so the shared track & leaderboard stay lively
      for (const [id, r] of this.activeMap.entries()) {
        if (!r.isBot) continue;
        const idx = this.botSeeds.get(id) ?? 1;
        const wave = Math.sin(elapsed * 0.45 + idx * 1.7);
        const botFactor = 0.92 + (idx % 3) * 0.045 + wave * 0.03;
        r.d = +(this.referenceDistance * botFactor).toFixed(1);
        r.lane = ((Math.floor(elapsed / (2.4 + idx * 0.5)) + idx) % 3 + 3) % 3;
        r.x = laneX(r.lane);
        r.y = Math.sin(elapsed * 3 + idx) > 0.88 ? 1.4 : 0;
        r.floor = this.currentFloor;
        r.coins = Math.floor(elapsed * (1.8 + idx * 0.25));
        r.score = Math.floor(r.d * 2.2 + r.coins * 15);
        r.collectedCount = Math.min(9, Math.floor(p01 * 9));
        const centerCycle = (Math.floor(elapsed / 19) + idx) % 9 + 1;
        r.activeCenter = (elapsed % 19 < 4.5) ? (centerCycle as CenterId) : null;
      }

      if (this.phaseTimeLeft <= 0) {
        const overflow = -this.phaseTimeLeft;
        this.enterPodium();
        if (overflow > 0) this.tick(overflow);
      }
      return;
    }

    if (this.phase === 'PODIUM') {
      this.phaseTimeLeft -= dt;
      if (this.phaseTimeLeft <= 0) {
        this.enterLobby();
      }
    }
  }

  private startRunningPhase() {
    this.phase = 'RUNNING';
    this.phaseTimeLeft = this.matchDuration;
    this.referenceDistance = 0;
    this.currentFloor = 1;
    for (const r of this.activeMap.values()) {
      r.d = 0;
      r.y = 0;
      r.score = 0;
      r.coins = 0;
      r.floor = 1;
      r.activeCenter = null;
      r.collectedCount = 0;
      r.packOffsetZ = 0;
    }
  }

  private enterPodium() {
    this.phase = 'PODIUM';
    this.phaseTimeLeft = 15;
    this.currentFloor = 10;
    // Update allDayBest from this round's runners
    for (const r of this.activeMap.values()) {
      this.allDayBest.push({ name: r.name, score: r.score, role: r.role });
    }
    this.allDayBest.sort((a, b) => b.score - a.score);
    this.allDayBest = this.allDayBest.slice(0, 10);
  }

  private enterLobby() {
    this.matchId++;
    this.phase = 'LOBBY';
    this.phaseTimeLeft = 45;
    this.matchSeed = 202600 + this.matchId * 17;
    this.referenceDistance = 0;
    this.currentFloor = 1;

    // Reset existing active runners for the new round
    for (const r of this.activeMap.values()) {
      r.d = 0;
      r.y = 0;
      r.score = 0;
      r.coins = 0;
      r.floor = 1;
      r.activeCenter = null;
      r.collectedCount = 0;
      r.packOffsetZ = 0;
    }

    // Promote everyone waiting in waitingQueue into activeMap!
    this.promoteWaitingQueue();
  }

  private promoteWaitingQueue() {
    for (const p of this.waitingMap.values()) {
      this.activeMap.set(p.id, {
        id: p.id,
        name: p.name,
        role: p.role,
        color: p.color,
        avatar: sanitizeAvatarId(p.avatar),
        lane: 1,
        x: 0,
        y: 0,
        d: 0,
        score: 0,
        coins: 0,
        floor: 1,
        activeCenter: null,
        collectedCount: 0,
        rank: 1,
        packOffsetZ: 0,
        isBot: p.isBot,
      });
    }
    this.waitingMap.clear();
  }

  getSnapshot(): RoomSnapshot {
    const runners = Array.from(this.activeMap.values()).map((r) => ({ ...r }));
    runners.sort(
      (a, b) =>
        b.score - a.score ||
        b.d - a.d ||
        (a.isBot ? 1 : 0) - (b.isBot ? 1 : 0),
    );

    const meanD =
      runners.length > 0
        ? runners.reduce((acc, r) => acc + r.d, 0) / runners.length
        : this.referenceDistance;
    const anchorD = this.referenceDistance > 0 ? this.referenceDistance : meanD;

    runners.forEach((r, idx) => {
      r.rank = idx + 1;
      const rawOffset = (r.d - anchorD) * 0.22;
      r.packOffsetZ = +Math.max(-14, Math.min(10, rawOffset)).toFixed(2);
    });

    return {
      matchId: this.matchId,
      phase: this.phase,
      phaseTimeLeft: +Math.max(0, this.phaseTimeLeft).toFixed(1),
      matchDuration: this.matchDuration,
      lobbyHold: this.lobbyHold,
      matchSeed: this.matchSeed,
      referenceDistance: +this.referenceDistance.toFixed(1),
      currentFloor: this.currentFloor,
      activeRunners: runners,
      top10: runners.slice(0, 10),
      waitingQueue: Array.from(this.waitingMap.values()),
      allDayBest: this.allDayBest.slice(0, 5),
    };
  }
}

export type NetMessage =
  | { type: 'join'; profile: PlayerProfile }
  | { type: 'state'; id: string; state: Partial<RunnerNetState> }
  | { type: 'host'; command: HostCommand }
  | { type: 'request_sync' }
  | { type: 'snapshot'; snapshot: RoomSnapshot };

/**
 * Real-time client that connects to the booth WebSocket server (`ws://host:8787`) if running,
 * and seamlessly falls back to BroadcastChannel + local MatchRoomCore so multi-tab (`?mode=tv` + mobile tab)
 * works with zero setup.
 */
export class NetClient {
  private localRoom = new MatchRoomCore();
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private bc: BroadcastChannel | null = null;
  private latestSnapshot: RoomSnapshot;
  private listeners: Array<(snap: RoomSnapshot) => void> = [];
  private isAuthorityTab = false;
  private lastAuthoritySnapshotAt = 0;
  private lastJoinedProfile: PlayerProfile | null = null;
  private timerId: number | null = null;

  constructor(private isTvMode = false) {
    // Seed local room with 4 friendly AI bots so solo or multi-tab testing always has a lively pack
    this.localRoom.addDemoBots(4);
    this.latestSnapshot = this.localRoom.getSnapshot();
    this.isAuthorityTab = isTvMode;

    if (typeof window !== 'undefined') {
      if ('BroadcastChannel' in window) {
        this.bc = new BroadcastChannel('techno-surfers-room');
        this.bc.onmessage = (ev: MessageEvent<NetMessage>) => {
          this.handleChannelMessage(ev.data);
        };
        if (!this.isAuthorityTab) {
          this.bc.postMessage({ type: 'request_sync' } satisfies NetMessage);
        }
      }
      this.connectWebSocket();
      this.startLocalLoop();
    }
  }

  setTvMode(tv: boolean) {
    this.isTvMode = tv;
    this.isAuthorityTab = tv;
    if (tv && !this.wsConnected) {
      this.bc?.postMessage({ type: 'snapshot', snapshot: this.latestSnapshot } satisfies NetMessage);
    }
  }

  private connectWebSocket() {
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname || 'localhost';
      const ws = new WebSocket(`${proto}//${host}:8787`);
      ws.onopen = () => {
        this.wsConnected = true;
        if (this.lastJoinedProfile) {
          ws.send(JSON.stringify({ type: 'join', profile: this.lastJoinedProfile } satisfies NetMessage));
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as NetMessage;
          if (msg.type === 'snapshot') {
            this.latestSnapshot = msg.snapshot;
            this.emit();
          }
        } catch {
          // ignore malformed packet
        }
      };
      ws.onclose = () => {
        this.wsConnected = false;
        setTimeout(() => {
          if (!this.wsConnected) this.connectWebSocket();
        }, 2500);
      };
      ws.onerror = () => {
        this.wsConnected = false;
      };
      this.ws = ws;
    } catch {
      this.wsConnected = false;
    }
  }

  private handleChannelMessage(msg: NetMessage) {
    if (this.wsConnected) return;
    if (msg.type === 'snapshot') {
      if (!this.isAuthorityTab) {
        this.lastAuthoritySnapshotAt = Date.now();
        this.latestSnapshot = msg.snapshot;
        this.emit();
      }
      return;
    }
    if (msg.type === 'request_sync') {
      if (this.isAuthorityTab) {
        this.bc?.postMessage({ type: 'snapshot', snapshot: this.latestSnapshot } satisfies NetMessage);
      }
      return;
    }
    // Apply joins, runner states, and host commands to our local room
    if (msg.type === 'join') {
      this.localRoom.join(msg.profile);
    } else if (msg.type === 'state') {
      this.localRoom.updateRunnerState(msg.id, msg.state);
    } else if (msg.type === 'host') {
      this.localRoom.hostCommand(msg.command);
    }
    if (this.isAuthorityTab || Date.now() - this.lastAuthoritySnapshotAt >= 1200) {
      this.latestSnapshot = this.localRoom.getSnapshot();
    }
    if (this.isAuthorityTab) {
      this.bc?.postMessage({ type: 'snapshot', snapshot: this.latestSnapshot } satisfies NetMessage);
    }
    this.emit();
  }

  private startLocalLoop() {
    let last = performance.now();
    this.timerId = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (this.wsConnected) return;
      // If a TV authority tab is actively broadcasting snapshots, do not overwrite with our localRoom!
      if (!this.isAuthorityTab && Date.now() - this.lastAuthoritySnapshotAt < 1200) {
        return;
      }

      this.localRoom.tick(dt);
      this.latestSnapshot = this.localRoom.getSnapshot();
      if (this.isAuthorityTab) {
        this.bc?.postMessage({ type: 'snapshot', snapshot: this.latestSnapshot } satisfies NetMessage);
      }
      this.emit();
    }, 100);
  }

  onSnapshot(cb: (snap: RoomSnapshot) => void) {
    this.listeners.push(cb);
    cb(this.latestSnapshot);
  }

  getSnapshot(): RoomSnapshot {
    return this.latestSnapshot;
  }

  join(profile: PlayerProfile) {
    this.lastJoinedProfile = profile;
    const msg: NetMessage = { type: 'join', profile };
    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.localRoom.join(profile);
      if (this.isAuthorityTab || Date.now() - this.lastAuthoritySnapshotAt >= 1200) {
        this.latestSnapshot = this.localRoom.getSnapshot();
      }
      this.bc?.postMessage(msg);
      this.emit();
    }
  }

  sendRunnerState(id: string, state: Partial<RunnerNetState>) {
    const msg: NetMessage = { type: 'state', id, state };
    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.localRoom.updateRunnerState(id, state);
      this.bc?.postMessage(msg);
    }
  }

  sendHostCommand(command: HostCommand) {
    const msg: NetMessage = { type: 'host', command };
    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.localRoom.hostCommand(command);
      this.latestSnapshot = this.localRoom.getSnapshot();
      this.bc?.postMessage(msg);
      this.bc?.postMessage({ type: 'snapshot', snapshot: this.latestSnapshot } satisfies NetMessage);
      this.emit();
    }
  }

  destroy() {
    if (this.timerId !== null) clearInterval(this.timerId);
    this.bc?.close();
    this.ws?.close();
  }

  private emit() {
    for (const cb of this.listeners) cb(this.latestSnapshot);
  }
}
