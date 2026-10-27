import {
  GAME_TITLE, CENTERS, CENTER_LIST, POWER_DURATION,
  type CenterMeta,
} from './config';
import type { CenterId } from './sim/types';
import {
  AVATAR_COLORS, ROLE_LABELS, sanitizeNickname,
  type PlayerProfile, type PlayerRole, type RoomSnapshot, type HostCommand,
} from './net';
import {
  AVATARS, AVATAR_LIST, sanitizeAvatarId, type AvatarId,
} from './view/avatars';
import { buildJoinQrSvg, resolveMobileJoinUrl } from './qr';

export type Screen = 'start' | 'countdown' | 'play' | 'pause' | 'over';

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
  8: 'ชั้น 8 · ห้องปฏิบัติการเรดาร์และเทคโนโลยีชีวภาพ (2 ศูนย์)',
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
  selectAvatar?(avatarId: AvatarId): void;
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
  private profile: PlayerProfile;
  private tvMode = false;
  private lobbyReady = false;

  constructor(
    root: HTMLElement,
    private handlers: UIHandlers,
    muted: boolean,
    initialProfile: PlayerProfile,
    tvMode = false,
  ) {
    this.root = root;
    this.profile = { ...initialProfile, avatar: sanitizeAvatarId(initialProfile.avatar) };
    this.tvMode = tvMode;
    this.renderDOM();
    this.setMuted(muted);
    this.setTvMode(tvMode);
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
    const avatarsHtml = AVATAR_LIST.map(
      (av) =>
        `<button type="button" class="avatar-card ${currentAvatar === av.id ? 'on' : ''}" data-avatar="${av.id}" style="--av-accent:${av.accentHex}">
          <span class="av-ico">${av.icon}</span>
          <b class="av-name">${av.nameTh}</b>
          <small class="av-sub">${av.genderLabelTh} · ${av.roleBadgeTh}</small>
        </button>`,
    ).join('');

    this.root.innerHTML = `
      <div class="hud" id="hud">
        <div class="hud-left">
          <div class="hud-btns">
            <button class="icon-btn" id="btn-pause" aria-label="pause">${ICON.pause}</button>
            <button class="icon-btn" id="btn-mute" aria-label="mute"></button>
          </div>
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
            <label for="inp-name">ชื่อเล่นบนจอทีวี / Leaderboard (ไม่เกิน 16 ตัวอักษร)</label>
            <input class="name-input" id="inp-name" maxlength="16" placeholder="เช่น นนท์ เทคโนฯ" value="${this.profile.name}" />
          </div>

          <div class="form-row">
            <label>เลือกตัวละครนักวิ่ง 3D (5 สไตล์ · ชาย / หญิง / ชุดอวกาศ)</label>
            <div class="avatar-grid" id="avatar-grid">${avatarsHtml}</div>
          </div>

          <div class="form-row">
            <label>ระดับชั้น / สถานะผู้เข้าชม</label>
            <div class="role-grid" id="role-grid">${rolesHtml}</div>
          </div>

          <div class="form-row">
            <label>สีออร่านักวิ่งประจำตัว</label>
            <div class="color-row" id="color-row">${colorsHtml}</div>
          </div>

          <div class="lobby-status" id="lobby-box">
            <div class="ls-top">
              <span id="ls-phase">🟢 ห้องรอเริ่มรอบถัดไป (LOBBY)</span>
              <b id="ls-timer" style="color:#facc15">45s</b>
            </div>
            <div class="ls-sub" id="ls-desc">
              ปัดซ้าย/ขวา/ขึ้น/ลง ที่ตัวละครเพื่อวอร์มอัพรอรอบใหม่เริ่มพร้อมกันบนจอทีวี!
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">
              ${CENTER_LIST.map((c) => `<span style="font-size:11px;padding:2px 6px;border-radius:6px;background:rgba(15,23,42,.8);border:1px solid ${c.color}66" title="${c.nameTh} (${c.exhibitionFloorTh})">${c.icon} #${c.id} ${c.shortTh}</span>`).join('')}
            </div>
          </div>

          <button class="big gold-btn" id="btn-join-sync">✅ ยืนยันตัวละคร · เข้าจุดปล่อยตัว</button>
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
          <button class="big" id="btn-resume">วิ่งต่อเลย</button>
          <button class="ghost" id="btn-restart">เริ่มรอบใหม่</button>
          <button class="ghost" id="btn-home">กลับหน้าล็อบบี้</button>
        </div>
      </section>

      <!-- Result + Smart Wayfinding Screen -->
      <section class="screen over" id="s-over">
        <div class="panel">
          <h2>🎉 พิชิตชั้น 10 สำเร็จ!</h2>
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
                <p id="tv-join-url">สแกนด้วยกล้องมือถือ (Wi-Fi เดียวกัน): <b style="color:#38bdf8;word-break:break-all">${resolveMobileJoinUrl()}</b></p>
              </div>
            </div>

            <div class="tv-host-card">
              <h4>🎛️ แผงควบคุมพิธีกรประจำบูธ (Admin Controls)</h4>
              <div class="tv-host-btns">
                <button class="tv-btn primary" id="tv-btn-start">🚀 เริ่มปล่อยตัวรอบนี้ / เริ่มใหม่ (Admin Start)</button>
                <button class="tv-btn danger" id="tv-btn-stop" style="grid-column:span 2;background:rgba(225,29,72,.28);border-color:#fb7185;color:#fecdd3">🛑 หยุดรอบกลางคัน / รีเซ็ตกลับล็อบบี้ (Stop & Reset)</button>
                <button class="tv-btn" id="tv-btn-bots">🤖 เพิ่มบอทร่วมวิ่ง</button>
                <button class="tv-btn" id="tv-btn-dur180">⏱️ 3 นาที (180s)</button>
                <button class="tv-btn" id="tv-btn-dur120">⏱️ 2 นาที (120s)</button>
                <button class="tv-btn" id="tv-btn-dur90">⏱️ 1.5 นาที (90s)</button>
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
    nameInp.addEventListener('input', () => {
      this.profile.name = sanitizeNickname(nameInp.value);
    });

    this.el['role-grid'].querySelectorAll<HTMLButtonElement>('[data-role]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.profile.role = btn.dataset.role as PlayerRole;
        this.el['role-grid'].querySelectorAll('.role-btn').forEach((b) => b.classList.toggle('on', b === btn));
      });
    });

    this.el['color-row'].querySelectorAll<HTMLButtonElement>('[data-color]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.profile.color = btn.dataset.color!;
        this.el['color-row'].querySelectorAll('.color-dot').forEach((b) => b.classList.toggle('on', b === btn));
      });
    });

    this.el['avatar-grid']?.querySelectorAll<HTMLButtonElement>('[data-avatar]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const avId = sanitizeAvatarId(btn.dataset.avatar);
        this.profile.avatar = avId;
        this.el['avatar-grid'].querySelectorAll('.avatar-card').forEach((b) => b.classList.toggle('on', b === btn));
        this.handlers.selectAvatar?.(avId);
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
      this.profile.name = sanitizeNickname(nameInp.value);
      this.handlers.joinQueue({ ...this.profile });
    });
    tap('btn-play-solo', () => {
      this.profile.name = sanitizeNickname(nameInp.value);
      this.handlers.playSoloNow({ ...this.profile });
    });
    tap('btn-pause', () => this.handlers.pause());
    tap('btn-mute', () => this.handlers.toggleMute());
    tap('btn-resume', () => this.handlers.resume());
    tap('btn-restart', () => this.handlers.restart());
    tap('btn-home', () => this.handlers.home());
    tap('btn-home2', () => this.handlers.home());
    tap('btn-again', () => this.handlers.restart());
    tap('btn-mode-switch', () => this.handlers.toggleTvMode());

    // TV Host Controls
    tap('tv-btn-start', () => this.handlers.hostCommand({ action: 'start_now' }));
    tap('tv-btn-stop', () => this.handlers.hostCommand({ action: 'force_lobby' }));
    tap('tv-btn-bots', () => this.handlers.hostCommand({ action: 'add_bots', count: 4 }));
    tap('tv-btn-dur180', () => this.handlers.hostCommand({ action: 'set_duration', duration: 180 }));
    tap('tv-btn-dur120', () => this.handlers.hostCommand({ action: 'set_duration', duration: 120 }));
    tap('tv-btn-dur90', () => this.handlers.hostCommand({ action: 'set_duration', duration: 90 }));

    for (const b of this.root.querySelectorAll('button, input')) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
  }

  private buildQrSvg(): string {
    return buildJoinQrSvg(resolveMobileJoinUrl());
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
    const isQueued = snap.waitingQueue.some((p) => p.id === localPlayerId);
    const phaseLabel: Record<RoomSnapshot['phase'], string> = {
      LOBBY: '🟢 ห้องรอปล่อยตัว (รอ Admin กดเริ่มบนทีวี)',
      COUNTDOWN: '🟡 กำลังนับถอยหลังปล่อยตัว!',
      RUNNING: '🔴 รอบปัจจุบันกำลังวิ่งแข่งขันอยู่!',
      PODIUM: '🏆 สรุปผลผู้ชนะประจำรอบ (PODIUM)',
    };
    if (this.el['ls-phase']) this.el['ls-phase'].textContent = phaseLabel[snap.phase];
    if (this.el['ls-timer']) {
      this.el['ls-timer'].textContent = snap.phase === 'LOBBY' ? 'READY' : this.formatMMSS(snap.phaseTimeLeft);
    }

    if (this.el['ls-desc']) {
      if (snap.phase === 'RUNNING') {
        this.el['ls-desc'].textContent = isQueued
          ? `คุณอยู่ในคิวรอบถัดไป (#${snap.matchId + 1}) · รอบปัจจุบันอยู่ชั้น ${snap.currentFloor}/10 เหลือเวลา ${this.formatMMSS(snap.phaseTimeLeft)}`
          : `รอบปัจจุบันกำลังวิ่งอยู่ที่ชั้น ${snap.currentFloor}/10 · กดปุ่มสีทองเพื่อลงสนามร่วมวิ่งทันที!`;
      } else {
        this.el['ls-desc'].textContent = `มีผู้เล่นพร้อมในห้อง ${snap.activeRunners.length} คน · กดปุ่มสีทองเพื่อเข้าจุดปล่อยตัว แล้วรอ Admin กดเริ่มรอบบนจอทีวี!`;
      }
    }

    // Update TV Live Arena
    if (this.el['tv-phase']) {
      const phaseTh = snap.phase === 'LOBBY' ? 'LOBBY (รอ Admin กดเริ่ม)' : snap.phase;
      this.el['tv-phase'].textContent = `รอบที่ #${snap.matchId} · ${phaseTh} · ชั้น ${snap.currentFloor}/10`;
    }
    if (this.el['tv-timer']) {
      this.el['tv-timer'].textContent = snap.phase === 'LOBBY' ? 'READY' : this.formatMMSS(snap.phaseTimeLeft);
    }
    if (this.el['tv-active-count']) {
      this.el['tv-active-count'].textContent = `${snap.activeRunners.length} คน`;
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
        rowEl.innerHTML = `<span class="tv-lb-rank"></span><span class="tv-lb-dot"></span><span class="tv-lb-name"></span><span class="tv-lb-score"></span>`;
        lbList.appendChild(rowEl);
      }
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowEl = lbList.children[i] as HTMLElement;
        rowEl.classList.toggle('top1', i === 0);
        const rankEl = rowEl.children[0] as HTMLElement;
        const dotEl = rowEl.children[1] as HTMLElement;
        const nameEl = rowEl.children[2] as HTMLElement;
        const scoreEl = rowEl.children[3] as HTMLElement;
        const rankText = `#${r.rank}`;
        if (rankEl.textContent !== rankText) rankEl.textContent = rankText;
        if (dotEl.style.background !== r.color) dotEl.style.background = r.color;
        const cIcon = r.activeCenter ? CENTERS[r.activeCenter].icon : '';
        const avIcon = AVATARS[sanitizeAvatarId(r.avatar)].icon;
        const prefix = r.name.includes(avIcon) ? '' : `${avIcon} `;
        const nameText = `${prefix}${r.name} (${ROLE_LABELS[r.role]}) ${cIcon}`.trim();
        if (nameEl.textContent !== nameText) nameEl.textContent = nameText;
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
    this.holoTimer = window.setTimeout(() => b.classList.remove('on'), 3400);
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

  result(r: {
    score: number;
    coins: number;
    distance: number;
    rank: number;
    totalRunners: number;
    collectedCenters: Set<CenterId>;
    soloRun?: boolean;
  }) {
    this.el['r-rank-line'].textContent = r.soloRun
      ? `โหมดวิ่งเดี่ยว · สะสมครบ ${r.collectedCenters.size} / 9 ศูนย์วิจัย`
      : `อันดับของคุณในรอบนี้: #${r.rank} จาก ${Math.max(1, r.totalRunners)} คน`;
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
}
