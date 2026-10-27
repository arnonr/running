// Procedural canvas textures + 9-Center Open-Horizon Biome Palettes + Portal Gate & Capsule textures.
import * as THREE from 'three';
import { CENTERS, STAGE_CENTER_ORDER } from '../config';
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

export interface CenterBiomePalette {
  centerId: CenterId;
  stageTitleTh: string;
  skyTopHex: string;
  skyMidHex: string;
  skyHorizonHex: string;
  fogHex: string;
  sunHex: string;
  groundTintHex: string;
  trackTintHex: string;
  neonHex: string;
  starIntensity: number;
  sunScale: number;
  hasPlanetRings: boolean;
}

export const CENTER_BIOMES: Record<CenterId, CenterBiomePalette> = {
  // Stage 1 (0-20s, Floor 1): Aviation & Defense — Bright Azure Sky, Golden Sun, Airfield Runway
  1: {
    centerId: 1,
    stageTitleTh: 'ด่าน 1/9 · ✈️ ศูนย์อากาศยาน (ชั้น 1)',
    skyTopHex: '#0369a1',
    skyMidHex: '#0ea5e9',
    skyHorizonHex: '#bae6fd',
    fogHex: '#7dd3fc',
    sunHex: '#fef08a',
    groundTintHex: '#1e3a5f',
    trackTintHex: '#bae6fd',
    neonHex: '#38bdf8',
    starIntensity: 0.0,
    sunScale: 1.15,
    hasPlanetRings: false,
  },
  // Stage 2 (20-40s, Floor 1): Clean Energy & Environment — Fresh Emerald-Mint Sunrise, Solar Valley
  4: {
    centerId: 4,
    stageTitleTh: 'ด่าน 2/9 · 🌿 ศูนย์พลังงานสะอาด (ชั้น 1)',
    skyTopHex: '#065f46',
    skyMidHex: '#10b981',
    skyHorizonHex: '#a7f3d0',
    fogHex: '#6ee7b7',
    sunHex: '#fde047',
    groundTintHex: '#065f46',
    trackTintHex: '#bbf7d0',
    neonHex: '#4ade80',
    starIntensity: 0.05,
    sunScale: 1.25,
    hasPlanetRings: false,
  },
  // Stage 3 (40-60s, Floor 1): 5G Wireless Innovation — Electric Cyber Violet-Magenta Matrix
  5: {
    centerId: 5,
    stageTitleTh: 'ด่าน 3/9 · 📡 ศูนย์นวัตกรรมไร้สาย 5G (ชั้น 1)',
    skyTopHex: '#1e1b4b',
    skyMidHex: '#6d28d9',
    skyHorizonHex: '#d8b4fe',
    fogHex: '#9333ea',
    sunHex: '#f0abfc',
    groundTintHex: '#3b0764',
    trackTintHex: '#e9d5ff',
    neonHex: '#c084fc',
    starIntensity: 0.35,
    sunScale: 1.2,
    hasPlanetRings: false,
  },
  // Stage 4 (60-80s, Floor 1): Modern Automotive & Rail — Golden Hour Sunset Hyperloop Station
  3: {
    centerId: 3,
    stageTitleTh: 'ด่าน 4/9 · 🚄 ศูนย์ยานยนต์และระบบราง (ชั้น 1)',
    skyTopHex: '#1e293b',
    skyMidHex: '#d97706',
    skyHorizonHex: '#fde68a',
    fogHex: '#f59e0b',
    sunHex: '#fef08a',
    groundTintHex: '#451a03',
    trackTintHex: '#fef08a',
    neonHex: '#facc15',
    starIntensity: 0.15,
    sunScale: 1.4,
    hasPlanetRings: false,
  },
  // Stage 5 (80-100s, Floors 2-6): Automation & Robotics — Warm Industrial Amber-Copper Smart Factory
  2: {
    centerId: 2,
    stageTitleTh: 'ด่าน 5/9 · 🤖 ศูนย์หุ่นยนต์อัตโนมัติ (ชั้น 2)',
    skyTopHex: '#31102f',
    skyMidHex: '#c2410c',
    skyHorizonHex: '#fdba74',
    fogHex: '#ea580c',
    sunHex: '#ffedd5',
    groundTintHex: '#431407',
    trackTintHex: '#fed7aa',
    neonHex: '#fb923c',
    starIntensity: 0.25,
    sunScale: 1.3,
    hasPlanetRings: false,
  },
  // Stage 6 (100-120s, Floor 8): Radar Technology — Atmospheric Teal-Aqua Cloudscape
  6: {
    centerId: 6,
    stageTitleTh: 'ด่าน 6/9 · 🛰️ ศูนย์เทคโนโลยีเรดาร์ (ชั้น 8)',
    skyTopHex: '#042f2e',
    skyMidHex: '#0d9488',
    skyHorizonHex: '#99f6e4',
    fogHex: '#2dd4bf',
    sunHex: '#ccfbf1',
    groundTintHex: '#115e59',
    trackTintHex: '#99f6e4',
    neonHex: '#2dd4bf',
    starIntensity: 0.4,
    sunScale: 1.35,
    hasPlanetRings: true,
  },
  // Stage 7 (120-140s, Floor 8): Bio-Chem & Bio-Materials — Bioluminescent Lime-Emerald Helix Lab
  7: {
    centerId: 7,
    stageTitleTh: 'ด่าน 7/9 · 🧬 ศูนย์เทคโนโลยีชีวภาพ (ชั้น 8)',
    skyTopHex: '#052e16',
    skyMidHex: '#15803d',
    skyHorizonHex: '#bef264',
    fogHex: '#4ade80',
    sunHex: '#ecfccb',
    groundTintHex: '#14532d',
    trackTintHex: '#d9f99d',
    neonHex: '#a3e635',
    starIntensity: 0.45,
    sunScale: 1.25,
    hasPlanetRings: false,
  },
  // Stage 8 (140-160s, Floor 9): Medical Device Innovation — Clean Rose-Coral & Alabaster Sanctuary
  8: {
    centerId: 8,
    stageTitleTh: 'ด่าน 8/9 · ➕ ศูนย์นวัตกรรมเครื่องมือแพทย์ (ชั้น 9)',
    skyTopHex: '#4c0519',
    skyMidHex: '#e11d48',
    skyHorizonHex: '#fecdd3',
    fogHex: '#fb7185',
    sunHex: '#ffe4e6',
    groundTintHex: '#4c0519',
    trackTintHex: '#fecdd3',
    neonHex: '#fb7185',
    starIntensity: 0.6,
    sunScale: 1.45,
    hasPlanetRings: false,
  },
  // Stage 9 (160-180s, Floor 10): International Space Institute — Deep Cosmic Nebula & Ringed Planet
  9: {
    centerId: 9,
    stageTitleTh: 'ด่าน 9/9 · 🚀 สถาบันเทคโนโลยีอวกาศฯ (ชั้น 10)',
    skyTopHex: '#020617',
    skyMidHex: '#4c1d95',
    skyHorizonHex: '#f472b6',
    fogHex: '#3b0764',
    sunHex: '#f9a8d4',
    groundTintHex: '#1e1b4b',
    trackTintHex: '#fbcfe8',
    neonHex: '#f472b6',
    starIntensity: 1.0,
    sunScale: 1.85,
    hasPlanetRings: true,
  },
};

