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
  sliding?: boolean;
  stumbling?: boolean;
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
  | { action: 'remove_bots'; count?: number }
  | { action: 'clear_bots' }
  | { action: 'clear_all' }
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
  { name: 'เทอร์โบ นนท์ 💨', role: 'senior', color: '#fb7185', avatar: 'non' },
  { name: 'เมย์ สปีด 🌟', role: 'junior', color: '#38bdf8', avatar: 'may' },
  { name: 'ศ.ดร.พราว 🔬', role: 'uni', color: '#f59e0b', avatar: 'praw' },
  { name: 'ช่างคิน เมคคา ⚙️', role: 'uni', color: '#22c55e', avatar: 'kin' },
  { name: 'ผู้การสกาย 🛰️', role: 'public', color: '#ec4899', avatar: 'sky' },
];

export class MatchRoomCore {
  matchId = 1;
  phase: RoomPhase = 'LOBBY';
  phaseTimeLeft = 45;
  matchDuration = DEFAULT_MATCH_DURATION;
  lobbyHold = true;
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

  join(profile: PlayerProfile, options?: { immediate?: boolean }): { queuedForNextRound: boolean } {
    const cleanAvatar = sanitizeAvatarId(profile.avatar);
    const cleanProfile: PlayerProfile = {
      ...profile,
      name: sanitizeNickname(profile.name),
      role: profile.role || 'senior',
      color: profile.color || AVATAR_COLORS[0],
      avatar: cleanAvatar,
    };

    const forceImmediate = !!options?.immediate;

    if (this.phase === 'LOBBY' || forceImmediate) {
      this.waitingMap.delete(cleanProfile.id);
      const existing = this.activeMap.get(cleanProfile.id);
      const joinMidRun = this.phase === 'RUNNING' && !existing;
      this.activeMap.set(cleanProfile.id, {
        id: cleanProfile.id,
        name: cleanProfile.name,
        role: cleanProfile.role,
        color: cleanProfile.color,
        avatar: cleanAvatar,
        lane: existing ? existing.lane : 1,
        x: existing ? existing.x : 0,
        y: existing ? existing.y : 0,
        d: joinMidRun ? this.referenceDistance : existing ? existing.d : 0,
        score: joinMidRun ? Math.round(this.referenceDistance * 3.0) : existing ? existing.score : 0,
        coins: existing ? existing.coins : 0,
        floor: joinMidRun ? this.currentFloor : existing ? existing.floor : 1,
        activeCenter: existing ? existing.activeCenter : null,
        collectedCount: existing ? existing.collectedCount : 0,
        rank: existing ? existing.rank : 1,
        packOffsetZ: existing ? existing.packOffsetZ : 0,
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

  getRunnerState(id: string): RunnerNetState | undefined {
    return this.activeMap.get(id);
  }

  updateRunnerState(
    id: string,
    state: Partial<Pick<RunnerNetState, 'name' | 'role' | 'color' | 'avatar' | 'lane' | 'x' | 'y' | 'd' | 'score' | 'coins' | 'floor' | 'activeCenter' | 'collectedCount' | 'sliding' | 'stumbling'>>,
  ) {
    const waiting = this.waitingMap.get(id);
    if (waiting) {
      if (state.name !== undefined) waiting.name = sanitizeNickname(state.name);
      if (state.role !== undefined) waiting.role = state.role;
      if (state.color !== undefined) waiting.color = state.color;
      if (state.avatar !== undefined) waiting.avatar = sanitizeAvatarId(state.avatar);
    }
    const r = this.activeMap.get(id);
    if (!r) return; // Ignore positional updates from waitingQueue players
    if (state.name !== undefined) r.name = sanitizeNickname(state.name);
    if (state.role !== undefined) r.role = state.role;
    if (state.color !== undefined) r.color = state.color;
    if (state.avatar !== undefined) r.avatar = sanitizeAvatarId(state.avatar);
    if (state.lane !== undefined) r.lane = state.lane;
    if (state.x !== undefined) r.x = state.x;
    if (state.y !== undefined) r.y = state.y;
    if (state.d !== undefined) r.d = state.d;
    if (state.score !== undefined) r.score = Math.max(0, Math.floor(state.score));
    if (state.coins !== undefined) r.coins = state.coins;
    if (state.floor !== undefined) r.floor = state.floor;
    if (state.activeCenter !== undefined) r.activeCenter = state.activeCenter;
    if (state.collectedCount !== undefined) r.collectedCount = state.collectedCount;
    if (state.sliding !== undefined) r.sliding = state.sliding;
    if (state.stumbling !== undefined) r.stumbling = state.stumbling;
  }

  addDemoBots(count = 4) {
    let added = 0;
    for (let i = 0; i < BOT_PRESETS.length && added < count; i++) {
      const id = `bot-${i + 1}`;
      if (this.activeMap.has(id) || this.waitingMap.has(id)) continue;
      const preset = BOT_PRESETS[i % BOT_PRESETS.length];
      this.botSeeds.set(id, i + 1);
      this.join(
        {
          id,
          name: preset.name,
          role: preset.role,
          color: preset.color,
          avatar: preset.avatar,
          isBot: true,
        },
        { immediate: true },
      );
      added++;
    }
  }

  removeDemoBots(count = 1) {
    const botIds: string[] = [];
    for (const [id, r] of this.activeMap.entries()) {
      if (r.isBot || id.startsWith('bot-')) botIds.push(id);
    }
    for (const [id, p] of this.waitingMap.entries()) {
      if (p.isBot || id.startsWith('bot-')) botIds.push(id);
    }
    botIds.sort((a, b) => {
      const na = parseInt(a.replace('bot-', ''), 10) || 0;
      const nb = parseInt(b.replace('bot-', ''), 10) || 0;
      return nb - na;
    });
    if (botIds.length === 0) {
      const remainingIds = [
        ...Array.from(this.activeMap.keys()),
        ...Array.from(this.waitingMap.keys()),
      ];
      for (let i = 0; i < count && i < remainingIds.length; i++) {
        this.leave(remainingIds[i]);
      }
      return;
    }
    for (let i = 0; i < count && i < botIds.length; i++) {
      this.leave(botIds[i]);
    }
  }

  clearDemoBots() {
    let removedBots = 0;
    for (const [id, r] of Array.from(this.activeMap.entries())) {
      if (r.isBot || id.startsWith('bot-')) {
        this.leave(id);
        removedBots++;
      }
    }
    for (const [id, p] of Array.from(this.waitingMap.entries())) {
      if (p.isBot || id.startsWith('bot-')) {
        this.leave(id);
        removedBots++;
      }
    }
    if (removedBots === 0) {
      this.clearAllRunners();
    }
  }

  clearAllRunners() {
    this.activeMap.clear();
    this.waitingMap.clear();
    this.botSeeds.clear();
  }

  hostCommand(cmd: HostCommand) {
    switch (cmd.action) {
      case 'start_now': {
        if (this.phase !== 'LOBBY') {
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
        this.addDemoBots(cmd.count ?? 1);
        break;
      }
      case 'remove_bots': {
        this.removeDemoBots(cmd.count ?? 1);
        break;
      }
      case 'clear_bots': {
        this.clearDemoBots();
        break;
      }
      case 'clear_all': {
        this.clearAllRunners();
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
        const botFactor = 0.96 + (idx % 3) * 0.035 + wave * 0.03;
        r.d = +(this.referenceDistance * botFactor).toFixed(1);
        r.lane = ((Math.floor(elapsed / 3.2) + idx) % 3 + 3) % 3;
        r.x = laneX(r.lane);
        r.floor = this.currentFloor;
        r.coins = Math.floor(elapsed * (1.8 + idx * 0.25));
        r.score = Math.floor(r.d * 2.2 + r.coins * 15);
        r.collectedCount = Math.min(9, Math.floor(p01 * 9));
        const botPhaseTime = elapsed + idx * 3.2;
        const centerCycle = (Math.floor(botPhaseTime / 11) + idx) % 9 + 1;
        r.activeCenter = (botPhaseTime % 11 < 6.5) ? (centerCycle as CenterId) : null;
        if (r.activeCenter === 1) {
          r.y = 3.6 + Math.sin(elapsed * 5 + idx) * 0.22;
          r.sliding = false;
          r.stumbling = false;
        } else if (r.activeCenter === 7 || r.activeCenter === 9) {
          r.y = Math.max(0, Math.sin(elapsed * 2.8 + idx) * 2.2);
          r.sliding = false;
          r.stumbling = false;
        } else {
          r.y = Math.sin(elapsed * 3 + idx) > 0.85 ? 1.5 : 0;
          r.sliding = r.y === 0 && Math.sin(elapsed * 2.1 + idx * 1.9) > 0.9;
          r.stumbling = false;
        }
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
      r.lane = 1;
      r.x = 0;
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
    const anchorD = meanD > 0 ? meanD : this.referenceDistance;

    runners.forEach((r, idx) => {
      r.rank = idx + 1;
      const rawOffset = (r.d - anchorD) * 0.22;
      r.packOffsetZ = +Math.max(-6, Math.min(6, rawOffset)).toFixed(2);
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
  | { type: 'join'; profile: PlayerProfile; immediate?: boolean }
  | { type: 'leave'; id: string }
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
  private lastJoinedImmediate = true;
  private lastWsMessageAt = 0;
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
      this.pollHttpSnapshot();
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

  private useDirectPortFallback = false;
  private lastHttpSyncAt = 0;
  private httpPollInFlight = false;
  private httpPollTick = 0;

  private getBasePath(): string {
    return (window.location.pathname || '/')
      .replace(/\/index\.html$/i, '')
      .replace(/\/+$/, '');
  }

  private resolveWsUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname || 'localhost';
    const port = window.location.port;
    const basePath = this.getBasePath();
    // In Vite dev/preview (ports 5173 / 4173), connect directly to port 8787.
    // In production (Nginx / Nginx Proxy Manager at `/` or `/technosurfers/`), connect to `${basePath}/ws`
    // on the same origin first, and fall back to `:8787/ws` if same-origin isn't proxying WebSockets.
    const isViteDev = port === '5173' || port === '4173';
    if (isViteDev || (this.useDirectPortFallback && window.location.protocol !== 'https:')) {
      return `${proto}//${hostname}:8787${basePath}/ws`;
    }
    return `${proto}//${window.location.host}${basePath}/ws`;
  }

  private resolveHttpSyncUrl(): string {
    const proto = window.location.protocol;
    const hostname = window.location.hostname || 'localhost';
    const port = window.location.port;
    const basePath = this.getBasePath();
    const isViteDev = port === '5173' || port === '4173';
    if (isViteDev) {
      return `${proto}//${hostname}:8787${basePath}/api/sync`;
    }
    return `${proto}//${window.location.host}${basePath}/api/sync`;
  }

  private postHttpMessage(msg: NetMessage) {
    if (typeof fetch === 'undefined') return;
    fetch(this.resolveHttpSyncUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
      keepalive: true,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((snap: RoomSnapshot | null) => {
        if (snap && snap.activeRunners) {
          this.lastHttpSyncAt = Date.now();
          this.latestSnapshot = snap;
          this.emit();
        }
      })
      .catch(() => {
        // ignore network error; local fallback remains active
      });
  }

  private pollHttpSnapshot() {
    const wsActive = this.wsConnected && Date.now() - this.lastWsMessageAt < 1200;
    if (typeof fetch === 'undefined' || this.httpPollInFlight || wsActive) return;
    this.httpPollInFlight = true;
    fetch(this.resolveHttpSyncUrl(), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((snap: RoomSnapshot | null) => {
        if (snap && snap.activeRunners) {
          this.lastHttpSyncAt = Date.now();
          this.latestSnapshot = snap;
          this.emit();
        }
      })
      .catch(() => {
        // ignore network error
      })
      .finally(() => {
        this.httpPollInFlight = false;
      });
  }

  private connectWebSocket() {
    try {
      const ws = new WebSocket(this.resolveWsUrl());
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.wsConnected = true;
        this.lastWsMessageAt = Date.now();
        if (this.lastJoinedProfile) {
          ws.send(
            JSON.stringify({
              type: 'join',
              profile: this.lastJoinedProfile,
              immediate: this.lastJoinedImmediate,
            } satisfies NetMessage),
          );
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as NetMessage;
          if (msg.type === 'snapshot') {
            this.lastWsMessageAt = Date.now();
            this.latestSnapshot = msg.snapshot;
            this.emit();
          }
        } catch {
          // ignore malformed packet
        }
      };
      ws.onclose = () => {
        this.wsConnected = false;
        if (!opened) {
          this.useDirectPortFallback = !this.useDirectPortFallback;
        }
        setTimeout(() => {
          if (!this.wsConnected) this.connectWebSocket();
        }, 1800);
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
    if (this.wsConnected && Date.now() - this.lastWsMessageAt < 1200) return;
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
    // Apply joins, leaves, runner states, and host commands to our local room
    if (msg.type === 'join') {
      this.localRoom.join(msg.profile, { immediate: msg.immediate });
    } else if (msg.type === 'leave') {
      this.localRoom.leave(msg.id);
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
      if (this.wsConnected && Date.now() - this.lastWsMessageAt < 1200) return;

      // Poll HTTP `/api/sync` every ~66ms when WebSocket is blocked or stalled by a reverse proxy
      this.httpPollTick = (this.httpPollTick + 1) % 2;
      if (this.httpPollTick === 0) {
        this.pollHttpSnapshot();
      }
      if (Date.now() - this.lastHttpSyncAt < 2500) {
        return;
      }

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
    }, 33);
  }

  onSnapshot(cb: (snap: RoomSnapshot) => void) {
    this.listeners.push(cb);
    cb(this.latestSnapshot);
  }

  getSnapshot(): RoomSnapshot {
    return this.latestSnapshot;
  }

  join(profile: PlayerProfile, options?: { immediate?: boolean }) {
    const cleanAvatar = sanitizeAvatarId(profile.avatar);
    const cleanProfile: PlayerProfile = {
      ...profile,
      name: sanitizeNickname(profile.name),
      role: profile.role || 'senior',
      color: profile.color || AVATAR_COLORS[0],
      avatar: cleanAvatar,
    };
    this.lastJoinedProfile = cleanProfile;
    this.lastJoinedImmediate = options?.immediate ?? true;
    const msg: NetMessage = { type: 'join', profile: cleanProfile, immediate: this.lastJoinedImmediate };

    this.localRoom.join(cleanProfile, { immediate: this.lastJoinedImmediate });

    // Optimistically patch latestSnapshot immediately so UI & 3D badges reflect the new name/avatar without delay
    for (const r of this.latestSnapshot.activeRunners) {
      if (r.id === cleanProfile.id) {
        r.name = cleanProfile.name;
        r.role = cleanProfile.role;
        r.color = cleanProfile.color;
        r.avatar = cleanAvatar;
      }
    }
    for (const r of this.latestSnapshot.top10) {
      if (r.id === cleanProfile.id) {
        r.name = cleanProfile.name;
        r.role = cleanProfile.role;
        r.color = cleanProfile.color;
        r.avatar = cleanAvatar;
      }
    }
    for (const w of this.latestSnapshot.waitingQueue) {
      if (w.id === cleanProfile.id) {
        w.name = cleanProfile.name;
        w.role = cleanProfile.role;
        w.color = cleanProfile.color;
        w.avatar = cleanAvatar;
      }
    }

    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        // ignore WS send error; HTTP sync below will deliver
      }
    }
    // Always post join via HTTP `/api/sync` as well so proxies/mobile networks never drop a name change
    this.postHttpMessage(msg);
    if (
      Date.now() - this.lastHttpSyncAt >= 2500 &&
      (this.isAuthorityTab || Date.now() - this.lastAuthoritySnapshotAt >= 1200)
    ) {
      this.latestSnapshot = this.localRoom.getSnapshot();
    }
    this.bc?.postMessage(msg);
    this.emit();
  }

  leave(id: string) {
    if (!id) return;
    if (this.lastJoinedProfile?.id === id) {
      this.lastJoinedProfile = null;
    }
    const msg: NetMessage = { type: 'leave', id };
    this.localRoom.leave(id);
    this.latestSnapshot = {
      ...this.latestSnapshot,
      activeRunners: this.latestSnapshot.activeRunners.filter((r) => r.id !== id),
      top10: this.latestSnapshot.top10.filter((r) => r.id !== id),
      waitingQueue: this.latestSnapshot.waitingQueue.filter((w) => w.id !== id),
    };
    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        // ignore WS send error
      }
    }
    this.postHttpMessage(msg);
    this.bc?.postMessage(msg);
    this.emit();
  }

  sendRunnerState(id: string, state: Partial<RunnerNetState>) {
    const msg: NetMessage = { type: 'state', id, state };
    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.postHttpMessage(msg);
      this.localRoom.updateRunnerState(id, state);
      this.bc?.postMessage(msg);
    }
  }

  sendHostCommand(command: HostCommand) {
    const msg: NetMessage = { type: 'host', command };
    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        // ignore WS send error
      }
    }
    this.postHttpMessage(msg);
    this.localRoom.hostCommand(command);
    if (Date.now() - this.lastHttpSyncAt >= 2500) {
      this.latestSnapshot = this.localRoom.getSnapshot();
    }
    this.bc?.postMessage(msg);
    this.bc?.postMessage({ type: 'snapshot', snapshot: this.latestSnapshot } satisfies NetMessage);
    this.emit();
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
