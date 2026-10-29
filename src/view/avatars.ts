// 5-Character Selection System: Surgical Mesh-Island Filtering, Dynamic UV Outfit Skins, and Bone-Rigged 3D Costumes.
import * as THREE from 'three';

export type AvatarId = 'non' | 'may' | 'praw' | 'kin' | 'sky';

export interface AvatarMeta {
  id: AvatarId;
  nameTh: string;
  roleBadgeTh: string;
  genderLabelTh: string;
  icon: string;
  accentHex: string;
  removeCap: boolean;
  removeBackpack: boolean;
  outfitPrimaryHex: string;
  outfitSecondaryHex: string;
  bottomsHex: string;
  shoesHex: string;
  hairHex: string;
}

export const AVATARS: Record<AvatarId, AvatarMeta> = {
  non: {
    id: 'non',
    nameTh: 'นนท์ (Street)',
    roleBadgeTh: 'สตรีทแคป · คล่องตัว',
    genderLabelTh: 'ชาย',
    icon: '⚡',
    accentHex: '#38bdf8',
    removeCap: false,
    removeBackpack: false,
    outfitPrimaryHex: '#0284c7',
    outfitSecondaryHex: '#f97316',
    bottomsHex: '#1e293b',
    shoesHex: '#38bdf8',
    hairHex: '#451a03',
  },
  may: {
    id: 'may',
    nameTh: 'เมย์ (Techno Girl)',
    roleBadgeTh: 'มัดหางม้า · กระโปรงพลีท',
    genderLabelTh: 'หญิง',
    icon: '🎀',
    accentHex: '#f472b6',
    removeCap: true,
    removeBackpack: true,
    outfitPrimaryHex: '#1e3a8a',
    outfitSecondaryHex: '#f472b6',
    bottomsHex: '#1e1b4b',
    shoesHex: '#f472b6',
    hairHex: '#4a1d09',
  },
  praw: {
    id: 'praw',
    nameTh: 'ดร.พราว (Researcher)',
    roleBadgeTh: 'มวยผมคู่ · เสื้อกาวน์แล็บ',
    genderLabelTh: 'หญิง',
    icon: '🧬',
    accentHex: '#2dd4bf',
    removeCap: true,
    removeBackpack: true,
    outfitPrimaryHex: '#f1f5f9',
    outfitSecondaryHex: '#14b8a6',
    bottomsHex: '#0f172a',
    shoesHex: '#2dd4bf',
    hairHex: '#1e1b4b',
  },
  kin: {
    id: 'kin',
    nameTh: 'คิน (Engineer)',
    roleBadgeTh: 'เฮดเซ็ตช่าง · เกราะไหล่',
    genderLabelTh: 'ชาย',
    icon: '🤖',
    accentHex: '#fb923c',
    removeCap: true,
    removeBackpack: true,
    outfitPrimaryHex: '#ea580c',
    outfitSecondaryHex: '#1e293b',
    bottomsHex: '#1c1917',
    shoesHex: '#facc15',
    hairHex: '#090d16',
  },
  sky: {
    id: 'sky',
    nameTh: 'กัปตันสกาย (Space)',
    roleBadgeTh: 'หมวกอวกาศ · ถังออกซิเจน',
    genderLabelTh: 'ชุดอวกาศ',
    icon: '🚀',
    accentHex: '#c084fc',
    removeCap: true,
    removeBackpack: true,
    outfitPrimaryHex: '#f8fafc',
    outfitSecondaryHex: '#a855f7',
    bottomsHex: '#e2e8f0',
    shoesHex: '#ec4899',
    hairHex: '#701a75',
  },
};

export const AVATAR_LIST: AvatarMeta[] = [
  AVATARS.non,
  AVATARS.may,
  AVATARS.praw,
  AVATARS.kin,
  AVATARS.sky,
];

export function sanitizeAvatarId(raw: unknown): AvatarId {
  if (typeof raw === 'string' && (raw === 'non' || raw === 'may' || raw === 'praw' || raw === 'kin' || raw === 'sky')) {
    return raw;
  }
  return 'non';
}

