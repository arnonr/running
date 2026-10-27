// Procedural canvas textures + 10-Floor Zone Atmosphere Palettes + 9-Center capsule textures.
import * as THREE from 'three';
import { CENTERS } from '../config';
import type { CenterId, ZoneId } from '../sim/types';

export interface ZonePalette {
  zoneId: ZoneId;
  nameTh: string;
  skyTopHex: string;
  skyBottomHex: string;
  fogHex: string;
  sunHex: string;
  neonHex: string;
  starIntensity: number;
}

export const ZONE_PALETTES: Record<ZoneId, ZonePalette> = {
  1: {
    zoneId: 1,
    nameTh: 'ชั้น 1: โถงนิทรรศการหลัก (Main Exhibition Hall)',
    skyTopHex: '#1d4ed8',
    skyBottomHex: '#7dd3fc',
    fogHex: '#bae6fd',
    sunHex: '#fff1dc',
    neonHex: '#38bdf8',
    starIntensity: 0.0,
  },
  2: {
    zoneId: 2,
    nameTh: 'ชั้น 2–6: โรงประลองหุ่นยนต์และสมาร์ทแล็บ (Robotics & Smart Labs)',
    skyTopHex: '#312e81',
    skyBottomHex: '#fb923c',
    fogHex: '#fed7aa',
    sunHex: '#fde68a',
    neonHex: '#fb923c',
    starIntensity: 0.15,
  },
  3: {
    zoneId: 3,
    nameTh: 'ชั้น 8: ห้องปฏิบัติการเรดาร์และไบโอเทค (Radar & Bio-Chem Labs)',
    skyTopHex: '#064e3b',
    skyBottomHex: '#14b8a6',
    fogHex: '#99f6e4',
    sunHex: '#a7f3d0',
    neonHex: '#2dd4bf',
    starIntensity: 0.45,
  },
  4: {
    zoneId: 4,
    nameTh: 'ชั้น 9–10: เมดเทคและรันเวย์อวกาศ (Med-Tech & Space Runway)',
    skyTopHex: '#090d16',
    skyBottomHex: '#3b0764',
    fogHex: '#1e1b4b',
    sunHex: '#f472b6',
    neonHex: '#f472b6',
    starIntensity: 0.95,
  },
};

const cA = new THREE.Color();
const cB = new THREE.Color();
function lerpHex(hexA: string, hexB: string, t: number): string {
  cA.set(hexA);
  cB.set(hexB);
  cA.lerp(cB, Math.max(0, Math.min(1, t)));
  return '#' + cA.getHexString();
}

export function lerpZonePalette(progress01: number): ZonePalette {
  const p = Math.max(0, Math.min(1, progress01));
  let z0: ZoneId = 1, z1: ZoneId = 1, t = 0;
  if (p < 1 / 3) {
    z0 = 1; z1 = 2;
    t = Math.max(0, (p - 0.25) / (1 / 3 - 0.25));
  } else if (p < 5 / 9) {
    z0 = 2; z1 = 3;
    t = Math.max(0, (p - 0.48) / (5 / 9 - 0.48));
  } else if (p < 7 / 9) {
    z0 = 3; z1 = 4;
    t = Math.max(0, (p - 0.7) / (7 / 9 - 0.7));
  } else {
    z0 = 4; z1 = 4;
    t = 0;
  }
  const a = ZONE_PALETTES[z0];
  const b = ZONE_PALETTES[z1];
  return {
    zoneId: t > 0.5 ? b.zoneId : a.zoneId,
    nameTh: a.nameTh,
    skyTopHex: lerpHex(a.skyTopHex, b.skyTopHex, t),
    skyBottomHex: lerpHex(a.skyBottomHex, b.skyBottomHex, t),
    fogHex: lerpHex(a.fogHex, b.fogHex, t),
    sunHex: lerpHex(a.sunHex, b.sunHex, t),
    neonHex: lerpHex(a.neonHex, b.neonHex, t),
    starIntensity: a.starIntensity + (b.starIntensity - a.starIntensity) * t,
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d') as CanvasRenderingContext2D };
}
function tex(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** One lane of futuristic TechnoPark track: dark carbon ballast, metallic sleepers, and glowing cyan/silver rails. */
export function trackTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#475569';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2000; i++) {
    const v = 55 + rnd() * 55;
    g.fillStyle = `rgb(${v},${v + 8},${v + 18})`;
    g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  // sleepers
  for (let k = 0; k < 4; k++) {
    const y = k * (S / 4) + 10;
    g.fillStyle = '#1e293b';
    g.fillRect(18, y, S - 36, 24);
    g.fillStyle = '#334155';
    g.fillRect(18, y, S - 36, 7);
    // neon center pulse strip on sleeper
    g.fillStyle = 'rgba(56, 189, 248, 0.45)';
    g.fillRect(S / 2 - 18, y + 9, 36, 5);
  }
  // rails
  for (const x of [0.24, 0.76]) {
    g.fillStyle = '#0f172a';
    g.fillRect(x * S - 8, 0, 16, S);
    g.fillStyle = '#e2e8f0';
    g.fillRect(x * S - 4, 0, 8, S);
    g.fillStyle = '#38bdf8';
    g.fillRect(x * S - 1, 0, 2, S);
  }
  return tex(c);
}

export function pavingTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#94a3b8';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 600; i++) {
    const v = 140 + rnd() * 40;
    g.fillStyle = `rgba(${v},${v + 5},${v + 12},0.45)`;
    g.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  g.strokeStyle = '#64748b';
  g.lineWidth = 4;
  for (let k = 0; k <= 2; k++) {
    g.beginPath(); g.moveTo(0, k * 128); g.lineTo(S, k * 128); g.stroke();
    g.beginPath(); g.moveTo(k * 128, 0); g.lineTo(k * 128, S); g.stroke();
  }
  return tex(c);
}