export const ZONE_PALETTES: Record<ZoneId, ZonePalette> = {
  1: {
    zoneId: 1,
    nameTh: 'ชั้น 1: โถงนิทรรศการหลัก (Aero · EV · Green · 5G)',
    skyTopHex: '#0f172a',
    skyBottomHex: '#0284c7',
    fogHex: '#0c4a6e',
    sunHex: '#e0f2fe',
    neonHex: '#38bdf8',
    starIntensity: 0.1,
  },
  2: {
    zoneId: 2,
    nameTh: 'ชั้น 2–6: โรงประลองหุ่นยนต์อัตโนมัติ (Robotics & Smart Labs)',
    skyTopHex: '#1e1b4b',
    skyBottomHex: '#c2410c',
    fogHex: '#431407',
    sunHex: '#fed7aa',
    neonHex: '#fb923c',
    starIntensity: 0.25,
  },
  3: {
    zoneId: 3,
    nameTh: 'ชั้น 8: แล็บเรดาร์และเทคโนโลยีชีวภาพ (Radar & Bio-Chem)',
    skyTopHex: '#022c22',
    skyBottomHex: '#0d9488',
    fogHex: '#064e3b',
    sunHex: '#99f6e4',
    neonHex: '#2dd4bf',
    starIntensity: 0.5,
  },
  4: {
    zoneId: 4,
    nameTh: 'ชั้น 9–10: เมดเทคและรันเวย์อวกาศ (Med-Tech & Space Runway)',
    skyTopHex: '#030712',
    skyBottomHex: '#581c87',
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

/** Smoothly interpolates across all 9 sequential Center Biomes (`STAGE_CENTER_ORDER`) over `progress01` (`0..1`). */
export function lerpCenterBiome(progress01: number): CenterBiomePalette {
  const safe = Number.isFinite(progress01) ? progress01 : 0;
  const p = Math.max(0, Math.min(0.999999, safe));
  const scaled = p * 9;
  const idx0 = Math.min(8, Math.floor(scaled));
  const idx1 = Math.min(8, idx0 + 1);
  const localT = scaled - idx0;
  // Blend smoothly during the final 22% of each 20s stage
  const blend = idx0 === idx1 ? 0 : Math.max(0, (localT - 0.78) / 0.22);

  const a = CENTER_BIOMES[STAGE_CENTER_ORDER[idx0]];
  const b = CENTER_BIOMES[STAGE_CENTER_ORDER[idx1]];
  return {
    centerId: a.centerId,
    stageTitleTh: a.stageTitleTh,
    skyTopHex: lerpHex(a.skyTopHex, b.skyTopHex, blend),
    skyMidHex: lerpHex(a.skyMidHex, b.skyMidHex, blend),
    skyHorizonHex: lerpHex(a.skyHorizonHex, b.skyHorizonHex, blend),
    fogHex: lerpHex(a.fogHex, b.fogHex, blend),
    sunHex: lerpHex(a.sunHex, b.sunHex, blend),
    groundTintHex: lerpHex(a.groundTintHex, b.groundTintHex, blend),
    trackTintHex: lerpHex(a.trackTintHex, b.trackTintHex, blend),
    neonHex: lerpHex(a.neonHex, b.neonHex, blend),
    starIntensity: a.starIntensity + (b.starIntensity - a.starIntensity) * blend,
    sunScale: a.sunScale + (b.sunScale - a.sunScale) * blend,
    hasPlanetRings: blend > 0.5 ? b.hasPlanetRings : a.hasPlanetRings,
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

/** Futuristic TechnoPark Maglev/Express Track: bright tintable surface so each Center biome transforms the track! */
export function trackTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#334155';
  g.fillRect(0, 0, S, S);
  // Tech grid lines
  g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const pos = i * (S / 8);
    g.beginPath(); g.moveTo(0, pos); g.lineTo(S, pos); g.stroke();
    g.beginPath(); g.moveTo(pos, 0); g.lineTo(pos, S); g.stroke();
  }
  // Maglev sleepers
  for (let k = 0; k < 4; k++) {
    const y = k * (S / 4) + 10;
    g.fillStyle = '#475569';
    g.fillRect(16, y, S - 32, 24);
    g.fillStyle = '#94a3b8';
    g.fillRect(16, y, S - 32, 6);
    // Glowing center energy core in sleeper
    g.fillStyle = '#ffffff';
    g.fillRect(S / 2 - 30, y + 9, 60, 6);
  }
  // Maglev guide rails
  for (const x of [0.24, 0.76]) {
    g.fillStyle = '#1e293b';
    g.fillRect(x * S - 8, 0, 16, S);
    g.fillStyle = '#f8fafc';
    g.fillRect(x * S - 4, 0, 8, S);
  }
  return tex(c);
}

/** High-tech laboratory walkway slabs with glowing circuit seams (tintable per Center biome). */
export function pavingTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#64748b';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#ffffff';
  g.globalAlpha = 0.45;
  g.lineWidth = 3;
  for (let k = 0; k <= 4; k++) {
    g.beginPath(); g.moveTo(0, k * 64); g.lineTo(S, k * 64); g.stroke();
    g.beginPath(); g.moveTo(k * 64, 0); g.lineTo(k * 64, S); g.stroke();
  }
  g.globalAlpha = 1;
  return tex(c);
}

/** Open-horizon terrain grid outside the track (bright neutral base so `groundMat.color` tints it vividly per Center!). */
export function groundTexture() {
  const S = 128;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#94a3b8';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  g.lineWidth = 2;
  g.strokeRect(4, 4, S - 8, S - 8);
  g.beginPath();
  g.moveTo(0, S / 2); g.lineTo(S, S / 2);
  g.moveTo(S / 2, 0); g.lineTo(S / 2, S);
  g.stroke();
  for (let i = 0; i < 36; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.22)';
    g.fillRect(rnd() * S, rnd() * S, 5, 5);
  }
  return tex(c);
}