/**
 * Surgically filters disconnected triangle islands in `Boy01_Body_Geo` (`removeCap` and `removeBackpack`)
 * while keeping all vertex attributes (`position`, `normal`, `uv`, `skinIndex`, `skinWeight`) intact.
 */
export function filterBodyGeometryIslands(
  baseGeo: THREE.BufferGeometry,
  opts: { removeCap: boolean; removeBackpack: boolean },
): THREE.BufferGeometry {
  const cloned = baseGeo.clone();
  if (!opts.removeCap && !opts.removeBackpack) return cloned;

  const posAttr = cloned.getAttribute('position');
  const uvAttr = cloned.getAttribute('uv');
  const idxAttr = cloned.index;
  if (!posAttr || !idxAttr) return cloned;

  const n = posAttr.count;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    let c = x;
    while (c !== r) {
      const nxt = parent[c];
      parent[c] = r;
      c = nxt;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const idxArr = idxAttr.array;
  for (let i = 0; i < idxAttr.count; i += 3) {
    const a = idxArr[i];
    const b = idxArr[i + 1];
    const c = idxArr[i + 2];
    union(a, b);
    union(a, c);
  }

  interface IslandStats {
    count: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    uSum: number;
    vSum: number;
  }
  const islands = new Map<number, IslandStats>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let st = islands.get(r);
    if (!st) {
      st = { count: 0, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity, uSum: 0, vSum: 0 };
      islands.set(r, st);
    }
    st.count++;
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    st.minY = Math.min(st.minY, y);
    st.maxY = Math.max(st.maxY, y);
    st.minZ = Math.min(st.minZ, z);
    st.maxZ = Math.max(st.maxZ, z);
    if (uvAttr) {
      st.uSum += uvAttr.getX(i);
      st.vSum += uvAttr.getY(i);
    }
  }

  const droppedRoots = new Set<number>();
  for (const [root, st] of islands.entries()) {
    const avgU = uvAttr ? st.uSum / st.count : 0;
    const avgV = uvAttr ? st.vSum / st.count : 0;

    if (opts.removeCap) {
      // Baseball cap dome, inner liner, backwards visor brim, top button, and side strap
      // (Hair islands have avgU >= 0.78; Head skin has minY <= 1.40; Ears have minZ >= -0.02)
      const isCapMain = st.minY >= 1.44 && st.maxY >= 1.60 && st.minZ <= -0.05 && (!uvAttr || avgU < 0.75);
      const isCapTab = st.count <= 8 && st.minY >= 1.58 && st.maxY <= 1.62 && (!uvAttr || avgU < 0.15);
      if (isCapMain || isCapTab) {
        droppedRoots.add(root);
        continue;
      }
    }

    if (opts.removeBackpack) {
      // Backpack main bag, back pad, pockets/zippers, and shoulder straps
      const isBackBag = st.minY >= 0.85 && st.maxY <= 1.38 && st.maxZ <= -0.075;
      const isStrap = uvAttr && st.minY >= 0.90 && st.maxY <= 1.38 && avgU <= 0.12 && avgV <= 0.22;
      if (isBackBag || isStrap) {
        droppedRoots.add(root);
      }
    }
  }

  const keptIndices: number[] = [];
  for (let i = 0; i < idxAttr.count; i += 3) {
    const a = idxArr[i];
    if (!droppedRoots.has(find(a))) {
      keptIndices.push(a, idxArr[i + 1], idxArr[i + 2]);
    }
  }

  cloned.setIndex(keptIndices);
  return cloned;
}

const geoCache = new WeakMap<THREE.BufferGeometry, Partial<Record<AvatarId, THREE.BufferGeometry>>>();
const matCache: Partial<Record<AvatarId, THREE.Material>> = {};