export function groundTexture() {
  const S = 128;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#334155';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 400; i++) {
    const v = rnd();
    g.fillStyle = v > 0.5 ? 'rgba(30,41,59,0.6)' : 'rgba(56,189,248,0.18)';
    g.fillRect(rnd() * S, rnd() * S, 3, 3);
  }
  return tex(c);
}

export function skyTexture() {
  const { c, g } = canvas(4, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#0f172a');
  gr.addColorStop(0.45, '#1d4ed8');
  gr.addColorStop(0.78, '#38bdf8');
  gr.addColorStop(1, '#bae6fd');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  return tex(c, false);
}
export const HORIZON = new THREE.Color('#bae6fd');

export function glowTexture() {
  const S = 64;
  const { c, g } = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return tex(c, false);
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Holographic 9-Center Capsule Card with crisp vector emblem, center number, and power label. */
export function centerCapsuleTexture(centerId: CenterId) {
  const S = 192;
  const { c, g } = canvas(S, S);
  const meta = CENTERS[centerId];

  // Outer glowing frame
  g.fillStyle = 'rgba(255,255,255,0.96)';
  round(g, 6, 6, S - 12, S - 12, 34);
  g.fill();

  // Inner dark core
  g.fillStyle = '#0f172a';
  round(g, 14, 14, S - 28, S - 28, 28);
  g.fill();

  const gr = g.createLinearGradient(0, 14, 0, S - 14);
  gr.addColorStop(0, meta.color);
  gr.addColorStop(1, '#090d16');
  g.fillStyle = gr;
  g.globalAlpha = 0.9;
  round(g, 18, 18, S - 36, S - 36, 24);
  g.fill();
  g.globalAlpha = 1;

  // Center badge number (#1..#9)
  g.fillStyle = 'rgba(15,23,42,0.9)';
  round(g, 24, 22, 54, 30, 10);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 21px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`#${centerId}`, 51, 38);

  // Crisp vector emblem in center + Emoji
  g.save();
  g.translate(S / 2, S / 2 - 4);
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(0, 0, 34, 0, Math.PI * 2);
  g.fillStyle = 'rgba(15, 23, 42, 0.55)';
  g.fill();
  g.stroke();

  const shortTag: Record<CenterId, string> = {
    1: 'JET',
    2: 'ROBO',
    3: 'TRAIN',
    4: 'SHIELD',
    5: '5G',
    6: 'RADAR',
    7: 'BIO×2',
    8: '+500',
    9: 'SPACE',
  };
  g.fillStyle = '#ffffff';
  g.font = '900 20px system-ui, sans-serif';
  g.fillText(shortTag[centerId], 0, 2);
  g.restore();

  // Bottom Thai short label bar
  g.fillStyle = 'rgba(15,23,42,0.88)';
  round(g, 24, S - 52, S - 48, 28, 9);
  g.fill();
  g.fillStyle = '#f8fafc';
  g.font = 'bold 14px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(meta.shortTh.slice(0, 14), S / 2, S - 38);

  return tex(c, false);
}

/** Floating 3D Nameplate for Ghost Runners on the shared track / TV Arena. */
export function nameBadgeTexture(name: string, rank: number, color: string) {
  const W = 256, H = 64;
  const { c, g } = canvas(W, H);
  g.fillStyle = 'rgba(15, 23, 42, 0.86)';
  round(g, 4, 6, W - 8, H - 12, 24);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = color;
  round(g, 4, 6, W - 8, H - 12, 24);
  g.stroke();

  g.fillStyle = color;
  g.font = 'bold 24px system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(`#${rank}`, 20, H / 2);

  g.fillStyle = '#ffffff';
  g.font = 'bold 22px system-ui, sans-serif';
  g.fillText(name.slice(0, 12), 70, H / 2);
  return tex(c, false);
}

export function rampTexture() {
  const S = 128;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#facc15';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#0f172a';
  for (let k = -2; k < 4; k++) {
    g.beginPath();
    g.moveTo(k * 48, S); g.lineTo(k * 48 + 24, S); g.lineTo(k * 48 + 24 + S, 0); g.lineTo(k * 48 + S, 0);
    g.closePath();
    g.fill();
  }
  return tex(c);
}