/** Overhead Portal Gate Banner announcing entry into each of the 9 TechnoPark Research Centers! */
export function centerGateBannerTexture(centerId: CenterId, stageNumber: number) {
  const W = 768, H = 192;
  const { c, g } = canvas(W, H);
  const meta = CENTERS[centerId];

  g.fillStyle = 'rgba(9, 13, 22, 0.94)';
  round(g, 6, 6, W - 12, H - 12, 28);
  g.fill();

  g.lineWidth = 8;
  g.strokeStyle = meta.color;
  round(g, 10, 10, W - 20, H - 20, 24);
  g.stroke();

  g.fillStyle = meta.color;
  round(g, 26, 22, W - 52, 46, 14);
  g.fill();
  g.fillStyle = '#090d16';
  g.font = '900 24px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`STAGE ${stageNumber} / 9 · ศูนย์วิจัยที่ #${meta.id} · ${meta.exhibitionFloorTh}`, W / 2, 46);

  g.fillStyle = '#ffffff';
  g.font = '900 42px system-ui, sans-serif';
  g.fillText(`${meta.icon} ${meta.shortTh}`, W / 2, 106);

  g.fillStyle = meta.color;
  g.font = 'bold 24px system-ui, sans-serif';
  g.fillText(`⚡ พลังประจำศูนย์: ${meta.powerName}`, W / 2, 154);

  return tex(c, false);
}