/**
 * Generates a customized CanvasTexture over `Boy01_diffuse` by tinting the exact non-overlapping UV islands
 * for Torso, Sleeves, Collar/Hood, Trousers, Shoes, and Hair while keeping Face & Hand skin UVs untouched!
 */
function buildAvatarBodyMaterial(baseMat: THREE.Material, avatarId: AvatarId): THREE.Material {
  if (avatarId === 'non') return baseMat;
  if (matCache[avatarId]) return matCache[avatarId]!;

  const meta = AVATARS[avatarId];
  const clonedMat = baseMat.clone() as THREE.MeshStandardMaterial;

  if (typeof document === 'undefined') {
    matCache[avatarId] = clonedMat;
    return clonedMat;
  }

  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return clonedMat;

  const baseTex = clonedMat.map;
  const srcImg = baseTex?.image as CanvasImageSource | undefined;
  const hasDrawableImg =
    srcImg &&
    ((typeof HTMLImageElement !== 'undefined' && srcImg instanceof HTMLImageElement) ||
      (typeof HTMLCanvasElement !== 'undefined' && srcImg instanceof HTMLCanvasElement) ||
      (typeof ImageBitmap !== 'undefined' && srcImg instanceof ImageBitmap));

  if (hasDrawableImg) {
    g.drawImage(srcImg, 0, 0, W, H);
  } else {
    g.fillStyle = '#e2e8f0';
    g.fillRect(0, 0, W, H);
  }

  // Helper to recolor a UV rectangle while preserving baked cloth folds & shadows from Boy01_diffuse
  const tintUVRect = (u0: number, v0: number, u1: number, v1: number, hex: string, alpha = 0.78) => {
    const x = Math.floor(u0 * W);
    const y = Math.floor(v0 * H);
    const w = Math.ceil((u1 - u0) * W);
    const h = Math.ceil((v1 - v0) * H);
    g.save();
    g.globalCompositeOperation = hasDrawableImg ? 'color' : 'source-over';
    g.globalAlpha = alpha;
    g.fillStyle = hex;
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 0.35;
    g.fillStyle = hex;
    g.fillRect(x, y, w, h);
    const cRgb = new THREE.Color(hex);
    const luma = 0.299 * cRgb.r + 0.587 * cRgb.g + 0.114 * cRgb.b;
    if (luma > 0.72) {
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = Math.min(0.72, (luma - 0.65) * 1.85);
      g.fillStyle = hex;
      g.fillRect(x, y, w, h);
    }
    g.restore();
  };

  // 1. Torso Jacket / Blazer / Lab Coat: U [0.69, 1.00], V [0.00, 0.28]
  tintUVRect(0.69, 0.0, 1.0, 0.28, meta.outfitPrimaryHex, 0.85);
  // 2. Left & Right Sleeves: U [0.10, 0.42], V [0.00, 0.31]
  tintUVRect(0.10, 0.0, 0.42, 0.31, meta.outfitSecondaryHex, 0.82);
  // 3. Collar / Hood Trim: U [0.16, 0.73], V [0.35, 0.50]
  tintUVRect(0.16, 0.35, 0.73, 0.50, meta.outfitSecondaryHex, 0.85);
  // 4. Trousers / Leggings: U [0.02, 0.48], V [0.51, 1.00]
  tintUVRect(0.02, 0.51, 0.48, 1.0, meta.bottomsHex, 0.85);
  // 5. Shoes / Sneakers: U [0.50, 0.80], V [0.47, 0.69]
  tintUVRect(0.50, 0.47, 0.80, 0.69, meta.shoesHex, 0.82);
  // 6. Hair Strands: U [0.78, 1.00], V [0.38, 0.98]
  tintUVRect(0.78, 0.38, 1.0, 0.98, meta.hairHex, 0.88);

  const newTex = new THREE.CanvasTexture(c);
  newTex.colorSpace = THREE.SRGBColorSpace;
  if (baseTex) {
    newTex.flipY = baseTex.flipY;
    newTex.wrapS = baseTex.wrapS;
    newTex.wrapT = baseTex.wrapT;
  } else {
    newTex.flipY = false;
  }
  clonedMat.map = newTex;
  clonedMat.needsUpdate = true;
  matCache[avatarId] = clonedMat;
  return clonedMat;
}

