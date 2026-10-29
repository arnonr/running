import {
  GAME_TITLE, CENTERS, CENTER_LIST, POWER_DURATION, DEFAULT_MAX_LIVES,
  type CenterMeta,
} from './config';
import type { CenterId } from './sim/types';
import {
  AVATAR_COLORS, ROLE_LABELS, sanitizeNickname,
  CHANNEL_LIST, sanitizeChannelId,
  type PlayerProfile, type PlayerRole, type RoomSnapshot, type RunnerNetState, type HostCommand, type ChannelId,
} from './net';
import {
  AVATARS, AVATAR_LIST, sanitizeAvatarId, type AvatarId,
} from './view/avatars';
import type { AvatarPortraits } from './view/avatarPreview';
import { buildJoinQrSvg, resolveMobileJoinUrl } from './qr';

export type Screen = 'start' | 'countdown' | 'play' | 'pause' | 'over';

function formatSurvivedMMSS(sec: number): string {
  const safe = Number.isFinite(sec) ? sec : 0;
  const s = Math.max(0, Math.floor(safe));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function formatHeartsPill(lives: number, maxLives: number): string {
  if (!Number.isFinite(maxLives) || maxLives <= 0) {
    return '♾️ ไม่จำกัดชีวิต';
  }
  const total = Math.max(1, Math.floor(maxLives));
  const rem = Math.max(0, Math.min(total, Math.floor(Number.isFinite(lives) ? lives : total)));
  return `${'❤️'.repeat(rem)}${'🖤'.repeat(total - rem)} ${rem}/${total}`;
}

export function formatTvRunnerStatus(
  runner: Pick<RunnerNetState, 'isBot' | 'eliminated' | 'lives' | 'survivedSec'>,
  roomMaxLives: number,
): string {
  if (runner.isBot) return '🤖';
  if (runner.eliminated) {
    return `💀 ตาย ${formatSurvivedMMSS(runner.survivedSec ?? 0)}`;
  }
  if (!Number.isFinite(roomMaxLives) || roomMaxLives <= 0) {
    return '';
  }
  const total = Math.max(1, Math.floor(roomMaxLives));
  const rem = Math.max(0, Math.min(total, Math.floor(runner.lives ?? total)));
  return `${'❤️'.repeat(rem)}${'🖤'.repeat(total - rem)}`;
}

export function describeResultHeader(opts: {
  eliminated: boolean;
  maxLives: number;
  survivedSec: number;
  rank: number;
  totalRunners: number;
  collectedCount: number;
  soloRun?: boolean;
  queuedNextRound?: boolean;
}): {
  titleTh: string;
  subtitleTh: string;
  ctaLabelTh: string;
  ctaDisabled: boolean;
} {
  const shownMax = opts.maxLives > 0 ? Math.floor(opts.maxLives) : DEFAULT_MAX_LIVES;
  const total = Math.max(1, opts.totalRunners);
  const survivedText = formatSurvivedMMSS(opts.survivedSec);
  const titleTh = opts.eliminated
    ? `💥 ชนครบ ${shownMax} ครั้ง! สิ้นสุดการวิ่ง`
    : '🎉 พิชิตชั้น 10 สำเร็จ!';

  let subtitleTh: string;
  if (opts.soloRun) {
    subtitleTh = opts.eliminated
      ? `โหมดวิ่งเดี่ยว · อยู่รอด ${survivedText} · สะสม ${opts.collectedCount} / 9 ศูนย์วิจัย`
      : `โหมดวิ่งเดี่ยว · สะสมครบ ${opts.collectedCount} / 9 ศูนย์วิจัย`;
  } else {
    subtitleTh = opts.eliminated
      ? `อยู่รอด ${survivedText} · อันดับปัจจุบัน: #${opts.rank} จาก ${total} คน`
      : `อันดับของคุณในรอบนี้: #${opts.rank} จาก ${total} คน`;
  }

  if (opts.soloRun) {
    return {
      titleTh,
      subtitleTh,
      ctaLabelTh: '🔄 เริ่มวิ่งใหม่อีกครั้ง',
      ctaDisabled: false,
    };
  }

  if (opts.queuedNextRound) {
    return {
      titleTh,
      subtitleTh,
      ctaLabelTh: '✅ อยู่ในคิวรอรอบถัดไป (รอดูผลบนจอทีวี)',
      ctaDisabled: true,
    };
  }

  return {
    titleTh,
    subtitleTh,
    ctaLabelTh: '⏳ เข้าคิวรอรอบถัดไป',
    ctaDisabled: false,
  };
}

export function shouldStepSimInScreen(screen: Screen, soloRun: boolean): boolean {
  return screen === 'play' || (screen === 'pause' && !soloRun);
}

export function shouldCancelDeathReveal(
  prevPhase: RoomSnapshot['phase'],
  nextPhase: RoomSnapshot['phase'],
): boolean {
  return (nextPhase === 'LOBBY' || nextPhase === 'COUNTDOWN') && nextPhase !== prevPhase;
}

export interface AvatarShowcaseViewModel {
  avatarId: AvatarId;
  titleTh: string;
  badgeTh: string;
  playerLabelTh: string;
  accentHex: string;
  auraHex: string;
  portraitUrl: string | null;
  icon: string;
}

export function describeAvatarShowcase(
  profile: PlayerProfile,
  portraits?: AvatarPortraits,
): AvatarShowcaseViewModel {
  const avatarId = sanitizeAvatarId(profile.avatar);
  const meta = AVATARS[avatarId];
  const roleTh = ROLE_LABELS[profile.role] ?? ROLE_LABELS.senior;
  const cleanName = (profile.name || '').trim() || `${meta.nameTh} Techno`;
  return {
    avatarId,
    titleTh: `${meta.icon} ${meta.nameTh}`,
    badgeTh: `${meta.genderLabelTh} · ${meta.roleBadgeTh}`,
    playerLabelTh: `${cleanName} (${roleTh})`,
    accentHex: meta.accentHex,
    auraHex: profile.color || '#38bdf8',
    portraitUrl: portraits?.[avatarId] ?? null,
    icon: meta.icon,
  };
}

export interface ExhibitionCenterItem extends CenterMeta {
  unlocked: boolean;
}

export interface ExhibitionFloorGroup {
  floor: 1 | 2 | 8 | 9 | 10;
  floorTitleTh: string;
  centers: ExhibitionCenterItem[];
}

const FLOOR_TITLES: Record<1 | 2 | 8 | 9 | 10, string> = {
  1: 'ชั้น 1 · โถงนิทรรศการหลัก (Main Exhibition Hall — 4 ศูนย์)',
  2: 'ชั้น 2 · โรงประลองหุ่นยนต์และระบบอัตโนมัติ',
  8: 'ชั้น 8 · ห้องปฏิบัติการเรดาร์ และเทคโนโลยีชีวภาพและเคมีชีวภาพ (2 ศูนย์)',
  9: 'ชั้น 9 · ห้องปฏิบัติการนวัตกรรมเครื่องมือแพทย์',
  10: 'ชั้น 10 · สถาบันเทคโนโลยีอวกาศนานาชาติฯ',
};

/**
 * Groups all 9 TechnoPark centers by their actual physical exhibition floor (1, 2, 8, 9, 10)
 * from the SRS v5 table and marks which ones the player unlocked during the run.
 */
export function groupCentersByExhibitionFloor(collected: Iterable<CenterId>): ExhibitionFloorGroup[] {
  const set = new Set<CenterId>(collected);
  const floors: Array<1 | 2 | 8 | 9 | 10> = [1, 2, 8, 9, 10];
  return floors.map((floor) => ({
    floor,
    floorTitleTh: FLOOR_TITLES[floor],
    centers: CENTER_LIST.filter((c) => c.exhibitionFloorGroup === floor).map((c) => ({
      ...c,
      unlocked: set.has(c.id),
    })),
  }));
}

export interface UIHandlers {
  joinQueue(profile: PlayerProfile): void;
  playSoloNow(profile: PlayerProfile): void;
  queueNextRound?(): void;
  selectAvatar?(avatarId: AvatarId, profile: PlayerProfile): void;
  onPreviewRotate?(deltaRad: number): void;
  onPreviewTap?(): void;
  selectChannel?(ch: ChannelId): void;
  profileChange?(profile: PlayerProfile): void;
  editProfile?(): void;
  controlAction?(action: 'left' | 'right' | 'up' | 'down'): void;
  resume(): void;
  pause(): void;
  restart(): void;
  home(): void;
  toggleMute(): void;
  hostCommand(cmd: HostCommand): void;
  toggleTvMode(): void;
}

const ICON = {
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

export class UI {
  root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  screen: Screen = 'start';
  touch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  private hintTimer = 0;
  private toastTimer = 0;
  private holoTimer = 0;
  private livesPulseTimer = 0;
  private lastHudLives: number | null = null;
  private lastHudMaxLives: number | null = null;
  private latestRoomPhase: RoomSnapshot['phase'] = 'LOBBY';
  private lastResultSoloRun = false;
  private lastResultMaxLives = DEFAULT_MAX_LIVES;
  private lastResultCollectedCount = 0;
  private profile: PlayerProfile;
  private tvMode = false;
  private lobbyReady = false;
  private channel: ChannelId = '1';
  private portraits: AvatarPortraits = {};

  constructor(
    root: HTMLElement,
    private handlers: UIHandlers,
    muted: boolean,
    initialProfile: PlayerProfile,
    tvMode = false,
    initialChannel: ChannelId = '1',
  ) {
    this.root = root;
    this.profile = { ...initialProfile, avatar: sanitizeAvatarId(initialProfile.avatar) };
    this.tvMode = tvMode;
    this.channel = sanitizeChannelId(initialChannel);
    this.renderDOM();
    this.setMuted(muted);
    this.setTvMode(tvMode);
    this.setChannel(this.channel);
  }

  private renderDOM() {
    const stampsHtml = CENTER_LIST.map(
      (c) => `<div class="c-stamp" id="stamp-${c.id}" title="${c.shortTh}">${c.icon}</div>`,
    ).join('');

    const rolesHtml = (Object.keys(ROLE_LABELS) as PlayerRole[])
      .map(
        (r) =>
          `<button type="button" class="role-btn ${this.profile.role === r ? 'on' : ''}" data-role="${r}">${ROLE_LABELS[r]}</button>`,
      )
      .join('');

    const colorsHtml = AVATAR_COLORS.map(
      (col) =>
        `<button type="button" class="color-dot ${this.profile.color === col ? 'on' : ''}" data-color="${col}" style="background:${col}" aria-label="color ${col}"></button>`,
    ).join('');

    const currentAvatar = sanitizeAvatarId(this.profile.avatar);
    const showcaseVm = describeAvatarShowcase(this.profile, this.portraits);
    const defaultAvatarNames = new Set([
      'นักวิ่ง Techno',
      ...AVATAR_LIST.map((a) => `${a.nameTh} Techno`),
    ]);
    const initialInputValue = defaultAvatarNames.has(this.profile.name) ? '' : this.profile.name;
    const avatarsHtml = AVATAR_LIST.map(
      (av) =>
        `<button type="button" class="avatar-card ${currentAvatar === av.id ? 'on' : ''}" data-avatar="${av.id}" style="--av-accent:${av.accentHex}">
          <img class="av-thumb" alt="${av.nameTh}" />
          <span class="av-ico">${av.icon}</span>
          <b class="av-name">${av.nameTh}</b>
          <small class="av-sub">${av.genderLabelTh} · ${av.roleBadgeTh}</small>
        </button>`,
    ).join('');

    const channelsHtml = CHANNEL_LIST.map(
      (ch) =>
        `<button type="button" class="ch-btn ${this.channel === ch ? 'on' : ''}" data-ch="${ch}">📡 CH ${ch}</button>`,
    ).join('');

    this.root.innerHTML = `
      <div class="hud" id="hud">
        <div class="hud-left">
          <div class="hud-btns">
            <button class="icon-btn" id="btn-pause" aria-label="pause">${ICON.pause}</button>
            <button class="icon-btn" id="btn-mute" aria-label="mute"></button>
          </div>
          <div class="player-pill" id="hud-player-pill">
            <span class="pp-dot" id="hud-player-dot" style="background:${this.profile.color}"></span>
            <span class="pp-name" id="hud-player-name">${AVATARS[currentAvatar].icon} ${this.profile.name}</span>
          </div>
          <button type="button" class="edit-profile-btn" id="btn-edit-profile">✏️ เปลี่ยนชื่อ / ตัวละคร</button>
          <div class="floor-pill">
            <b id="hud-floor">FLOOR 1 / 10</b>
            <small id="hud-zone">โถงนิทรรศการหลัก</small>
          </div>
          <div class="rank-pill" id="hud-rank">อันดับ #1</div>
        </div>

        <div class="hud-center">
          <div class="timer-box">
            <span>เวลาคงเหลือ</span>
            <b id="hud-timer">03:00</b>
          </div>
          <div class="elev-bar"><i id="hud-progress"></i></div>
          <div class="center-stamps" id="hud-stamps">${stampsHtml}</div>
        </div>

        <div class="hud-right">
          <div class="score" id="score">000000</div>
          <div class="hud-lives" id="hud-lives">❤️❤️❤️ 3/3</div>
          <div class="hud-row">
            <span class="mult" id="mult">×1</span>
            <span class="coins"><span class="coin-ico"></span><b id="coins">0</b></span>
          </div>
          <div class="active-power" id="active-power">
            <b id="ap-name">Jet Fighter Pack</b>
            <small id="ap-sub">5.0s</small>
            <em id="ap-bar"></em>
          </div>
        </div>

        <div class="holo-banner" id="holo-banner">
          <div class="holo-ico" id="holo-ico">✈️</div>
          <div class="holo-body">
            <span class="holo-tag" id="holo-floor">ชั้น 1 (โถงนิทรรศการหลัก)</span>
            <h4 id="holo-title">ศูนย์ปฏิบัติการเทคโนโลยีอากาศยานฯ</h4>
            <p id="holo-desc">ติดไอพ่นเครื่องบินรบบินลอยเหนือพื้นราง!</p>
          </div>
        </div>

        <div class="hint" id="hint"></div>
        <div class="toast" id="toast"></div>

        <!-- On-Screen Mobile Touch Controller Pad -->
        <div class="mobile-pad" id="mobile-pad">
          <div class="mp-grid">
            <button type="button" class="mp-btn" data-act="left" aria-label="เลี้ยวซ้าย">
              <span class="mp-ico">◀</span>
              <b>ซ้าย</b>
            </button>
            <button type="button" class="mp-btn mp-up" data-act="up" aria-label="กระโดด">
              <span class="mp-ico">▲</span>
              <b>กระโดด</b>
            </button>
            <button type="button" class="mp-btn mp-down" data-act="down" aria-label="กลิ้งหลบ">
              <span class="mp-ico">▼</span>
              <b>กลิ้งหลบ</b>
            </button>
            <button type="button" class="mp-btn" data-act="right" aria-label="เลี้ยวขวา">
              <span class="mp-ico">▶</span>
              <b>ขวา</b>
            </button>
          </div>
        </div>
      </div>

      <div class="flash" id="flash"></div>

      <!-- Start / Quick Join & Waiting Lobby Screen -->
      <section class="screen start on" id="s-start">
        <div class="panel">
          <h1>${GAME_TITLE.en}</h1>
          <p class="sub-th">${GAME_TITLE.th}</p>

          <div class="form-row">
            <label>📡 ช่องสัญญาณบูธ (เลือกให้ตรงกับจอทีวีจุดของคุณ)</label>
            <div class="ch-grid" id="mobile-ch-grid">${channelsHtml}</div>
          </div>

          <div class="form-row">
            <label for="inp-name">1. กรอกชื่อตัวละครของคุณ (แสดงบนตัวละครและจอทีวี)</label>
            <div class="name-input-wrap">
              <input class="name-input" id="inp-name" maxlength="24" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="พิมพ์ชื่อตัวละคร เช่น นนท์, เมย์..." value="${initialInputValue}" />
              <button type="button" class="name-clear-btn" id="btn-clear-name" title="ล้างชื่อเพื่อพิมพ์ใหม่" aria-label="ล้างชื่อ">✕</button>
            </div>
          </div>

          <div class="form-row">
            <label>2. เลือกตัวละครนักวิ่ง 3D (5 สไตล์ · ชาย / หญิง / ชุดอวกาศ)</label>
            <div class="avatar-showcase" id="avatar-showcase" style="--av-accent:${showcaseVm.accentHex}">
              <div class="av-stage-wrap" id="av-stage-wrap" title="ลากเพื่อหมุนดูตัวละคร 360° หรือแตะเพื่อโพสท่า">
                <canvas id="avatar-preview-canvas"></canvas>
                <span class="av-stage-hint">🔄 ลากหมุน 360°</span>
              </div>
              <div class="av-info">
                <span class="av-info-kicker">✨ ตัวอย่างตัวละคร 3D ของคุณ</span>
                <b class="av-info-title" id="av-show-title">${showcaseVm.titleTh}</b>
                <span class="av-info-badge" id="av-show-badge">${showcaseVm.badgeTh}</span>
                <div class="av-info-pill" id="av-show-pill">
                  <span class="pp-dot" id="av-show-dot" style="background:${showcaseVm.auraHex}"></span>
                  <span id="av-show-player">${showcaseVm.playerLabelTh}</span>
                </div>
                <small style="font-size:10.5px;color:#94a3b8;line-height:1.25">แตะตัวละครเพื่อกระโดดโพสท่า · ลากซ้าย-ขวาหมุนดูชุดรอบตัว</small>
              </div>
            </div>
            <div class="avatar-grid" id="avatar-grid">${avatarsHtml}</div>
          </div>

          <div class="form-row">
            <label>3. ระดับชั้น / สถานะผู้เข้าชม</label>
            <div class="role-grid" id="role-grid">${rolesHtml}</div>
          </div>

          <div class="form-row">
            <label>4. สีออร่านักวิ่งประจำตัว</label>
            <div class="color-row" id="color-row">${colorsHtml}</div>
          </div>

          <div class="lobby-status" id="lobby-box">
            <div class="ls-top">
              <span id="ls-phase">🟢 ห้องรอเริ่มรอบถัดไป (LOBBY)</span>
              <b id="ls-timer" style="color:#facc15">45s</b>
            </div>
            <div class="ls-sub" id="ls-desc">
              กรอกชื่อและเลือกตัวละครด้านบน แล้วกดปุ่ม "เข้าสู่ Lobby" เพื่อส่งข้อมูลขึ้นจอทีวี!
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">
              ${CENTER_LIST.map((c) => `<span style="font-size:11px;padding:2px 6px;border-radius:6px;background:rgba(15,23,42,.8);border:1px solid ${c.color}66" title="${c.nameTh} (${c.exhibitionFloorTh})">${c.icon} #${c.id} ${c.shortTh}</span>`).join('')}
            </div>
          </div>

          <button class="big gold-btn" id="btn-join-sync">🚀 เข้าสู่ Lobby · ส่งข้อมูลขึ้นจอทีวี</button>
          <button class="big" id="btn-play-solo">⚡ วิ่งฝึกซ้อมเดี่ยว (ไม่ซิงค์ทีวี)</button>
        </div>
      </section>

      <!-- Synchronized 3..2..1 Countdown Overlay -->
      <section class="screen countdown" id="s-countdown">
        <div style="text-align:center">
          <div style="font-size:18px;font-weight:800;color:#38bdf8;margin-bottom:8px">เตรียมตัวออกตัวพร้อมกัน!</div>
          <div class="cd-num" id="cd-num">3</div>
        </div>
      </section>

      <!-- Pause Screen -->
      <section class="screen pause" id="s-pause">
        <div class="panel">
          <h2>พักการวิ่งชั่วคราว</h2>
          <p class="sub-th" id="pause-note" style="display:none;color:#fde047"></p>
          <button class="big" id="btn-resume">วิ่งต่อเลย</button>
          <button class="ghost" id="btn-restart">เริ่มรอบใหม่</button>
          <button class="ghost" id="btn-home">กลับหน้าล็อบบี้</button>
        </div>
      </section>

      <!-- Result + Smart Wayfinding Screen -->
      <section class="screen over" id="s-over">
        <div class="panel">
          <h2 id="r-title">🎉 พิชิตชั้น 10 สำเร็จ!</h2>
          <p class="sub-th" id="r-rank-line">อันดับของคุณในรอบนี้: #1</p>

          <div class="result-grid">
            <div><small>คะแนนรวม</small><b id="r-score">0</b></div>
            <div><small>เหรียญ</small><b id="r-coins">0</b></div>
            <div><small>ระยะทาง</small><b id="r-dist">0m</b></div>
            <div><small>ศูนย์ที่เก็บได้</small><b id="r-centers">0/9</b></div>
          </div>

          <div class="wayfinding-box">
            <p class="wf-title">🧭 พิกัดชมบูธจริง 9 ศูนย์วิจัย ณ อาคารเทคโนพาร์ค</p>
            <div id="wf-list"></div>
          </div>

          <button class="big gold-btn" id="btn-again">🔄 รอวิ่งรอบถัดไป / เล่นอีกครั้ง</button>
          <button class="ghost" id="btn-home2">กลับหน้าล็อบบี้</button>
        </div>
      </section>

      <!-- 16:9 TV Live Arena Overlay (?mode=tv) -->
      <div class="tv-layer" id="tv-layer">
        <div class="tv-top">
          <div class="tv-brand">
            <h2>${GAME_TITLE.en}</h2>
            <p>${GAME_TITLE.th} · ลู่วิ่งรวมถ่ายทอดสด (Synchronized Shared Track)</p>
          </div>
          <div class="tv-clock">
            <span class="tv-ch-badge" id="tv-ch-badge">📡 CH ${this.channel}</span>
            <span class="tv-phase" id="tv-phase">รอบที่ #1 · LOBBY</span>
            <span class="tv-timer" id="tv-timer">00:45</span>
          </div>
        </div>

        <div class="tv-main">
          <div class="tv-left-col">
            <div class="tv-qr-card">
              <div class="tv-qr-svg" id="tv-qr-svg">${this.buildQrSvg()}</div>
              <div class="tv-qr-info">
                <h4>📱 สแกน QR เข้าร่วมวิ่ง!</h4>
                <p id="tv-join-url">สแกนเข้า <b style="color:#facc15">CH ${this.channel}</b> ด้วยกล้องมือถือ: <b style="color:#38bdf8;word-break:break-all">${resolveMobileJoinUrl(undefined, undefined, this.channel)}</b></p>
              </div>
            </div>

            <div class="tv-host-card">
              <h4>🎛️ แผงควบคุมพิธีกรประจำบูธ (Admin Controls)</h4>
              <div class="tv-host-btns">
                <div class="ch-grid" id="tv-ch-grid" style="grid-column:span 2;margin-bottom:2px">${channelsHtml}</div>
                <button class="tv-btn primary" id="tv-btn-start">🚀 เริ่มปล่อยตัวรอบนี้ / เริ่มใหม่ (Admin Start)</button>
                <button class="tv-btn danger" id="tv-btn-stop" style="grid-column:span 2;background:rgba(225,29,72,.28);border-color:#fb7185;color:#fecdd3">🛑 หยุดรอบกลางคัน / รีเซ็ตกลับล็อบบี้ (Stop & Reset)</button>
                <div style="grid-column:span 2;display:grid;grid-template-columns:1fr 1fr 1.15fr;gap:6px">
                  <button class="tv-btn" id="tv-btn-bots" style="background:rgba(34,197,94,.2);border-color:#4ade80;color:#bbf7d0">➕ เพิ่มบอท</button>
                  <button class="tv-btn" id="tv-btn-bot-remove" style="background:rgba(245,158,11,.2);border-color:#fbbf24;color:#fde68a">➖ ลดบอท</button>
                  <button class="tv-btn" id="tv-btn-bot-clear" style="background:rgba(148,163,184,.18);border-color:#94a3b8;color:#e2e8f0">🤖 ล้างบอท (0)</button>
                </div>
                <div style="grid-column:span 2;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
                  <button class="tv-btn" id="tv-btn-dur180">⏱️ 3 นาที (180s)</button>
                  <button class="tv-btn" id="tv-btn-dur120">⏱️ 2 นาที (120s)</button>
                  <button class="tv-btn" id="tv-btn-dur90">⏱️ 1.5 นาที (90s)</button>
                </div>
                <div style="grid-column:span 2;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
                  <button class="tv-btn" id="tv-btn-lives3">❤️ 3 ชีวิต</button>
                  <button class="tv-btn" id="tv-btn-lives5">❤️ 5 ชีวิต</button>
                  <button class="tv-btn" id="tv-btn-lives0">♾️ ไม่ตาย</button>
                </div>
              </div>
            </div>
          </div>

          <div class="tv-right-col">
            <div class="tv-board-card">
              <h3><span>🏆 ผู้นำในรอบปัจจุบัน (Top 10)</span><small id="tv-active-count">0 คน</small></h3>
              <div class="tv-lb-list" id="tv-lb-list"></div>
            </div>

            <div class="tv-board-card">
              <h3><span>⏳ คิวผู้เล่นรอรอบถัดไป</span><small id="tv-wait-count">0 คน</small></h3>
              <div id="tv-wait-list" style="font-size:12px;color:#cbd5e1">ยังไม่มีผู้เล่นในคิวรอ</div>
            </div>

            <div class="tv-board-card">
              <h3><span>🌟 สถิติสูงสุดประจำวัน (Hall of Fame)</span></h3>
              <div id="tv-best-list" style="font-size:12px;color:#facc15"></div>
            </div>
          </div>
        </div>
      </div>

      <button class="mode-switch" id="btn-mode-switch">📺 สลับโหมดจอทีวี (TV Arena)</button>
    `;

    this.root.querySelectorAll<HTMLElement>('[id]').forEach((e) => (this.el[e.id] = e));

    // Profile inputs
    const nameInp = this.el['inp-name'] as HTMLInputElement;
    const syncProfileFromInputs = () => {
      const raw = (nameInp?.value || '').trim();
      const avMeta = AVATARS[sanitizeAvatarId(this.profile.avatar)];
      this.profile.name = raw ? sanitizeNickname(raw) : sanitizeNickname(`${avMeta.nameTh} Techno`);
      this.updatePlayerPill();
      this.handlers.profileChange?.({ ...this.profile });
    };

    nameInp.addEventListener('input', syncProfileFromInputs);
    nameInp.addEventListener('change', syncProfileFromInputs);
    nameInp.addEventListener('blur', syncProfileFromInputs);
    nameInp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        syncProfileFromInputs();
        nameInp.blur();
      }
    });

    this.el['btn-clear-name']?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      nameInp.value = '';
      syncProfileFromInputs();
      nameInp.focus();
    });

    this.el['role-grid'].querySelectorAll<HTMLButtonElement>('[data-role]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.profile.role = btn.dataset.role as PlayerRole;
        this.el['role-grid'].querySelectorAll('.role-btn').forEach((b) => b.classList.toggle('on', b === btn));
        syncProfileFromInputs();
      });
    });

    this.el['color-row'].querySelectorAll<HTMLButtonElement>('[data-color]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.profile.color = btn.dataset.color!;
        this.el['color-row'].querySelectorAll('.color-dot').forEach((b) => b.classList.toggle('on', b === btn));
        syncProfileFromInputs();
      });
    });

    this.el['avatar-grid']?.querySelectorAll<HTMLButtonElement>('[data-avatar]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const avId = sanitizeAvatarId(btn.dataset.avatar);
        this.profile.avatar = avId;
        this.el['avatar-grid'].querySelectorAll('.avatar-card').forEach((b) => b.classList.toggle('on', b === btn));
        syncProfileFromInputs();
        this.handlers.selectAvatar?.(avId, { ...this.profile });
      });
    });

    const stageWrap = this.el['av-stage-wrap'];
    if (stageWrap) {
      let activePointerId: number | null = null;
      let lastX = 0;
      let movedPx = 0;
      stageWrap.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        activePointerId = ev.pointerId;
        lastX = ev.clientX;
        movedPx = 0;
        try { stageWrap.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
      });
      stageWrap.addEventListener('pointermove', (ev) => {
        if (activePointerId !== ev.pointerId) return;
        ev.stopPropagation();
        const dx = ev.clientX - lastX;
        lastX = ev.clientX;
        movedPx += Math.abs(dx);
        if (dx !== 0) {
          this.handlers.onPreviewRotate?.(dx * 0.018);
        }
      });
      const finishDrag = (ev: PointerEvent, allowTap: boolean) => {
        if (activePointerId !== ev.pointerId) return;
        ev.stopPropagation();
        activePointerId = null;
        try { stageWrap.releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
        if (allowTap && movedPx < 6) {
          this.handlers.onPreviewTap?.();
        }
      };
      stageWrap.addEventListener('pointerup', (ev) => finishDrag(ev, true));
      stageWrap.addEventListener('pointercancel', (ev) => finishDrag(ev, false));
    }

    this.root.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const nextCh = sanitizeChannelId(btn.dataset.ch);
        this.setChannel(nextCh);
        this.handlers.selectChannel?.(nextCh);
      });
    });

    this.el['mobile-pad']?.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
      btn.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const act = btn.dataset.act as 'left' | 'right' | 'up' | 'down';
        if (act) {
          try { navigator.vibrate?.(10); } catch { /* ignore */ }
          this.handlers.controlAction?.(act);
        }
      });
    });

    const tap = (id: string, fn: () => void) =>
      this.el[id]?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        fn();
      });

    tap('btn-join-sync', () => {
      syncProfileFromInputs();
      this.handlers.joinQueue({ ...this.profile });
    });
    tap('btn-play-solo', () => {
      syncProfileFromInputs();
      this.handlers.playSoloNow({ ...this.profile });
    });
    tap('btn-edit-profile', () => {
      this.setLobbyReady(false);
      this.handlers.editProfile?.();
      window.setTimeout(() => {
        try {
          nameInp.focus();
          nameInp.select();
        } catch {
          // ignore
        }
      }, 60);
    });
    tap('btn-pause', () => this.handlers.pause());
    tap('btn-mute', () => this.handlers.toggleMute());
    tap('btn-resume', () => this.handlers.resume());
    tap('btn-restart', () => this.handlers.restart());
    tap('btn-home', () => this.handlers.home());
    tap('btn-home2', () => this.handlers.home());
    tap('btn-again', () => {
      if (
        !this.lastResultSoloRun &&
        (this.latestRoomPhase === 'RUNNING' || this.latestRoomPhase === 'PODIUM') &&
        this.handlers.queueNextRound
      ) {
        this.handlers.queueNextRound();
      } else {
        this.handlers.restart();
      }
    });
    tap('btn-mode-switch', () => this.handlers.toggleTvMode());

    // TV Host Controls
    tap('tv-btn-start', () => this.handlers.hostCommand({ action: 'start_now' }));
    tap('tv-btn-stop', () => this.handlers.hostCommand({ action: 'force_lobby' }));
    tap('tv-btn-bots', () => this.handlers.hostCommand({ action: 'add_bots', count: 1 }));
    tap('tv-btn-bot-remove', () => this.handlers.hostCommand({ action: 'remove_bots', count: 1 }));
    tap('tv-btn-bot-clear', () => this.handlers.hostCommand({ action: 'clear_bots' }));
    tap('tv-btn-dur180', () => this.handlers.hostCommand({ action: 'set_duration', duration: 180 }));
    tap('tv-btn-dur120', () => this.handlers.hostCommand({ action: 'set_duration', duration: 120 }));
    tap('tv-btn-dur90', () => this.handlers.hostCommand({ action: 'set_duration', duration: 90 }));
    tap('tv-btn-lives3', () => this.handlers.hostCommand({ action: 'set_max_lives', maxLives: 3 }));
    tap('tv-btn-lives5', () => this.handlers.hostCommand({ action: 'set_max_lives', maxLives: 5 }));
    tap('tv-btn-lives0', () => this.handlers.hostCommand({ action: 'set_max_lives', maxLives: 0 }));

    for (const b of this.root.querySelectorAll('button, input')) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    this.updatePlayerPill();
  }

  updatePlayerPill(profile?: PlayerProfile) {
    if (profile) {
      this.profile = { ...profile, avatar: sanitizeAvatarId(profile.avatar) };
    }
    const av = AVATARS[sanitizeAvatarId(this.profile.avatar)];
    if (this.el['hud-player-name']) {
      this.el['hud-player-name'].textContent = `${av.icon} ${this.profile.name} (${ROLE_LABELS[this.profile.role]})`;
    }
    if (this.el['hud-player-dot']) {
      this.el['hud-player-dot'].style.background = this.profile.color;
    }

    const vm = describeAvatarShowcase(this.profile, this.portraits);
    if (this.el['avatar-showcase']) {
      this.el['avatar-showcase'].style.setProperty('--av-accent', vm.accentHex);
    }
    if (this.el['av-show-title']) {
      this.el['av-show-title'].textContent = vm.titleTh;
    }
    if (this.el['av-show-badge']) {
      this.el['av-show-badge'].textContent = vm.badgeTh;
    }
    if (this.el['av-show-player']) {
      this.el['av-show-player'].textContent = vm.playerLabelTh;
    }
    if (this.el['av-show-dot']) {
      this.el['av-show-dot'].style.background = vm.auraHex;
    }
  }

  setAvatarPortraits(portraits: AvatarPortraits) {
    this.portraits = { ...portraits };
    this.el['avatar-grid']?.querySelectorAll<HTMLButtonElement>('[data-avatar]').forEach((btn) => {
      const avId = sanitizeAvatarId(btn.dataset.avatar);
      const url = this.portraits[avId];
      const img = btn.querySelector<HTMLImageElement>('.av-thumb');
      if (img && url) {
        img.src = url;
        btn.classList.add('has-thumb');
      } else {
        btn.classList.remove('has-thumb');
      }
    });
    this.updatePlayerPill();
  }

  getAvatarPreviewCanvas(): HTMLCanvasElement | null {
    return (this.el['avatar-preview-canvas'] as HTMLCanvasElement | undefined) ?? null;
  }

  isStartFormVisible(): boolean {
    return !this.tvMode && this.screen === 'start' && !this.lobbyReady;
  }

  isLobbyReady(): boolean {
    return this.lobbyReady;
  }

  private buildQrSvg(): string {
    return buildJoinQrSvg(resolveMobileJoinUrl(undefined, undefined, this.channel));
  }

  getChannel(): ChannelId {
    return this.channel;
  }

  setChannel(ch: ChannelId) {
    this.channel = sanitizeChannelId(ch);
    this.root.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.ch === this.channel);
    });
    if (this.el['tv-ch-badge']) {
      this.el['tv-ch-badge'].textContent = `📡 CH ${this.channel}`;
    }
    const joinUrl = resolveMobileJoinUrl(undefined, undefined, this.channel);
    if (this.el['tv-qr-svg']) {
      this.el['tv-qr-svg'].innerHTML = buildJoinQrSvg(joinUrl);
    }
    if (this.el['tv-join-url']) {
      this.el['tv-join-url'].innerHTML = `สแกนเข้า <b style="color:#facc15">CH ${this.channel}</b> ด้วยกล้องมือถือ: <b style="color:#38bdf8;word-break:break-all">${joinUrl}</b>`;
    }
    if (this.el['btn-join-sync']) {
      this.el['btn-join-sync'].textContent = `🚀 เข้าสู่ Lobby (CH ${this.channel}) · ส่งข้อมูลขึ้นจอทีวี`;
    }
  }

  setTvMode(tv: boolean) {
    this.tvMode = tv;
    this.el['tv-layer']?.classList.toggle('on', tv);
    if (this.el['btn-mode-switch']) {
      this.el['btn-mode-switch'].textContent = tv ? '📱 สลับโหมดมือถือ (Mobile)' : '📺 สลับโหมดจอทีวี (TV Arena)';
      if (tv) this.el['btn-mode-switch'].style.display = '';
    }
    if (tv) {
      this.el['s-start']?.classList.remove('on');
      this.el['hud']?.classList.remove('on');
    } else {
      this.show(this.screen);
    }
  }

  setMuted(m: boolean) {
    if (this.el['btn-mute']) {
      this.el['btn-mute'].innerHTML = m ? ICON.muted : ICON.sound;
    }
  }

  setLobbyReady(ready: boolean) {
    this.lobbyReady = ready;
    this.show(this.screen);
  }

  show(s: Screen) {
    this.screen = s;
    this.root.dataset.screen = s;
    if (this.tvMode) {
      for (const k of ['start', 'countdown', 'pause', 'over'] as const) {
        this.el['s-' + k]?.classList.toggle('on', s === 'countdown' && k === 'countdown');
      }
      this.el.hud?.classList.remove('on');
      return;
    }
    for (const k of ['start', 'countdown', 'pause', 'over'] as const) {
      const showStart = k === 'start' ? s === 'start' && !this.lobbyReady : s === k;
      this.el['s-' + k]?.classList.toggle('on', showStart);
    }
    const showHud = s === 'play' || s === 'pause' || (s === 'start' && this.lobbyReady);
    this.el.hud?.classList.toggle('on', showHud);
    this.el['btn-edit-profile']?.classList.toggle('on', s === 'start' && this.lobbyReady);
    if (this.el['btn-mode-switch']) {
      this.el['btn-mode-switch'].style.display = this.touch || showHud ? 'none' : '';
    }
    if (s !== 'play') this.hint('');
  }

  setCountdown(secLeft: number) {
    const n = Math.max(1, Math.ceil(secLeft));
    if (this.el['cd-num']) {
      this.el['cd-num'].textContent = secLeft <= 0.3 ? 'GO!' : String(n);
    }
  }

  private formatMMSS(sec: number): string {
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  updateRoomSnapshot(snap: RoomSnapshot, localPlayerId: string) {
    this.latestRoomPhase = snap.phase;
    const isQueued = snap.waitingQueue.some((p) => p.id === localPlayerId);
    const isEliminatedThisRound =
      snap.eliminatedIds.includes(localPlayerId) ||
      snap.activeRunners.some((r) => r.id === localPlayerId && r.eliminated);
    const phaseLabel: Record<RoomSnapshot['phase'], string> = {
      LOBBY: `🟢 ห้องรอปล่อยตัว CH ${this.channel} (รอ Admin กดเริ่มบนทีวี)`,
      COUNTDOWN: `🟡 CH ${this.channel} · กำลังนับถอยหลังปล่อยตัว!`,
      RUNNING: `🔴 CH ${this.channel} · รอบปัจจุบันกำลังวิ่งแข่งขันอยู่!`,
      PODIUM: `🏆 CH ${this.channel} · สรุปผลผู้ชนะประจำรอบ (PODIUM)`,
    };
    if (this.el['ls-phase']) this.el['ls-phase'].textContent = phaseLabel[snap.phase];
    if (this.el['ls-timer']) {
      this.el['ls-timer'].textContent = snap.phase === 'LOBBY' ? 'READY' : this.formatMMSS(snap.phaseTimeLeft);
    }

    if (this.el['ls-desc']) {
      if (snap.phase === 'RUNNING') {
        if (isEliminatedThisRound) {
          this.el['ls-desc'].textContent = `คุณจบการวิ่งในรอบนี้แล้ว · อยู่ในคิวรอรอบถัดไป (#${snap.matchId + 1}) · รอบปัจจุบันอยู่ชั้น ${snap.currentFloor}/10 เหลือเวลา ${this.formatMMSS(snap.phaseTimeLeft)}`;
        } else if (isQueued) {
          this.el['ls-desc'].textContent = `คุณอยู่ในคิวรอบถัดไป (#${snap.matchId + 1}) · รอบปัจจุบันอยู่ชั้น ${snap.currentFloor}/10 เหลือเวลา ${this.formatMMSS(snap.phaseTimeLeft)}`;
        } else {
          this.el['ls-desc'].textContent = `รอบปัจจุบันกำลังวิ่งอยู่ที่ชั้น ${snap.currentFloor}/10 · กดปุ่มสีทองเพื่อลงสนามร่วมวิ่งทันที!`;
        }
      } else {
        this.el['ls-desc'].textContent = `มีผู้เล่นพร้อมในห้อง ${snap.activeRunners.length} คน · กดปุ่มสีทองเพื่อเข้าจุดปล่อยตัว แล้วรอ Admin กดเริ่มรอบบนจอทีวี!`;
      }
    }

    // Update TV Live Arena preset active states
    this.el['tv-btn-dur180']?.classList.toggle('on', snap.matchDuration === 180);
    this.el['tv-btn-dur120']?.classList.toggle('on', snap.matchDuration === 120);
    this.el['tv-btn-dur90']?.classList.toggle('on', snap.matchDuration === 90);
    this.el['tv-btn-lives3']?.classList.toggle('on', snap.maxLives === 3);
    this.el['tv-btn-lives5']?.classList.toggle('on', snap.maxLives === 5);
    this.el['tv-btn-lives0']?.classList.toggle('on', snap.maxLives === 0);

    // Update TV Live Arena
    if (this.el['tv-phase']) {
      const phaseTh = snap.phase === 'LOBBY' ? 'LOBBY (รอ Admin กดเริ่ม)' : snap.phase;
      this.el['tv-phase'].textContent = `รอบที่ #${snap.matchId} · ${phaseTh} · ชั้น ${snap.currentFloor}/10`;
    }
    if (this.el['tv-timer']) {
      this.el['tv-timer'].textContent = snap.phase === 'LOBBY' ? 'READY' : this.formatMMSS(snap.phaseTimeLeft);
    }
    if (this.el['tv-active-count']) {
      const botCount = snap.activeRunners.filter((r) => r.isBot).length;
      const humanRunners = snap.activeRunners.filter((r) => !r.isBot);
      const humanCount = humanRunners.length;
      const aliveHumans = humanRunners.filter((r) => !r.eliminated).length;
      this.el['tv-active-count'].textContent =
        humanCount > 0 && snap.maxLives > 0
          ? `ผู้เล่นรอด ${aliveHumans}/${humanCount} คน · บอท ${botCount}`
          : `${snap.activeRunners.length} คน (ผู้เล่น ${humanCount} · บอท ${botCount})`;
      if (this.el['tv-btn-bot-clear']) {
        if (botCount > 0) {
          this.el['tv-btn-bot-clear'].textContent = `🤖 ล้างบอท (${botCount})`;
        } else if (snap.activeRunners.length > 0) {
          this.el['tv-btn-bot-clear'].textContent = `🧹 ล้างตัวละคร (${snap.activeRunners.length})`;
        } else {
          this.el['tv-btn-bot-clear'].textContent = `🤖 ล้างบอท (0)`;
        }
      }
    }
    if (this.el['tv-lb-list']) {
      const lbList = this.el['tv-lb-list'];
      const rows = snap.top10;
      while (lbList.children.length > rows.length) {
        lbList.lastElementChild?.remove();
      }
      while (lbList.children.length < rows.length) {
        const rowEl = document.createElement('div');
        rowEl.className = 'tv-lb-row';
        rowEl.innerHTML = `<span class="tv-lb-rank"></span><span class="tv-lb-dot"></span><span class="tv-lb-name"></span><span class="tv-lb-status"></span><span class="tv-lb-score"></span>`;
        lbList.appendChild(rowEl);
      }
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowEl = lbList.children[i] as HTMLElement;
        rowEl.classList.toggle('top1', i === 0);
        rowEl.classList.toggle('eliminated', !!r.eliminated);
        const rankEl = rowEl.children[0] as HTMLElement;
        const dotEl = rowEl.children[1] as HTMLElement;
        const nameEl = rowEl.children[2] as HTMLElement;
        const statusEl = rowEl.children[3] as HTMLElement;
        const scoreEl = rowEl.children[4] as HTMLElement;
        const rankText = `#${r.rank}`;
        if (rankEl.textContent !== rankText) rankEl.textContent = rankText;
        if (dotEl.style.background !== r.color) dotEl.style.background = r.color;
        const cIcon = r.activeCenter ? CENTERS[r.activeCenter].icon : '';
        const avIcon = AVATARS[sanitizeAvatarId(r.avatar)].icon;
        const prefix = r.name.includes(avIcon) ? '' : `${avIcon} `;
        const nameText = `${prefix}${r.name} (${ROLE_LABELS[r.role]}) ${cIcon}`.trim();
        if (nameEl.textContent !== nameText) nameEl.textContent = nameText;
        const statusText = formatTvRunnerStatus(r, snap.maxLives);
        if (statusEl.textContent !== statusText) statusEl.textContent = statusText;
        const scoreText = r.score.toLocaleString();
        if (scoreEl.textContent !== scoreText) scoreEl.textContent = scoreText;
      }
    }
    if (this.el['tv-wait-count']) {
      this.el['tv-wait-count'].textContent = `${snap.waitingQueue.length} คน`;
    }
    if (this.el['tv-wait-list']) {
      this.el['tv-wait-list'].textContent =
        snap.waitingQueue.length > 0
          ? snap.waitingQueue.map((p) => `${AVATARS[sanitizeAvatarId(p.avatar)].icon} ${p.name} (${ROLE_LABELS[p.role]})`).join(' · ')
          : 'ยังไม่มีผู้เล่นในคิวรอ (สแกน QR เข้าร่วมได้ตลอดเวลา)';
    }
    if (this.el['tv-best-list']) {
      this.el['tv-best-list'].textContent =
        snap.allDayBest.length > 0
          ? snap.allDayBest.slice(0, 3).map((b, idx) => `#${idx + 1} ${b.name}: ${b.score.toLocaleString()}`).join(' · ')
          : '-';
    }
  }

  hud(opts: {
    score: number;
    coins: number;
    mult: number;
    lives: number;
    maxLives: number;
    floor: number;
    zoneNameTh: string;
    timeLeft: number;
    progress01: number;
    activeCenter: CenterId | null;
    centerTimer: number;
    shieldHits: number;
    collectedCenters: Set<CenterId>;
    rank: number;
    totalRunners: number;
    soloRun?: boolean;
  }) {
    this.el.score.textContent = String(opts.score).padStart(6, '0');
    const livesEl = this.el['hud-lives'];
    if (livesEl) {
      const pillText = formatHeartsPill(opts.lives, opts.maxLives);
      if (livesEl.textContent !== pillText) {
        livesEl.textContent = pillText;
      }
      livesEl.classList.toggle('unlimited', opts.maxLives <= 0);
      if (
        opts.maxLives > 0 &&
        this.lastHudMaxLives === opts.maxLives &&
        this.lastHudLives !== null &&
        opts.lives < this.lastHudLives
      ) {
        window.clearTimeout(this.livesPulseTimer);
        livesEl.classList.remove('pulse');
        void livesEl.offsetWidth;
        livesEl.classList.add('pulse');
        this.livesPulseTimer = window.setTimeout(() => livesEl.classList.remove('pulse'), 380);
      }
      this.lastHudLives = opts.lives;
      this.lastHudMaxLives = opts.maxLives;
    }
    this.el.coins.textContent = String(opts.coins);
    this.el.mult.textContent = '×' + opts.mult;
    this.el.mult.classList.toggle('hot', opts.mult > 1);
    this.el['hud-floor'].textContent = `FLOOR ${opts.floor} / 10`;
    this.el['hud-zone'].textContent = opts.zoneNameTh;
    this.el['hud-rank'].textContent = opts.soloRun
      ? `⚡ โหมดเดี่ยว · ${opts.collectedCenters.size}/9 ศูนย์`
      : `อันดับ #${opts.rank} / ${Math.max(1, opts.totalRunners)}`;
    this.el['hud-timer'].textContent = this.formatMMSS(opts.timeLeft);
    this.el['hud-progress'].style.transform = `scaleX(${opts.progress01.toFixed(3)})`;

    for (const c of CENTER_LIST) {
      const st = this.el[`stamp-${c.id}`];
      if (st) st.classList.toggle('on', opts.collectedCenters.has(c.id));
    }

    const ap = this.el['active-power'];
    if (opts.activeCenter !== null && opts.centerTimer > 0) {
      const meta = CENTERS[opts.activeCenter];
      ap.classList.add('on');
      ap.style.borderColor = meta.color;
      this.el['ap-name'].textContent = `${meta.icon} ${meta.powerName}`;
      this.el['ap-sub'].textContent =
        opts.shieldHits > 0 ? `เกราะกันชน ${opts.shieldHits} ครั้ง · ${opts.centerTimer.toFixed(1)}s` : `${opts.centerTimer.toFixed(1)}s`;
      this.el['ap-bar'].style.background = meta.color;
      this.el['ap-bar'].style.transform = `scaleX(${(opts.centerTimer / POWER_DURATION).toFixed(3)})`;
    } else {
      ap.classList.remove('on');
    }
  }

  showCenterBanner(centerId: CenterId) {
    const meta = CENTERS[centerId];
    const b = this.el['holo-banner'];
    if (!b) return;
    window.clearTimeout(this.holoTimer);
    b.style.borderColor = meta.color;
    this.el['holo-ico'].textContent = meta.icon;
    this.el['holo-floor'].textContent = `📍 ${meta.exhibitionFloorTh}`;
    this.el['holo-title'].textContent = `ศูนย์ที่ #${meta.id}: ${meta.shortTh}`;
    this.el['holo-desc'].textContent = `${meta.powerName} — ${meta.powerDescTh}`;
    b.classList.add('on');
    this.holoTimer = window.setTimeout(() => b.classList.remove('on'), 2000);
  }

  hint(text: string, ms = 2200) {
    const e = this.el.hint;
    if (!e) return;
    window.clearTimeout(this.hintTimer);
    e.textContent = text;
    e.classList.toggle('on', !!text);
    if (text) this.hintTimer = window.setTimeout(() => e.classList.remove('on'), ms);
  }

  toast(text: string, ms = 1400) {
    const e = this.el.toast;
    if (!e) return;
    window.clearTimeout(this.toastTimer);
    e.textContent = text;
    e.classList.add('on');
    this.toastTimer = window.setTimeout(() => e.classList.remove('on'), ms);
  }

  flash(kind: 'hit' | 'power') {
    const e = this.el.flash;
    if (!e) return;
    e.className = 'flash';
    void e.offsetWidth;
    e.className = 'flash ' + kind;
  }

  setPauseMultiplayer(liveMultiplayer: boolean): void {
    const noteEl = this.el['pause-note'];
    if (noteEl) {
      noteEl.textContent = liveMultiplayer
        ? '⚠️ โหมดแข่งพร้อมจอทีวี: ตัวละครยังวิ่งต่อแบบสด!'
        : '';
      noteEl.style.display = liveMultiplayer ? '' : 'none';
    }
    const restartBtn = this.el['btn-restart'];
    if (restartBtn) {
      restartBtn.textContent = liveMultiplayer
        ? '🏳️ ออกจากการแข่งรอบนี้ (รอรอบถัดไป)'
        : 'เริ่มรอบใหม่';
    }
  }

  result(r: {
    score: number;
    coins: number;
    distance: number;
    rank: number;
    totalRunners: number;
    collectedCenters: Set<CenterId>;
    soloRun?: boolean;
    eliminated?: boolean;
    maxLives?: number;
    survivedSec?: number;
    queuedNextRound?: boolean;
  }) {
    this.lastResultSoloRun = !!r.soloRun;
    this.lastResultMaxLives = r.maxLives ?? DEFAULT_MAX_LIVES;
    this.lastResultCollectedCount = r.collectedCenters.size;
    const hdr = describeResultHeader({
      eliminated: !!r.eliminated,
      maxLives: this.lastResultMaxLives,
      survivedSec: r.survivedSec ?? 0,
      rank: r.rank,
      totalRunners: r.totalRunners,
      collectedCount: this.lastResultCollectedCount,
      soloRun: this.lastResultSoloRun,
      queuedNextRound: !!r.queuedNextRound,
    });
    if (this.el['r-title']) this.el['r-title'].textContent = hdr.titleTh;
    if (this.el['r-rank-line']) this.el['r-rank-line'].textContent = hdr.subtitleTh;
    const againBtn = this.el['btn-again'] as HTMLButtonElement | undefined;
    if (againBtn) {
      againBtn.textContent = hdr.ctaLabelTh;
      againBtn.disabled = hdr.ctaDisabled;
    }
    this.el['r-score'].textContent = r.score.toLocaleString();
    this.el['r-coins'].textContent = String(r.coins);
    this.el['r-dist'].textContent = `${r.distance} m`;
    this.el['r-centers'].textContent = `${r.collectedCenters.size} / 9`;

    const groups = groupCentersByExhibitionFloor(r.collectedCenters);
    this.el['wf-list'].innerHTML = groups
      .map(
        (g) => `<div class="wf-floor">
          <h5><span>🏢 ${g.floorTitleTh}</span></h5>
          ${g.centers
            .map(
              (c) => `<div class="wf-item ${c.unlocked ? 'unlocked' : 'locked'}">
                <span>${c.icon}</span>
                <span><b>#${c.id} ${c.shortTh}</b> · <small>${c.exhibitionFloorTh}</small></span>
                <span class="wf-badge">${c.unlocked ? '✓ เก็บแล้ว' : 'ไปชมบูธจริง!'}</span>
              </div>`,
            )
            .join('')}
        </div>`,
      )
      .join('');
  }

  updateResultRank(opts: {
    rank: number;
    totalRunners: number;
    eliminated: boolean;
    survivedSec: number;
    queuedNextRound: boolean;
  }): void {
    const hdr = describeResultHeader({
      eliminated: opts.eliminated,
      maxLives: this.lastResultMaxLives,
      survivedSec: opts.survivedSec,
      rank: opts.rank,
      totalRunners: opts.totalRunners,
      collectedCount: this.lastResultCollectedCount,
      soloRun: this.lastResultSoloRun,
      queuedNextRound: opts.queuedNextRound,
    });
    if (this.el['r-title']) this.el['r-title'].textContent = hdr.titleTh;
    if (this.el['r-rank-line']) this.el['r-rank-line'].textContent = hdr.subtitleTh;
    const againBtn = this.el['btn-again'] as HTMLButtonElement | undefined;
    if (againBtn) {
      againBtn.textContent = hdr.ctaLabelTh;
      againBtn.disabled = hdr.ctaDisabled;
    }
  }
}