/** Glass Curtain-Wall & Neon Lab Tower Facade Texture for TechnoPark side buildings. */
export function technoTowerTexture(accentHex = '#38bdf8') {
  const W = 256, H = 512;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#090d16';
  g.fillRect(0, 0, W, H);

  // Illuminated laboratory windows grid
  const cols = 4, rows = 10;
  const padX = 12, padY = 12;
  const winW = (W - padX * (cols + 1)) / cols;
  const winH = (H - padY * (rows + 1)) / rows;

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = padX + col * (winW + padX);
      const y = padY + r * (winH + padY);
      const lit = rnd() > 0.22;
      g.fillStyle = lit ? accentHex : '#1e293b';
      g.globalAlpha = lit ? (0.35 + rnd() * 0.45) : 0.5;
      g.fillRect(x, y, winW, winH);
      g.globalAlpha = 1;
      g.strokeStyle = accentHex;
      g.lineWidth = 1.5;
      g.strokeRect(x, y, winW, winH);
    }
  }

  // Vertical neon edge strips
  g.fillStyle = accentHex;
  g.fillRect(0, 0, 6, H);
  g.fillRect(W - 6, 0, 6, H);
  return tex(c, false);
}

/** Large Holographic Center Billboard mounted along the sides of the TechnoPark track! */
export function centerBillboardTexture(centerId: CenterId) {
  const W = 512, H = 256;
  const { c, g } = canvas(W, H);
  const meta = CENTERS[centerId];

  // Dark cyber glass background
  g.fillStyle = 'rgba(9, 13, 22, 0.94)';
  round(g, 6, 6, W - 12, H - 12, 28);
  g.fill();

  // Glowing neon border in Center's theme color
  g.lineWidth = 8;
  g.strokeStyle = meta.color;
  round(g, 10, 10, W - 20, H - 20, 24);
  g.stroke();

  // Top header pill: FLOOR + CENTER ID
  g.fillStyle = meta.color;
  round(g, 28, 26, W - 56, 48, 14);
  g.fill();
  g.fillStyle = '#090d16';
  g.font = '900 24px system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(`SUTO TECHNOPARK · ศูนย์ที่ #${meta.id}`, 44, 51);

  // Icon + Short Thai Name
  g.fillStyle = '#ffffff';
  g.font = '900 36px system-ui, sans-serif';
  g.fillText(`${meta.icon} ${meta.shortTh}`, 32, 118);

  // Exhibition floor badge
  g.fillStyle = '#cbd5e1';
  g.font = 'bold 24px system-ui, sans-serif';
  g.fillText(`📍 ${meta.exhibitionFloorTh}`, 34, 168);

  // Power-up name footer
  g.fillStyle = meta.color;
  g.font = 'bold 22px system-ui, sans-serif';
  g.fillText(`⚡ พลังพิเศษ: ${meta.powerName}`, 34, 212);

  return tex(c, false);
}