/**
 * Builds bone-rigged 3D hairstyles, skirts, lab coats, visors, shoulder armor, and helmets
 * in Mixamo bone local space (1 unit = 1 cm = 0.01m inside the `player` hierarchy).
 */
function attachBoneCostumes(characterRoot: THREE.Object3D, avatarId: AvatarId) {
  // Remove any previously attached avatar costume groups first
  const toRemove: THREE.Object3D[] = [];
  characterRoot.traverse((o) => {
    if (o.userData?.isAvatarCostume) toRemove.push(o);
  });
  for (const o of toRemove) o.removeFromParent();
  characterRoot.userData.motionNodes = [];

  if (avatarId === 'non') return;

  const meta = AVATARS[avatarId];
  const findBone = (suffix: string): THREE.Object3D | null => {
    let found: THREE.Object3D | null = null;
    characterRoot.traverse((o) => {
      if (!found && (o.name === `mixamorig:${suffix}` || o.name.endsWith(suffix))) {
        found = o;
      }
    });
    return found;
  };

  const headBone = findBone('Head');
  const spineBone = findBone('Spine') || findBone('Hips');
  const spine2Bone = findBone('Spine2') || findBone('Spine');
  const isHipsFallback = spineBone?.name.endsWith('Hips') ?? false;
  const hipSign = isHipsFallback ? -1 : 1;

  const hairMat = new THREE.MeshPhongMaterial({ color: meta.hairHex, shininess: 55 });
  const accentMat = new THREE.MeshPhongMaterial({ color: meta.accentHex, emissive: meta.accentHex, emissiveIntensity: 0.28, shininess: 90 });
  const whiteMat = new THREE.MeshPhongMaterial({ color: 0xf8fafc, shininess: 65 });
  const darkMat = new THREE.MeshPhongMaterial({ color: 0x0f172a, shininess: 80 });

  // ==========================================================================
  // 🎀 MAY ('may' · Techno Girl — หญิง): Flowing High Ponytail + Pink Bow + Pleated Skirt
  // In mixamorig:Head space (IBM: by = 100*y - 141.97, bz = 100*z + 0.75):
  // Skull is centered at (0, 21, 1.5) with radius ~21.2cm; eyes at (0, 16.5, 22).
  // ==========================================================================
  if (avatarId === 'may') {
    if (headBone) {
      const headGrp = new THREE.Group();
      headGrp.userData.isAvatarCostume = true;
      headGrp.name = 'avatar-head-may';

      // Smooth crown hair dome over top & back of skull + side bangs framing cheeks
      const crownHair = new THREE.Mesh(
        new THREE.SphereGeometry(22.0, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.58),
        hairMat,
      );
      crownHair.position.set(0, 21.5, 0.5);
      crownHair.rotation.x = -0.35;
      for (const s of [-1, 1]) {
        const sideLock = new THREE.Mesh(new THREE.CapsuleGeometry(3.8, 15, 6, 10), hairMat);
        sideLock.position.set(s * 19.2, 14, 13.5);
        sideLock.rotation.z = s * 0.14;
        headGrp.add(sideLock);
      }

      // Pink Twin-Loop Ribbon Bow at high ponytail crown (visible from front silhouette & back)
      const bowCenter = new THREE.Mesh(new THREE.SphereGeometry(4.2, 12, 10), accentMat);
      bowCenter.position.set(0, 35, -16);
      for (const s of [-1, 1]) {
        const bowWing = new THREE.Mesh(new THREE.ConeGeometry(7.8, 14, 12), accentMat);
        bowWing.rotation.z = s * (Math.PI / 2 - 0.22);
        bowWing.position.set(s * 9.2, 36.5, -16.5);
        headGrp.add(bowWing);
      }

      // Dynamic swaying Ponytail pivot group (`userData.isPonytailPivot`)
      const tailPivot = new THREE.Group();
      tailPivot.position.set(0, 32, -19.5);
      tailPivot.userData.isPonytailPivot = true;

      const tailUpper = new THREE.Mesh(new THREE.ConeGeometry(8.6, 26, 14), hairMat);
      tailUpper.rotation.x = -Math.PI * 0.68;
      tailUpper.position.set(0, -4, -11);
      const tailLower = new THREE.Mesh(new THREE.ConeGeometry(6.4, 22, 14), hairMat);
      tailLower.rotation.x = -Math.PI * 0.82;
      tailLower.position.set(0, -16, -20);
      const tailTip = new THREE.Mesh(new THREE.ConeGeometry(3.8, 13, 12), accentMat);
      tailTip.rotation.x = -Math.PI * 0.86;
      tailTip.position.set(0, -25, -25);
      tailPivot.add(tailUpper, tailLower, tailTip);

      headGrp.add(crownHair, bowCenter, tailPivot);
      headBone.add(headGrp);
    }

    if (spineBone) {
      const hipGrp = new THREE.Group();
      hipGrp.userData.isAvatarCostume = true;
      hipGrp.userData.isSkirtGroup = true;
      hipGrp.name = 'avatar-skirt-may';

      const navySkirtMat = new THREE.MeshPhongMaterial({ color: 0x1e3a8a, side: THREE.DoubleSide, shininess: 40 });
      // Flared pleated school skirt + pink waist belt + hem stripe
      const waistBelt = new THREE.Mesh(new THREE.TorusGeometry(15.2, 2.0, 8, 24), accentMat);
      waistBelt.rotation.x = Math.PI / 2;
      waistBelt.position.set(0, hipSign * -3, -1.5);

      const skirtCone = new THREE.Mesh(new THREE.CylinderGeometry(15.0, 24.5, 24, 20, 1, true), navySkirtMat);
      if (isHipsFallback) skirtCone.rotation.x = Math.PI;
      skirtCone.position.set(0, hipSign * -14, -1.5);

      const hemTrim = new THREE.Mesh(new THREE.TorusGeometry(23.8, 1.3, 8, 24), accentMat);
      hemTrim.rotation.x = Math.PI / 2;
      hemTrim.position.set(0, hipSign * -25, -1.5);

      hipGrp.add(waistBelt, skirtCone, hemTrim);
      spineBone.add(hipGrp);
    }
  }

  // ==========================================================================
  // 🧬 DR. PRAW ('praw' · Lab Researcher — หญิง): Twin Buns + Holo Glasses + Flared Lab Coat
  // ==========================================================================
  else if (avatarId === 'praw') {
    if (headBone) {
      const headGrp = new THREE.Group();
      headGrp.userData.isAvatarCostume = true;
      headGrp.name = 'avatar-head-praw';

      const crownHair = new THREE.Mesh(
        new THREE.SphereGeometry(22.0, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.58),
        hairMat,
      );
      crownHair.position.set(0, 21.5, 0.5);
      crownHair.rotation.x = -0.35;
      headGrp.add(crownHair);

      // Twin space-buns (Chignon buns) on upper-left & upper-right of skull with glowing mint hair-rings
      for (const s of [-1, 1]) {
        const bun = new THREE.Mesh(new THREE.SphereGeometry(8.5, 16, 14), hairMat);
        bun.position.set(s * 18.5, 37.5, -4);
        const bunRing = new THREE.Mesh(new THREE.TorusGeometry(7.0, 1.4, 8, 20), accentMat);
        bunRing.position.set(s * 15.8, 35.2, -3.5);
        bunRing.rotation.y = s * 0.65;
        bunRing.rotation.x = 0.55;
        headGrp.add(bun, bunRing);
      }

      // Translucent Mint Hologram Lab Visor Glasses across eyes (by = 17, bz = +26)
      const visorGlass = new THREE.Mesh(
        new THREE.CylinderGeometry(22.6, 22.6, 7.5, 20, 1, true, -Math.PI * 0.34, Math.PI * 0.68),
        new THREE.MeshPhongMaterial({
          color: 0x2dd4bf,
          emissive: 0x0d9488,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          shininess: 110,
        }),
      );
      visorGlass.position.set(0, 17.5, 5.2);
      const visorFrame = new THREE.Mesh(new THREE.BoxGeometry(36, 1.6, 4), whiteMat);
      visorFrame.position.set(0, 21.4, 24.5);
      headGrp.add(visorGlass, visorFrame);
      headBone.add(headGrp);
    }

    if (spineBone) {
      const coatGrp = new THREE.Group();
      coatGrp.userData.isAvatarCostume = true;
      coatGrp.userData.isSkirtGroup = true;
      coatGrp.name = 'avatar-coat-praw';

      // Flared White Lab-Coat Tail with Mint Bio-Trim around hips (open at front +Z, wraps sides & back -Z)
      const coatFlare = new THREE.Mesh(
        new THREE.CylinderGeometry(15.4, 23.5, 26, 20, 1, true, Math.PI * 0.18, Math.PI * 1.64),
        new THREE.MeshPhongMaterial({ color: 0xf8fafc, side: THREE.DoubleSide, shininess: 60 }),
      );
      if (isHipsFallback) coatFlare.rotation.x = Math.PI;
      coatFlare.position.set(0, hipSign * -15, -1.5);

      const belt = new THREE.Mesh(new THREE.TorusGeometry(15.5, 1.8, 8, 24), accentMat);
      belt.rotation.x = Math.PI / 2;
      belt.position.set(0, hipSign * -3, -1.5);
      coatGrp.add(coatFlare, belt);
      spineBone.add(coatGrp);
    }

    if (spine2Bone) {
      // Compact Bio-Capsule Med-Pack on upper back
      const bioPack = new THREE.Group();
      bioPack.userData.isAvatarCostume = true;
      const caseBox = new THREE.Mesh(new THREE.BoxGeometry(18, 22, 9), whiteMat);
      caseBox.position.set(0, 8, -13);
      const vial = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 17, 12), accentMat);
      vial.position.set(0, 8, -18);
      bioPack.add(caseBox, vial);
      spine2Bone.add(bioPack);
    }
  }

  // ==========================================================================
  // 🤖 KIN ('kin' · Robo Engineer — ชาย): Spiky Hair + Tech Headset & Visor + Shoulder Armor
  // ==========================================================================
  else if (avatarId === 'kin') {
    if (headBone) {
      const headGrp = new THREE.Group();
      headGrp.userData.isAvatarCostume = true;
      headGrp.name = 'avatar-head-kin';

      // Spiky dark hair tufts on crown (above by = 38)
      const baseHair = new THREE.Mesh(
        new THREE.SphereGeometry(21.8, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
        hairMat,
      );
      baseHair.position.set(0, 21.5, 0.5);
      baseHair.rotation.x = -0.3;
      headGrp.add(baseHair);
      for (let i = -2; i <= 2; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(5.5, 14, 10), hairMat);
        spike.position.set(i * 6.0, 41 - Math.abs(i) * 1.4, 2 - Math.abs(i) * 2);
        spike.rotation.z = -i * 0.22;
        spike.rotation.x = -0.2;
        headGrp.add(spike);
      }

      // Industrial Comms Headset Band + Ear Cups + Curved Amber HUD Visor
      const headband = new THREE.Mesh(new THREE.TorusGeometry(23.0, 1.8, 8, 24, Math.PI), accentMat);
      headband.position.set(0, 20, 0);
      for (const s of [-1, 1]) {
        const earCup = new THREE.Mesh(new THREE.CylinderGeometry(6.0, 6.0, 4.0, 14), darkMat);
        earCup.rotation.z = Math.PI / 2;
        earCup.position.set(s * 22.2, 16.5, 0);
        const earRing = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.9, 8, 16), accentMat);
        earRing.rotation.y = Math.PI / 2;
        earRing.position.set(s * 24.4, 16.5, 0);
        headGrp.add(earCup, earRing);
      }
      const eyeVisor = new THREE.Mesh(
        new THREE.CylinderGeometry(22.6, 22.6, 6.8, 20, 1, true, -Math.PI * 0.34, Math.PI * 0.68),
        accentMat,
      );
      eyeVisor.position.set(0, 17.5, 5.2);
      headGrp.add(headband, eyeVisor);
      headBone.add(headGrp);
    }

    if (spine2Bone) {
      const armorGrp = new THREE.Group();
      armorGrp.userData.isAvatarCostume = true;
      armorGrp.name = 'avatar-armor-kin';

      // Twin Robotic Shoulder Pauldrons + Back Arc-Reactor Core
      for (const s of [-1, 1]) {
        const pauldron = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 18), accentMat);
        pauldron.position.set(s * 22.5, 14.5, -1);
        pauldron.rotation.z = -s * 0.25;
        const trim = new THREE.Mesh(new THREE.BoxGeometry(14.8, 2.5, 18.8), darkMat);
        trim.position.set(s * 22.5, 12.5, -1);
        trim.rotation.z = -s * 0.25;
        armorGrp.add(pauldron, trim);
      }
      const coreFrame = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 10.5, 7, 14), darkMat);
      coreFrame.rotation.x = Math.PI / 2;
      coreFrame.position.set(0, 8, -12);
      const coreGlow = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 8.2, 14), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      coreGlow.rotation.x = Math.PI / 2;
      coreGlow.position.set(0, 8, -12.6);
      armorGrp.add(coreFrame, coreGlow);
      spine2Bone.add(armorGrp);
    }
  }

  // ==========================================================================
  // 🚀 CAPTAIN SKY ('sky' · Space Cadet — ชุดอวกาศ): Astronaut Dome Helmet + Gold Visor + Twin O2 Tanks
  // ==========================================================================
  else if (avatarId === 'sky') {
    if (headBone) {
      const helmetGrp = new THREE.Group();
      helmetGrp.userData.isAvatarCostume = true;
      helmetGrp.name = 'avatar-helmet-sky';

      // Outer white astronaut pressure helmet shell (encloses entire 21.5cm head)
      const shell = new THREE.Mesh(new THREE.SphereGeometry(26.5, 24, 20), whiteMat);
      shell.position.set(0, 19.5, 2.2);
      // Reflective Gold Solar Visor on front (+Z) of helmet (phi centered at Math.PI / 2)
      const goldVisor = new THREE.Mesh(
        new THREE.SphereGeometry(27.1, 22, 18, Math.PI * 0.15, Math.PI * 0.70, Math.PI * 0.24, Math.PI * 0.46),
        new THREE.MeshPhongMaterial({
          color: 0xfacc15,
          emissive: 0xa16207,
          emissiveIntensity: 0.45,
          shininess: 120,
        }),
      );
      goldVisor.position.set(0, 19.5, 2.2);
      // Magenta neck seal ring + comms antenna ear pod
      const neckRing = new THREE.Mesh(new THREE.TorusGeometry(18.5, 2.4, 10, 24), accentMat);
      neckRing.rotation.x = Math.PI / 2;
      neckRing.position.set(0, -1.5, 1.5);
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 16, 8), accentMat);
      antenna.position.set(25.5, 29, 0);
      const antTip = new THREE.Mesh(new THREE.SphereGeometry(2.8, 10, 10), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      antTip.position.set(25.5, 38, 0);

      helmetGrp.add(shell, goldVisor, neckRing, antenna, antTip);
      headBone.add(helmetGrp);
    }

    if (spine2Bone) {
      const packGrp = new THREE.Group();
      packGrp.userData.isAvatarCostume = true;
      packGrp.name = 'avatar-o2pack-sky';

      // Twin Cylindrical Oxygen Life-Support Tanks + Cosmic Halo Collar
      for (const s of [-1, 1]) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 26, 14), whiteMat);
        tank.position.set(s * 7.5, 7, -14);
        const capTop = new THREE.Mesh(new THREE.SphereGeometry(6.2, 12, 10), accentMat);
        capTop.position.set(s * 7.5, 20, -14);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 4.0, 14), accentMat);
        band.position.set(s * 7.5, 7, -14);
        packGrp.add(tank, capTop, band);
      }
      spine2Bone.add(packGrp);
    }
  }

  const motionNodes: THREE.Object3D[] = [];
  characterRoot.traverse((o) => {
    if (o.userData?.isPonytailPivot || o.userData?.isSkirtGroup) {
      motionNodes.push(o);
    }
  });
  characterRoot.userData.motionNodes = motionNodes;
}

/**
 * Applies the selected `AvatarId` (`non`, `may`, `praw`, `kin`, `sky`) to a character root (`PlayerView.model` or a cloned `GhostSlot` character):
 * 1. Filters cap/backpack mesh islands on `Boy01_Body_Geo`
 * 2. Applies the custom UV outfit texture
 * 3. Attaches bone-rigged 3D hairstyles, skirts, lab coats, visors, shoulder pads, or helmets
 */
export function applyAvatarToCharacter(characterRoot: THREE.Object3D, rawAvatarId: AvatarId) {
  const avatarId = sanitizeAvatarId(rawAvatarId);
  const meta = AVATARS[avatarId];
  characterRoot.userData.avatarId = avatarId;

  characterRoot.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isMesh && (m.name === 'Boy01_Body_Geo' || m.name.includes('Body_Geo'))) {
      if (!m.userData.baseGeometry) {
        m.userData.baseGeometry = m.geometry;
      }
      if (!m.userData.baseMaterial) {
        m.userData.baseMaterial = m.material;
      }
      const baseGeo = m.userData.baseGeometry as THREE.BufferGeometry;
      const baseMat = m.userData.baseMaterial as THREE.Material;

      let perAvatarGeos = geoCache.get(baseGeo);
      if (!perAvatarGeos) {
        perAvatarGeos = {};
        geoCache.set(baseGeo, perAvatarGeos);
      }
      if (!perAvatarGeos[avatarId]) {
        perAvatarGeos[avatarId] = filterBodyGeometryIslands(baseGeo, {
          removeCap: meta.removeCap,
          removeBackpack: meta.removeBackpack,
        });
      }
      m.geometry = perAvatarGeos[avatarId]!;
      m.material = buildAvatarBodyMaterial(baseMat, avatarId);
    }
  });

  attachBoneCostumes(characterRoot, avatarId);
}