export function skyTexture() {
  const { c, g } = canvas(64, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#030712');
  gr.addColorStop(0.45, '#0f172a');
  gr.addColorStop(0.8, '#1e3a8a');
  gr.addColorStop(1, '#0284c7');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 256);
  // Subtle starfield in upper sky
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 45; i++) {
    g.fillRect(rnd() * 64, rnd() * 140, 1.5, 1.5);
  }
  return tex(c, false);
}
export const HORIZON = new THREE.Color('#0c4a6e');

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

/** Holographic 9-Center Capsule Card with unmistakable icon, power code, and Thai center label. */
export function centerCapsuleTexture(centerId: CenterId) {
  const S = 192;
  const { c, g } = canvas(S, S);
  const meta = CENTERS[centerId];

  // Outer glowing white/neon frame
  g.fillStyle = '#ffffff';
  round(g, 6, 6, S - 12, S - 12, 34);
  g.fill();

  // Inner dark frame
  g.fillStyle = '#090d16';
  round(g, 12, 12, S - 24, S - 24, 28);
  g.fill();

  // Vibrant colored gradient body
  const gr = g.createLinearGradient(0, 16, 0, S - 16);
  gr.addColorStop(0, meta.color);
  gr.addColorStop(1, '#0f172a');
  g.fillStyle = gr;
  round(g, 18, 18, S - 36, S - 36, 24);
  g.fill();

  // Top-left Center ID pill (#1..#9)
  g.fillStyle = 'rgba(9, 13, 22, 0.9)';
  round(g, 24, 22, 56, 30, 10);
  g.fill();
  g.fillStyle = meta.color;
  g.font = '900 20px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`#${centerId}`, 52, 38);

  // Center Emoji Icon + Bold English Tag (no overlapping stroke!)
  const shortTag: Record<CenterId, string> = {
    1: '✈️ JET',
    2: '🤖 ROBO',
    3: '🚄 TRAIN',
    4: '🌿 SHIELD',
    5: '📡 5G',
    6: '🛰️ RADAR',
    7: '🧬 BIO×2',
    8: '➕ +500',
    9: '🚀 SPACE',
  };
  g.fillStyle = '#ffffff';
  g.font = '900 28px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(shortTag[centerId], S / 2, S / 2 + 2);

  // Bottom Thai short name bar
  g.fillStyle = 'rgba(9, 13, 22, 0.92)';
  round(g, 22, S - 52, S - 44, 30, 10);
  g.fill();
  g.fillStyle = '#f8fafc';
  g.font = 'bold 14px system-ui, sans-serif';
  g.fillText(meta.shortTh.slice(0, 14), S / 2, S - 37);

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
  g.fillStyle = '#38bdf8';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#090d16';
  for (let k = -2; k < 4; k++) {
    g.beginPath();
    g.moveTo(k * 48, S); g.lineTo(k * 48 + 24, S); g.lineTo(k * 48 + 24 + S, 0); g.lineTo(k * 48 + S, 0);
    g.closePath();
    g.fill();
  }
  return tex(c);
}