/**
 * Animates secondary motion on bone-attached hair ponytails (`may`) and skirts/coats (`may`, `praw`)
 * during running and lobby warm-up.
 */
export function updateAvatarMotion(characterRoot: THREE.Object3D, time: number, isRunning: boolean) {
  let nodes = characterRoot.userData?.motionNodes as THREE.Object3D[] | undefined;
  if (!nodes) {
    nodes = [];
    characterRoot.traverse((o) => {
      if (o.userData?.isPonytailPivot || o.userData?.isSkirtGroup) {
        nodes!.push(o);
      }
    });
    characterRoot.userData.motionNodes = nodes;
  }
  if (nodes.length === 0) return;
  const freq = isRunning ? 11.5 : 3.2;
  const amp = isRunning ? 0.26 : 0.08;
  for (let i = 0; i < nodes.length; i++) {
    const o = nodes[i];
    if (o.userData?.isPonytailPivot) {
      o.rotation.x = Math.sin(time * freq) * amp;
      o.rotation.z = Math.cos(time * (freq * 0.5)) * (amp * 0.65);
    } else if (o.userData?.isSkirtGroup) {
      const flare = 1 + Math.abs(Math.sin(time * freq)) * (isRunning ? 0.08 : 0.02);
      o.scale.set(flare, 1, flare);
    }
  }
}
