// The three.js scene: 9-Center Open-Horizon Biomes, Dynamic Shader Sky Dome, Center Portal Gates, and Animated 3D Worlds.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Instanced } from './pools';
import { Fx } from './fx';
import { PlayerView, createCenterAttachments, updateCenterAttachments } from './player';
import {
  trackTexture, pavingTexture, groundTexture, glowTexture,
  centerCapsuleTexture, centerBillboardTexture, centerGateBannerTexture,
  nameBadgeTexture, rampTexture, HORIZON, lerpCenterBiome,
  architecturalTowerSkinTexture, controlCabWindowSkinTexture, windsockSkinTexture,
  solarArraySkinTexture, serverRackSkinTexture, bioreactorSkinTexture, rocketHullSkinTexture,
} from './textures';
import {
  LANE_W, laneX, CAR_LEN, CAR_GAP, VIEW_AHEAD, OB, CENTERS, CENTER_LIST,
  STAGE_CENTER_ORDER, stageGateDistances,
} from '../config';
import type { Sim } from '../sim/sim';
import type { SimEvent, CenterId, Ob } from '../sim/types';
import type { RunnerNetState } from '../net';
import {
  applyAvatarToCharacter, updateAvatarMotion, sanitizeAvatarId, type AvatarId,
} from './avatars';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);
const sc = new THREE.Vector3();
const TRAIN_TINTS = [new THREE.Color('#38bdf8'), new THREE.Color('#facc15'), new THREE.Color('#c084fc')];
const CENTER_COLORS: Record<CenterId, THREE.Color> = {
  1: new THREE.Color(CENTERS[1].color),
  2: new THREE.Color(CENTERS[2].color),
  3: new THREE.Color(CENTERS[3].color),
  4: new THREE.Color(CENTERS[4].color),
  5: new THREE.Color(CENTERS[5].color),
  6: new THREE.Color(CENTERS[6].color),
  7: new THREE.Color(CENTERS[7].color),
  8: new THREE.Color(CENTERS[8].color),
  9: new THREE.Color(CENTERS[9].color),
};
const LIGHT = new THREE.Color(0.35, 0.85, 1.0);
const LIGHT_RED = new THREE.Color(1.0, 0.25, 0.4);
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const GROUND_LEN = 300;
const SIDEWALK_IN = 4.2;
const SIDEWALK_OUT = 8.2;

export const SCENERY_POOL_LIMITS = {
  staticPerCenter: 42,
  kineticPerCenter: 28,
  overheadPerCenter: 18,
  billboardsPerCenter: 8,
} as const;

interface GhostSlot {
  group: THREE.Group;
  runnerId: string;
  charClone: THREE.Object3D;
  avatar: AvatarId;
  mixer: THREE.AnimationMixer;
  attachments: Record<CenterId, THREE.Group>;
  activeCenter: CenterId | null;
  wasStumbling: boolean;
  ring: THREE.Mesh;
  badge: THREE.Sprite;
  badgeKey: string;
  x: number;
  y: number;
  z: number;
}

export class World {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  player: PlayerView;
  fx: Fx;
  private pools: Record<string, Instanced> = {};
  private coins: Instanced;
  private halos: Instanced;
  private centerCards: Record<CenterId, Instanced> = {} as Record<CenterId, Instanced>;
  private centerBillboards: Record<CenterId, Instanced> = {} as Record<CenterId, Instanced>;
  private centerGates: Record<CenterId, Instanced> = {} as Record<CenterId, Instanced>;
  private centerStatic: Record<CenterId, Instanced> = {} as Record<CenterId, Instanced>;
  private centerKinetic: Record<CenterId, Instanced> = {} as Record<CenterId, Instanced>;
  private centerOverhead: Record<CenterId, Instanced> = {} as Record<CenterId, Instanced>;

  private skyMat!: THREE.ShaderMaterial;
  private skyDome!: THREE.Mesh;
  private horizonGroup!: THREE.Group;
  private horizonSunMat!: THREE.MeshBasicMaterial;
  private horizonRing!: THREE.Mesh;
  private horizonRingMat!: THREE.MeshBasicMaterial;

  private trackMat!: THREE.MeshLambertMaterial;
  private paveMat!: THREE.MeshLambertMaterial;
  private groundMat!: THREE.MeshLambertMaterial;
  private curbMat!: THREE.MeshLambertMaterial;
  private scrollTex: THREE.Texture[] = [];
  private ghostSlots: GhostSlot[] = [];
  private camY = 0;
  private shake = 0;
  private flash = 0;
  private aspect = 1;
  time = 0;

  constructor(core: GLTF, quality: { shadowSize: number }) {
    const s = this.scene;
    s.background = new THREE.Color('#0ea5e9');
    s.fog = new THREE.Fog(HORIZON, 65, 215);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 280);
    this.hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 1.55);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(10, 26, 6);
    this.sun.target.position.set(0, 0, -14);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(quality.shadowSize, quality.shadowSize);
    Object.assign(sh.camera, { left: -16, right: 16, top: 30, bottom: -30, near: 2, far: 70 });
    sh.bias = -0.0008;
    sh.normalBias = 0.03;
    s.add(this.sun, this.sun.target);

    this.buildSkyDome(s);
    this.buildGround();
    this.buildCenterPortalGates(s);
    this.buildNineCenterWorlds(s);
    this.buildCenterBillboards(s);

    const node = (n: string) => {
      const o = core.scene.getObjectByName(n);
      if (!o) throw new Error('missing model ' + n);
      return o;
    };
    this.pools.train = new Instanced(node('train'), 60, s, { cast: true, receive: true, colors: true });
    this.pools.low = new Instanced(node('low'), 24, s, { cast: true, receive: true });
    this.pools.hurdle = new Instanced(node('hurdle'), 24, s, { cast: true, receive: true });
    this.pools.overhead = new Instanced(node('overhead'), 24, s, { cast: true, receive: true });
    this.pools.ramp = new Instanced(rampMesh(), 16, s, { cast: true, receive: true });

    const coin = node('coin');
    coin.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.MeshLambertMaterial).emissive = new THREE.Color(0x6b4300);
    });
    this.coins = new Instanced(coin, 340, s, { cast: false });

    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
    glow.name = 'glow';
    this.halos = new Instanced(glow, 380, s, { colors: true });
    for (const p of this.halos.parts) p.mesh.renderOrder = 4;

    // 9 Center Pickup Capsules on the track
    for (const meta of CENTER_LIST) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 1.3),
        new THREE.MeshBasicMaterial({ map: centerCapsuleTexture(meta.id), transparent: true, alphaTest: 0.1 }),
      );
      m.name = 'center-card-' + meta.id;
      this.centerCards[meta.id] = new Instanced(m, 4, s);
    }

    this.player = new PlayerView(core, s);
    this.buildGhostPackPool(core, s);
    this.fx = new Fx(s);
  }

  /** Dynamic 3-stop gradient Sky Dome + twinkling starfield shader + Horizon Sun / Ringed Planet. */
  private buildSkyDome(scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSkyTop: { value: new THREE.Color('#0369a1') },
        uSkyMid: { value: new THREE.Color('#0ea5e9') },
        uSkyHorizon: { value: new THREE.Color('#bae6fd') },
        uStarIntensity: { value: 0.0 },
        uTime: { value: 0.0 },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        uniform vec3 uSkyTop;
        uniform vec3 uSkyMid;
        uniform vec3 uSkyHorizon;
        uniform float uStarIntensity;
        uniform float uTime;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
          vec3 d = normalize(vWorldPos);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.28, h));
          col = mix(col, uSkyTop, smoothstep(0.28, 0.88, h));

          if (uStarIntensity > 0.01 && h > 0.08) {
            vec2 uv = d.xz / (d.y + 0.35) * 42.0;
            vec2 grid = floor(uv);
            vec2 f = fract(uv) - 0.5;
            float n = hash(grid);
            if (n > 0.965) {
              float dist = length(f);
              float twinkle = 0.65 + 0.35 * sin(uTime * 3.5 + n * 60.0);
              float star = smoothstep(0.18, 0.0, dist) * twinkle * uStarIntensity * smoothstep(0.08, 0.35, h);
              col += vec3(star);
            }
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(240, 32, 20), this.skyMat);
    this.skyDome.renderOrder = -10;
    scene.add(this.skyDome);

    // Horizon Celestial Sun / Ringed Planet
    this.horizonGroup = new THREE.Group();
    this.horizonGroup.position.set(0, 26, -195);
    this.horizonSunMat = new THREE.MeshBasicMaterial({ color: 0xfef08a, fog: false });
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 24), this.horizonSunMat);

    this.horizonRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      fog: false,
    });
    const ringGeo = new THREE.RingGeometry(19, 31, 40);
    ringGeo.rotateX(Math.PI / 2.6);
    ringGeo.rotateY(0.35);
    this.horizonRing = new THREE.Mesh(ringGeo, this.horizonRingMat);
    this.horizonRing.visible = false;

    this.horizonGroup.add(sunDisc, this.horizonRing);
    scene.add(this.horizonGroup);
  }

  /** Grand Portal Gates placed at each of the 9 Center stage boundaries (`STAGE X / 9`). */
  private buildCenterPortalGates(scene: THREE.Scene) {
    STAGE_CENTER_ORDER.forEach((centerId, stageIdx) => {
      const meta = CENTERS[centerId];
      const grp = new THREE.Group();
      grp.name = 'portal-gate-' + centerId;

      const darkMat = new THREE.MeshLambertMaterial({ color: 0x0f172a });
      const neonMat = new THREE.MeshBasicMaterial({ color: meta.color });

      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.65, 8.8, 0.65), darkMat);
        pillar.position.set(side * 4.8, 4.4, 0);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 8.6, 0.72), neonMat);
        strip.position.set(side * 4.5, 4.4, 0);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.95, 0.6, 8), neonMat);
        base.position.set(side * 4.8, 0.3, 0);
        grp.add(pillar, strip, base);
      }

      const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.45, 0.65), neonMat);
      crossBeam.position.set(0, 8.7, 0);
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(8.6, 2.15),
        new THREE.MeshBasicMaterial({ map: centerGateBannerTexture(centerId, stageIdx + 1), side: THREE.DoubleSide }),
      );
      banner.position.set(0, 7.2, 0.36);

      grp.add(crossBeam, banner);
      this.centerGates[centerId] = new Instanced(grp, 2, scene, { name: 'gate-' + centerId });
    });
  }

  /**
   * Builds 9 distinct, richly-skinned 3D Worlds (Static Architecture + Animated Kinetic Mechanisms + Overhead Sky Elements)
   * with procedural hull textures, structural collars, observation decks, and realistic engineering geometry.
   */
  private buildNineCenterWorlds(scene: THREE.Scene) {
    const whiteMat = new THREE.MeshPhongMaterial({ color: 0xf8fafc, shininess: 45 });
    const silverMat = new THREE.MeshPhongMaterial({ color: 0xcbd5e1, shininess: 65 });
    const slateMat = new THREE.MeshPhongMaterial({ color: 0x334155, shininess: 50 });
    const darkMat = new THREE.MeshPhongMaterial({ color: 0x0f172a, shininess: 80 });
    const glassDarkMat = new THREE.MeshPhongMaterial({ color: 0x0c4a6e, emissive: 0x082f49, shininess: 110 });
    const solarSkinMat = new THREE.MeshPhongMaterial({ map: solarArraySkinTexture(), shininess: 85 });

    // ========================================================================
    // #1 AVIATION (ชั้น 1): Textured Air Traffic Control Tower + Striped Windsock + Hangar + Jet Squadron
    // ========================================================================
    {
      const aeroTowerSkin = new THREE.MeshPhongMaterial({
        map: architecturalTowerSkinTexture('#f1f5f9', '#38bdf8', '#0284c7'),
        shininess: 55,
      });
      const atcCabGlassMat = new THREE.MeshPhongMaterial({
        map: controlCabWindowSkinTexture('#38bdf8', '#0f172a'),
        emissive: 0x075985,
        emissiveIntensity: 0.35,
        shininess: 95,
      });
      const windsockMat = new THREE.MeshLambertMaterial({
        map: windsockSkinTexture(),
        side: THREE.DoubleSide,
      });

      const stat = new THREE.Group();
      // Flared architectural foundation plinth
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.5, 0.7, 16), slateMat);
      plinth.position.y = 0.35;
      // Lower & upper ribbed control tower shaft with procedural hull skin
      const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 1.18, 3.8, 16), aeroTowerSkin);
      towerBase.position.y = 2.5;
      const midCollar = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.05, 0.36, 16), slateMat);
      midCollar.position.y = 4.4;
      const midRing = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.06, 8, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      midRing.rotation.x = Math.PI / 2;
      midRing.position.y = 4.4;
      const towerShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.82, 2.9, 16), aeroTowerSkin);
      towerShaft.position.y = 5.95;
      // External elevator/service spine along tower side
      const elevShaft = new THREE.Mesh(new THREE.BoxGeometry(0.38, 6.4, 0.42), slateMat);
      elevShaft.position.set(-0.78, 3.7, 0);
      // Lower observation catwalk deck & safety railing
      const catwalk = new THREE.Mesh(new THREE.CylinderGeometry(1.48, 0.95, 0.48, 16), silverMat);
      catwalk.position.y = 7.4;
      const railRing = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.045, 8, 24), slateMat);
      railRing.rotation.x = Math.PI / 2;
      railRing.position.y = 7.72;
      // Multi-pane angled ATC control cab with interior radar glow
      const cabGlass = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.28, 1.35, 16), atcCabGlassMat);
      cabGlass.position.y = 8.28;
      // Overhanging roof visor + communications deck
      const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.75, 0.32, 16), whiteMat);
      cabRoof.position.y = 9.08;
      const roofCap = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.2, 0.28, 16), slateMat);
      roofCap.position.y = 9.35;

      // Striped aviation windsock on swivel frame
      const windsockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.4, 10), silverMat);
      windsockPole.position.set(2.05, 1.7, 0);
      const sockArm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8), silverMat);
      sockArm.rotation.z = Math.PI / 2;
      sockArm.position.set(2.3, 3.25, 0);
      const sockHoop = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 16), slateMat);
      sockHoop.rotation.y = Math.PI / 2;
      sockHoop.position.set(2.42, 3.05, 0);
      const windsock = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 1.25, 16, 1, true), windsockMat);
      windsock.rotation.z = Math.PI / 2 - 0.12;
      windsock.position.set(3.02, 2.98, 0);

      // Side Quonset Airfield Hangar Bay
      const hangarShell = new THREE.Mesh(
        new THREE.CylinderGeometry(1.35, 1.35, 2.2, 16, 1, false, 0, Math.PI),
        aeroTowerSkin,
      );
      hangarShell.rotation.z = Math.PI / 2;
      hangarShell.rotation.y = Math.PI / 2;
      hangarShell.position.set(-2.2, 0.1, 0);
      const hangarDoor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 2.24), darkMat);
      hangarDoor.position.set(-2.2, 0.55, 0);

      stat.add(
        plinth, towerBase, midCollar, midRing, towerShaft, elevShaft,
        catwalk, railRing, cabGlass, cabRoof, roofCap,
        windsockPole, sockArm, sockHoop, windsock, hangarShell, hangarDoor,
      );
      this.centerStatic[1] = new Instanced(stat, SCENERY_POOL_LIMITS.staticPerCenter, scene, { name: 'c1-stat' });

      // Rotating Dual-Band Airport Surveillance Radar
      const kin = new THREE.Group();
      const pedMount = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.32, 12), slateMat);
      const primaryDish = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.36, 0.14), whiteMat);
      primaryDish.position.set(0, 0.28, 0);
      const secondaryBar = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.14, 0.22), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      secondaryBar.position.set(0, 0.55, 0.08);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      beacon.position.y = 0.78;
      kin.add(pedMount, primaryDish, secondaryBar, beacon);
      this.centerKinetic[1] = new Instanced(kin, SCENERY_POOL_LIMITS.kineticPerCenter, scene, { name: 'c1-kin' });

      // Detailed Supersonic Twin-Tail Jet Fighter Squadron overhead!
      const over = new THREE.Group();
      const noseCone = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.1, 16), slateMat);
      noseCone.rotation.x = -Math.PI / 2;
      noseCone.position.z = -1.65;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 2.2, 16), aeroTowerSkin);
      body.rotation.x = -Math.PI / 2;
      body.position.z = 0;
      // Tinted bubble cockpit canopy
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 10), glassDarkMat);
      canopy.scale.set(0.85, 0.72, 2.2);
      canopy.position.set(0, 0.18, -0.45);
      // Swept delta main wing with ExtrudeGeometry
      const jetWingShape = new THREE.Shape();
      jetWingShape.moveTo(0, 0.65);
      jetWingShape.lineTo(1.65, -0.35);
      jetWingShape.lineTo(1.5, -0.65);
      jetWingShape.lineTo(0, -0.2);
      jetWingShape.lineTo(-1.5, -0.65);
      jetWingShape.lineTo(-1.65, -0.35);
      jetWingShape.closePath();
      const jetWingGeo = new THREE.ExtrudeGeometry(jetWingShape, { depth: 0.07, bevelEnabled: false });
      jetWingGeo.rotateX(Math.PI / 2);
      const mainWing = new THREE.Mesh(jetWingGeo, aeroTowerSkin);
      mainWing.position.set(0, 0.02, 0.25);
      // Wingtip missile rails & navigation strobes
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.85, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
        rail.rotation.x = Math.PI / 2;
        rail.position.set(s * 1.58, 0, 0.45);
        const intake = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 1.3), slateMat);
        intake.position.set(s * 0.32, -0.04, 0.1);
        const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.68, 0.58), aeroTowerSkin);
        tailFin.position.set(s * 0.28, 0.38, 0.85);
        tailFin.rotation.z = -s * 0.24;
        const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.58), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
        finTip.position.set(s * 0.36, 0.68, 0.85);
        finTip.rotation.z = -s * 0.24;
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.36, 12), darkMat);
        nozzle.rotation.x = Math.PI / 2;
        nozzle.position.set(s * 0.18, 0, 1.22);
        const burnerOuter = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.85, 12), new THREE.MeshBasicMaterial({ color: 0xf97316 }));
        burnerOuter.rotation.x = Math.PI / 2;
        burnerOuter.position.set(s * 0.18, 0, 1.75);
        const burnerCore = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 10), new THREE.MeshBasicMaterial({ color: 0xfef08a }));
        burnerCore.rotation.x = Math.PI / 2;
        burnerCore.position.set(s * 0.18, 0, 1.58);
        over.add(rail, intake, tailFin, finTip, nozzle, burnerOuter, burnerCore);
      }
      over.add(noseCone, body, canopy, mainWing);
      this.centerOverhead[1] = new Instanced(over, SCENERY_POOL_LIMITS.overheadPerCenter, scene, { name: 'c1-over' });
    }

    // ========================================================================
    // #4 CLEAN ENERGY (ชั้น 1): Textured Wind Turbine w/ Nacelle + Gridded Solar Tracker + Biosphere Dome
    // ========================================================================
    {
      const ecoTowerSkin = new THREE.MeshPhongMaterial({
        map: architecturalTowerSkinTexture('#f8fafc', '#4ade80', '#10b981'),
        shininess: 50,
      });
      const foliageMat1 = new THREE.MeshLambertMaterial({ color: 0x16a34a });
      const foliageMat2 = new THREE.MeshLambertMaterial({ color: 0x4ade80 });

      const stat = new THREE.Group();
      const basePad = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 0.55, 16), slateMat);
      basePad.position.y = 0.28;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 7.4, 20), ecoTowerSkin);
      mast.position.y = 3.9;
      // Horizontal aerodynamic turbine nacelle housing at top of mast
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 1.55, 16), ecoTowerSkin);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(0, 7.6, -0.2);
      const nacelleCap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 12), silverMat);
      nacelleCap.position.set(0, 7.6, -0.95);

      // Dual-Axis Photovoltaic Solar Tracker with cell grid skin
      const trackerPost = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.45, 12), slateMat);
      trackerPost.position.set(2.15, 0.72, 0);
      const solarPanel = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 1.7), solarSkinMat);
      solarPanel.position.set(2.15, 1.5, 0);
      solarPanel.rotation.x = 0.48;
      const solarBack = new THREE.Mesh(new THREE.BoxGeometry(2.58, 0.08, 1.78), silverMat);
      solarBack.position.set(2.15, 1.44, -0.03);
      solarBack.rotation.x = 0.48;

      // Lush Eco-Park Tree & Solar Garden Planter on Left Side
      const planterBase = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.48, 0.45, 16), slateMat);
      planterBase.position.set(-2.1, 0.22, 0);
      const planterRim = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.06, 8, 24), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
      planterRim.rotation.x = Math.PI / 2;
      planterRim.position.set(-2.1, 0.45, 0);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 1.35, 10), new THREE.MeshLambertMaterial({ color: 0x78350f }));
      trunk.position.set(-2.1, 0.9, 0);
      const crown1 = new THREE.Mesh(new THREE.SphereGeometry(0.88, 14, 14), foliageMat1);
      crown1.position.set(-2.1, 1.85, 0);
      const crown2 = new THREE.Mesh(new THREE.SphereGeometry(0.68, 14, 14), foliageMat2);
      crown2.position.set(-1.65, 1.55, 0.35);
      const crown3 = new THREE.Mesh(new THREE.SphereGeometry(0.64, 14, 14), foliageMat2);
      crown3.position.set(-2.5, 1.5, -0.25);
      const crownTop = new THREE.Mesh(new THREE.SphereGeometry(0.58, 12, 12), foliageMat2);
      crownTop.position.set(-2.1, 2.45, 0);

      stat.add(
        basePad, mast, nacelle, nacelleCap,
        trackerPost, solarPanel, solarBack,
        planterBase, planterRim, trunk, crown1, crown2, crown3, crownTop,
      );
      this.centerStatic[4] = new Instanced(stat, SCENERY_POOL_LIMITS.staticPerCenter, scene, { name: 'c4-stat' });

      // Contoured 3-Blade Wind Turbine Rotor
      const kin = new THREE.Group();
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 16), ecoTowerSkin);
      spinner.rotation.x = Math.PI / 2;
      spinner.position.z = 0.65;
      const hubRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.06, 8, 20), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
      hubRing.position.z = 0.35;
      kin.add(spinner, hubRing);
      for (let i = 0; i < 3; i++) {
        const ang = (i * Math.PI * 2) / 3;
        const rootCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.7, 10), silverMat);
        rootCyl.rotation.z = ang;
        rootCyl.translateY(0.55);
        rootCyl.position.z = 0.35;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.75, 0.07), whiteMat);
        blade.rotation.z = ang;
        blade.translateY(1.75);
        blade.position.z = 0.35;
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.55, 0.08), new THREE.MeshBasicMaterial({ color: 0x10b981 }));
        tip.rotation.z = ang;
        tip.translateY(3.15);
        tip.position.z = 0.35;
        kin.add(rootCyl, blade, tip);
      }
      this.centerKinetic[4] = new Instanced(kin, SCENERY_POOL_LIMITS.kineticPerCenter, scene, { name: 'c4-kin' });

      // Multi-puff Cumulus Sky Clouds
      const over = new THREE.Group();
      const c1 = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 14), whiteMat);
      const c2 = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 14), whiteMat);
      c2.position.set(1.15, -0.15, 0.2);
      const c3 = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 14), whiteMat);
      c3.position.set(-1.05, -0.2, -0.15);
      const c4 = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 12), whiteMat);
      c4.position.set(0.35, 0.45, -0.4);
      over.add(c1, c2, c3, c4);
      this.centerOverhead[4] = new Instanced(over, SCENERY_POOL_LIMITS.overheadPerCenter, scene, { name: 'c4-over' });
    }

    // ========================================================================
    // #5 DIGITAL 5G & AI (ชั้น 1): 5G Massive-MIMO Sector Tower + Detailed Server Rack Monolith
    // ========================================================================
    {
      const telecomSkin = new THREE.MeshPhongMaterial({
        map: architecturalTowerSkinTexture('#334155', '#c084fc', '#38bdf8'),
        shininess: 60,
      });
      const serverSkin = new THREE.MeshPhongMaterial({
        map: serverRackSkinTexture('#c084fc'),
        emissive: 0x2e1065,
        emissiveIntensity: 0.4,
        shininess: 90,
      });

      const stat = new THREE.Group();
      const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.95, 1.2, 12), darkMat);
      towerBase.position.y = 0.6;
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.58, 7.6, 12), telecomSkin);
      spire.position.y = 4.2;

      // Two maintenance catwalk platforms + 3 Massive-MIMO 5G sector antenna panels at 120 deg!
      for (const h of [3.8, 6.2]) {
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.14, 12), slateMat);
        deck.position.y = h;
        const neonRim = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
        neonRim.rotation.x = Math.PI / 2;
        neonRim.position.y = h;
        stat.add(deck, neonRim);

        for (let k = 0; k < 3; k++) {
          const a = (k * Math.PI * 2) / 3;
          const mimoPanel = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.35, 0.16), whiteMat);
          mimoPanel.position.set(Math.cos(a) * 0.92, h + 0.45, Math.sin(a) * 0.92);
          mimoPanel.rotation.y = -a + Math.PI / 2;
          const mimoStrip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.18), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
          mimoStrip.position.set(Math.cos(a) * 0.94, h + 0.45, Math.sin(a) * 0.94);
          mimoStrip.rotation.y = -a + Math.PI / 2;
          stat.add(mimoPanel, mimoStrip);
        }
      }
      // Microwave backhaul drum dish
      const mwDish = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.26, 16), whiteMat);
      mwDish.rotation.z = Math.PI / 2;
      mwDish.position.set(0.55, 5.0, 0);

      // High-density AI Server Rack Monolith with blade bay texture
      const serverPlinth = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.35, 1.75), slateMat);
      serverPlinth.position.set(2.15, 0.18, 0);
      const serverBox = new THREE.Mesh(new THREE.BoxGeometry(1.48, 4.1, 1.48), serverSkin);
      serverBox.position.set(2.15, 2.35, 0);
      const serverCap = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.24, 1.62), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      serverCap.position.set(2.15, 4.48, 0);

      stat.add(towerBase, spire, mwDish, serverPlinth, serverBox, serverCap);
      this.centerStatic[5] = new Instanced(stat, SCENERY_POOL_LIMITS.staticPerCenter, scene, { name: 'c5-stat' });

      // Rotating 5G mmWave Phased-Array Crown & Omni Whip Antenna at Tower Peak
      const kin = new THREE.Group();
      const crownHub = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.85, 14), telecomSkin);
      const whipMast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.08, 1.35, 10), silverMat);
      whipMast.position.y = 0.95;
      const beacon5G = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
      beacon5G.position.y = 1.65;
      const waveRing = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.055, 10, 28), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      waveRing.rotation.x = Math.PI / 2;
      kin.add(crownHub, whipMast, beacon5G, waveRing);
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.78, 0.14), whiteMat);
        panel.position.set(Math.cos(a) * 0.52, 0, Math.sin(a) * 0.52);
        panel.rotation.y = -a + Math.PI / 2;
        const ledBar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.68, 0.16), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
        ledBar.position.set(Math.cos(a) * 0.54, 0, Math.sin(a) * 0.54);
        ledBar.rotation.y = -a + Math.PI / 2;
        kin.add(panel, ledBar);
      }
      this.centerKinetic[5] = new Instanced(kin, SCENERY_POOL_LIMITS.kineticPerCenter, scene, { name: 'c5-kin' });

      // Low-Earth-Orbit 5G Communications Relay Satellite with Gridded Solar Wings & Downlink Dish
      const over = new THREE.Group();
      const satBody = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.05, 16), serverSkin);
      const satWings = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.07, 0.72), solarSkinMat);
      const satFrame = new THREE.Mesh(new THREE.BoxGeometry(3.28, 0.05, 0.78), silverMat);
      satFrame.position.y = -0.02;
      const downlinkDish = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.28, 18, 1, true), whiteMat);
      downlinkDish.position.y = -0.65;
      const dataRing = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.04, 8, 24), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
      dataRing.rotation.x = Math.PI / 2;
      dataRing.position.y = -0.82;
      over.add(satBody, satWings, satFrame, downlinkDish, dataRing);
      this.centerOverhead[5] = new Instanced(over, SCENERY_POOL_LIMITS.overheadPerCenter, scene, { name: 'c5-over' });
    }

    // ========================================================================
    // #3 RAIL & EV (ชั้น 1): Textured Maglev Station Pylon + EV Supercharger Kiosk + Hyperloop Tube Arch
    // ========================================================================
    {
      const maglevSkin = new THREE.MeshPhongMaterial({
        map: architecturalTowerSkinTexture('#1e293b', '#facc15', '#f59e0b'),
        shininess: 70,
      });

      const stat = new THREE.Group();
      const pylonBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 1.9), darkMat);
      pylonBase.position.y = 0.25;
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.95, 5.4, 1.55), maglevSkin);
      pylon.position.y = 3.0;
      const goldSpine = new THREE.Mesh(new THREE.BoxGeometry(0.32, 5.2, 1.68), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      goldSpine.position.set(0, 3.0, 0);
      // Aerodynamic cantilevered Maglev station roof canopy
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.8, 16, 1, false, 0, Math.PI), whiteMat);
      canopy.rotation.z = Math.PI / 2 + 0.18;
      canopy.position.set(-0.65, 5.35, 0);
      const canopyLight = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 2.4), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      canopyLight.position.set(-0.65, 5.25, 0);
      canopyLight.rotation.z = 0.18;

      // EV Ultra-Fast Supercharger Kiosk on side
      const kioskFrame = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.5, 0.45), whiteMat);
      kioskFrame.position.set(2.0, 1.25, 0);
      const kioskScreen = new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.45, 0.5), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      kioskScreen.position.set(2.0, 1.35, 0);
      const kioskTop = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.28, 0.52), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      kioskTop.position.set(2.0, 2.55, 0);

      stat.add(pylonBase, pylon, goldSpine, canopy, canopyLight, kioskFrame, kioskScreen, kioskTop);
      this.centerStatic[3] = new Instanced(stat, SCENERY_POOL_LIMITS.staticPerCenter, scene, { name: 'c3-stat' });

      const kin = new THREE.Group();
      const statorOuter = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.12, 12, 24), slateMat);
      const gyroGold = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.08, 10, 24), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      const gyroCyan = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.07, 10, 20), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      gyroCyan.rotation.x = Math.PI / 2;
      const fluxHub = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfef08a }));
      kin.add(statorOuter, gyroGold, gyroCyan, fluxHub);
      this.centerKinetic[3] = new Instanced(kin, SCENERY_POOL_LIMITS.kineticPerCenter, scene, { name: 'c3-kin' });

      // Double-Ribbed Hyperloop Vacuum Tube Arch spanning over track
      const over = new THREE.Group();
      const steelArch1 = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.18, 12, 36, Math.PI), slateMat);
      steelArch1.position.z = -0.35;
      const steelArch2 = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.18, 12, 36, Math.PI), slateMat);
      steelArch2.position.z = 0.35;
      const neonArch = new THREE.Mesh(new THREE.TorusGeometry(5.32, 0.12, 10, 36, Math.PI), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      const topCatenary = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 1.1), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      topCatenary.position.set(0, 5.5, 0);
      over.add(steelArch1, steelArch2, neonArch, topCatenary);
      this.centerOverhead[3] = new Instanced(over, SCENERY_POOL_LIMITS.overheadPerCenter, scene, { name: 'c3-over' });
    }

    // ========================================================================
    // #2 ROBOTICS (ชั้น 2-6): Textured 6-Axis Industrial Robot Arm + Hydraulic Pistons + CNC Gantry
    // ========================================================================
    {
      const robotSkin = new THREE.MeshPhongMaterial({
        map: architecturalTowerSkinTexture('#fb923c', '#facc15', '#0f172a'),
        shininess: 75,
      });

      const stat = new THREE.Group();
      // Heavy cast-iron rotary turret base
      const basePlate = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.4, 0.45, 16), darkMat);
      basePlate.position.y = 0.22;
      const rotaryTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.1, 0.95, 16), slateMat);
      rotaryTurret.position.y = 0.9;
      // Shoulder yoke + large horizontal servo motor drum
      const shoulderYoke = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.25, 1.05), robotSkin);
      shoulderYoke.position.y = 1.85;
      const servoDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 1.45, 16), darkMat);
      servoDrum.rotation.x = Math.PI / 2;
      servoDrum.position.set(0, 2.0, 0);
      const servoCap = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.55, 12), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      servoCap.rotation.x = Math.PI / 2;
      servoCap.position.set(0, 2.0, 0);
      // Twin contoured lower boom struts + hydraulic piston cylinder
      for (const zOff of [-0.28, 0.28]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.46, 3.3, 0.22), robotSkin);
        strut.position.set(0.15, 3.55, zOff);
        strut.rotation.z = -0.15;
        stat.add(strut);
      }
      const pistonCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.9, 12), slateMat);
      pistonCyl.position.set(-0.45, 2.6, 0);
      pistonCyl.rotation.z = -0.28;
      const pistonRod = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 10), silverMat);
      pistonRod.position.set(-0.22, 3.6, 0);
      pistonRod.rotation.z = -0.28;

      // Side Smart-Factory Workcell Pedestal
      const cellPed = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.75, 1.4, 12), slateMat);
      cellPed.position.set(-2.0, 0.7, 0);
      const holoGear = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.1, 8, 16), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      holoGear.rotation.x = Math.PI / 2;
      holoGear.position.set(-2.0, 1.55, 0);

      stat.add(basePlate, rotaryTurret, shoulderYoke, servoDrum, servoCap, pistonCyl, pistonRod, cellPed, holoGear);
      this.centerStatic[2] = new Instanced(stat, SCENERY_POOL_LIMITS.staticPerCenter, scene, { name: 'c2-stat' });

      // Articulated Robot Forearm + 3-Finger Precision Gripper + Laser Welder Tip
      const kin = new THREE.Group();
      const elbowDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.95, 16), darkMat);
      elbowDrum.rotation.x = Math.PI / 2;
      const elbowRing = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.02, 12), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      elbowRing.rotation.x = Math.PI / 2;
      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 2.6, 14), robotSkin);
      forearm.position.set(-0.62, 1.12, 0);
      forearm.rotation.z = 0.52;
      const wristMotor = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.45, 12), slateMat);
      wristMotor.position.set(-1.25, 2.15, 0);
      wristMotor.rotation.z = 0.52;
      const clawJaw = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.09, 10, 20, Math.PI * 1.45), silverMat);
      clawJaw.position.set(-1.52, 2.48, 0);
      const laserTip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      laserTip.position.set(-1.52, 2.48, 0);
      kin.add(elbowDrum, elbowRing, forearm, wristMotor, clawJaw, laserTip);
      this.centerKinetic[2] = new Instanced(kin, SCENERY_POOL_LIMITS.kineticPerCenter, scene, { name: 'c2-kin' });

      // Overhead CNC Laser Gantry Bridge
      const over = new THREE.Group();
      const mainBeam = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.42, 0.55), robotSkin);
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.16, 0.68), darkMat);
      topRail.position.y = 0.26;
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.65, 0.78), slateMat);
      const laserBar = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.1, 0.18), new THREE.MeshBasicMaterial({ color: 0xfb923c }));
      laserBar.position.y = -0.26;
      over.add(mainBeam, topRail, carriage, laserBar);
      this.centerOverhead[2] = new Instanced(over, SCENERY_POOL_LIMITS.overheadPerCenter, scene, { name: 'c2-over' });
    }

    // ========================================================================
    // #6 WEATHER RADAR (ชั้น 8): Observatory Tower + Solid-Core Geodesic Radome + Parabolic Dish
    // ========================================================================
    {
      const radarTowerSkin = new THREE.MeshPhongMaterial({
        map: architecturalTowerSkinTexture('#f8fafc', '#2dd4bf', '#0d9488'),
        shininess: 60,
      });

      const stat = new THREE.Group();
      const towerFoot = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.6, 16), slateMat);
      towerFoot.position.y = 0.3;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.08, 4.4, 16), radarTowerSkin);
      tower.position.y = 2.5;
      const obsDeck = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.9, 0.42, 16), darkMat);
      obsDeck.position.y = 4.7;
      const deckRim = new THREE.Mesh(new THREE.TorusGeometry(1.26, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
      deckRim.rotation.x = Math.PI / 2;
      deckRim.position.y = 4.85;

      // Secondary Doppler Radome Observatory (Solid white fiberglass radome sphere + structural collar & lightning arrestor)
      const radomePed = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 1.2, 16), radarTowerSkin);
      radomePed.position.set(2.2, 0.6, 0);
      const radomeCollar = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.07, 10, 24), slateMat);
      radomeCollar.rotation.x = Math.PI / 2;
      radomeCollar.position.set(2.2, 1.22, 0);
      const radomeCore = new THREE.Mesh(new THREE.SphereGeometry(1.28, 24, 20), whiteMat);
      radomeCore.position.set(2.2, 2.2, 0);
      const radomeBand = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.04, 8, 28), new THREE.MeshBasicMaterial({ color: 0x0d9488 }));
      radomeBand.rotation.x = Math.PI / 2;
      radomeBand.position.set(2.2, 2.2, 0);
      const arrestor = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.65, 8), silverMat);
      arrestor.position.set(2.2, 3.65, 0);

      stat.add(towerFoot, tower, obsDeck, deckRim, radomePed, radomeCollar, radomeCore, radomeBand, arrestor);
      this.centerStatic[6] = new Instanced(stat, SCENERY_POOL_LIMITS.staticPerCenter, scene, { name: 'c6-stat' });

      // Parabolic Doppler Radar Dish with Yoke Mount & 3 Tripod Feedhorn Struts
      const kin = new THREE.Group();
      const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.55, 12), slateMat);
      yoke.position.y = -0.2;
      const dishBacking = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.35, 14), slateMat);
      dishBacking.rotation.z = Math.PI / 3;
      dishBacking.position.set(-0.15, 0.05, 0);
      const dish = new THREE.Mesh(
        new THREE.ConeGeometry(1.48, 0.72, 24, 1, true),
        new THREE.MeshPhongMaterial({ color: 0xf8fafc, side: THREE.DoubleSide, shininess: 70 }),
      );
      dish.rotation.z = Math.PI / 3;
      const dishRim = new THREE.Mesh(new THREE.TorusGeometry(1.46, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
      dishRim.rotation.y = Math.PI / 2;
      dishRim.rotation.x = Math.PI / 6;
      dishRim.position.set(0.3, 0.18, 0);
      // Tripod feedhorn + LNB focal pod
      const feedHorn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 1.15, 10), slateMat);
      feedHorn.rotation.z = -Math.PI / 6;
      feedHorn.position.set(0.48, 0.28, 0);
      const lnbPod = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
      lnbPod.position.set(0.92, 0.54, 0);
      const scanWave = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.04, 8, 28), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
      scanWave.rotation.x = Math.PI / 2;
      kin.add(yoke, dishBacking, dish, dishRim, feedHorn, lnbPod, scanWave);
      this.centerKinetic[6] = new Instanced(kin, SCENERY_POOL_LIMITS.kineticPerCenter, scene, { name: 'c6-kin' });

      // Storm Cloud + Suspended Weather Sonde Instrument Pod
      const over = new THREE.Group();
      const cl1 = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 14), whiteMat);
      const cl2 = new THREE.Mesh(new THREE.SphereGeometry(0.98, 14, 14), whiteMat);
      cl2.position.set(1.15, -0.1, 0.15);
      const cl3 = new THREE.Mesh(new THREE.SphereGeometry(0.88, 14, 14), silverMat);
      cl3.position.set(-1.0, -0.18, -0.1);
      const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6), silverMat);
      tether.position.set(0.2, -1.2, 0);
      const sondePod = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.12, 0.38, 10), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
      sondePod.position.set(0.2, -1.95, 0);
      over.add(cl1, cl2, cl3, tether, sondePod);
      this.centerOverhead[6] = new Instanced(over, SCENERY_POOL_LIMITS.overheadPerCenter, scene, { name: 'c6-over' });
    }

    // ========================================================================
    // #7 BIO-MATERIALS (ชั้น 8): Textured Photobioreactor Vessel + Piping + 3D Double-Helix DNA
    // ========================================================================
    {
      const bioTankSkin = new THREE.MeshPhongMaterial({
        map: bioreactorSkinTexture('#4ade80'),
        emissive: 0x15803d,
        emissiveIntensity: 0.45,
        shininess: 95,
      });

      const stat = new THREE.Group();
      // Main DNA Display Pedestal & Crown Manifold
      const dnaBase = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.85, 16), slateMat);
      dnaBase.position.y = 0.42;
      const dnaBaseRim = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.06, 8, 24), new THREE.MeshBasicMaterial({ color: 0xa3e635 }));
      dnaBaseRim.rotation.x = Math.PI / 2;
      dnaBaseRim.position.y = 0.85;
      const dnaCap = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.48, 16), slateMat);
      dnaCap.position.y = 6.95;

      // Detailed Photobioreactor Vessel on Side with Stainless Manifolds & External Piping
      const reactorBase = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.9, 0.75, 16), silverMat);
      reactorBase.position.set(2.15, 0.38, 0);
      const glassVessel = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 5.2, 20), bioTankSkin);
      glassVessel.position.set(2.15, 3.3, 0);
      const reactorDome = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), silverMat);
      reactorDome.position.set(2.15, 5.9, 0);
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 5.4, 8), silverMat);
        pipe.position.set(2.15 + Math.cos(a) * 0.78, 3.3, Math.sin(a) * 0.78);
        stat.add(pipe);
      }

      stat.add(dnaBase, dnaBaseRim, dnaCap, reactorBase, glassVessel, reactorDome);
      this.centerStatic[7] = new Instanced(stat, SCENERY_POOL_LIMITS.staticPerCenter, scene, { name: 'c7-stat' });

      // Rich 3D Double-Helix DNA with Two-Tone Base Pairs & Continuous Sugar-Phosphate Backbones
      const kin = new THREE.Group();
      const limeMat = new THREE.MeshPhongMaterial({ color: 0xa3e635, emissive: 0x3f6212, shininess: 90 });
      const tealMat = new THREE.MeshPhongMaterial({ color: 0x2dd4bf, emissive: 0x115e59, shininess: 90 });
      const levels = 9;
      for (let i = 0; i < levels; i++) {
        const y = -2.3 + i * 0.58;
        const ang = i * 0.68;
        const r = 0.88;
        const x1 = Math.cos(ang) * r;
        const z1 = Math.sin(ang) * r;

        const node1 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), limeMat);
        node1.position.set(x1, y, z1);
        const node2 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), tealMat);
        node2.position.set(-x1, y, -z1);

        // Two-color cylindrical hydrogen-bond base pair rungs
        const halfRung1 = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, r, 8), limeMat);
        halfRung1.rotation.z = Math.PI / 2;
        halfRung1.position.set(x1 * 0.5, y, z1 * 0.5);
        halfRung1.rotation.y = -ang;

        const halfRung2 = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, r, 8), tealMat);
        halfRung2.rotation.z = Math.PI / 2;
        halfRung2.position.set(-x1 * 0.5, y, -z1 * 0.5);
        halfRung2.rotation.y = -ang;

        kin.add(node1, node2, halfRung1, halfRung2);
      }
      this.centerKinetic[7] = new Instanced(kin, SCENERY_POOL_LIMITS.kineticPerCenter, scene, { name: 'c7-kin' });

      // 3D Hexagonal Molecular Ring with Atomic Spheres
      const over = new THREE.Group();
      const hexRing = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.07, 10, 6), silverMat);
      over.add(hexRing);
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        const atom = new THREE.Mesh(
          new THREE.SphereGeometry(0.24, 12, 12),
          k % 2 === 0 ? limeMat : tealMat,
        );
        atom.position.set(Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0);
        over.add(atom);
      }
      this.centerOverhead[7] = new Instanced(over, SCENERY_POOL_LIMITS.overheadPerCenter, scene, { name: 'c7-over' });
    }

    // ========================================================================
    // #8 MEDICAL TECH (ชั้น 9): Textured Med-Tech MRI Pavilion + Vital Kiosk + Beveled 3D Medical Cross
    // ========================================================================
    {
      const medTowerSkin = new THREE.MeshPhongMaterial({
        map: architecturalTowerSkinTexture('#f8fafc', '#fb7185', '#e11d48'),
        shininess: 80,
      });
      const roseChromeMat = new THREE.MeshPhongMaterial({
        color: 0xfb7185,
        emissive: 0x881337,
        emissiveIntensity: 0.4,
        shininess: 100,
      });

      const stat = new THREE.Group();
      const baseStep = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 0.5, 16), whiteMat);
      baseStep.position.y = 0.25;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.82, 3.8, 16), medTowerSkin);
      col.position.y = 2.15;
      const capCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.72, 0.45, 16), whiteMat);
      capCollar.position.y = 4.1;
      const trim = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.07, 10, 24), roseChromeMat);
      trim.rotation.x = Math.PI / 2;
      trim.position.y = 4.25;

      // Side Bio-Scanner / ECG Telemetry Kiosk
      const kioskStand = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.1, 12), silverMat);
      kioskStand.position.set(2.1, 0.55, 0);
      const ecgMonolith = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.8, 1.15), medTowerSkin);
      ecgMonolith.position.set(2.1, 2.8, 0);
      const ecgRing = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.08, 10, 24), roseChromeMat);
      ecgRing.rotation.y = Math.PI / 2;
      ecgRing.position.set(1.75, 2.8, 0);

      stat.add(baseStep, col, capCollar, trim, kioskStand, ecgMonolith, ecgRing);
      this.centerStatic[8] = new Instanced(stat, SCENERY_POOL_LIMITS.staticPerCenter, scene, { name: 'c8-stat' });

      // Beveled Multi-Layered 3D Medical Cross with Chrome Trim & Gyro Rings
      const kin = new THREE.Group();
      const outerV = new THREE.Mesh(new THREE.BoxGeometry(0.68, 2.0, 0.36), whiteMat);
      const outerH = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.68, 0.36), whiteMat);
      const innerV = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.82, 0.48), roseChromeMat);
      const innerH = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.52, 0.48), roseChromeMat);
      const centerGem = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.54, 16), new THREE.MeshBasicMaterial({ color: 0xffe4e6 }));
      centerGem.rotation.x = Math.PI / 2;
      const haloRing1 = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.07, 10, 28), whiteMat);
      const haloRing2 = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.045, 8, 28), roseChromeMat);
      haloRing2.rotation.y = Math.PI / 3;
      kin.add(outerV, outerH, innerV, innerH, centerGem, haloRing1, haloRing2);
      this.centerKinetic[8] = new Instanced(kin, SCENERY_POOL_LIMITS.kineticPerCenter, scene, { name: 'c8-kin' });

      const over = new THREE.Group();
      const archWhite = new THREE.Mesh(new THREE.TorusGeometry(5.35, 0.16, 10, 32, Math.PI), whiteMat);
      const archRose = new THREE.Mesh(new THREE.TorusGeometry(5.15, 0.1, 10, 32, Math.PI), roseChromeMat);
      over.add(archWhite, archRose);
      this.centerOverhead[8] = new Instanced(over, SCENERY_POOL_LIMITS.overheadPerCenter, scene, { name: 'c8-over' });
    }

    // ========================================================================
    // #9 SPACE INSTITUTE (ชั้น 10): Multi-Stage Rocket w/ Strap-On SRBs + Umbilical Tower + Gridded CubeSat
    // ========================================================================
    {
      const rocketSkin = new THREE.MeshPhongMaterial({
        map: rocketHullSkinTexture('#f472b6'),
        shininess: 75,
      });
      const goldFoilMat = new THREE.MeshPhongMaterial({
        color: 0xfacc15,
        emissive: 0x854d0e,
        emissiveIntensity: 0.35,
        shininess: 110,
      });

      const stat = new THREE.Group();
      // Launch Pad Flame Trench Pedestal
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.85, 0.75, 16), slateMat);
      pad.position.y = 0.38;
      // Core Orbital Rocket Stage with roll-pattern skin
      const coreStage = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.64, 5.8, 20), rocketSkin);
      coreStage.position.y = 3.85;
      const interstage = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.58, 0.65, 20), darkMat);
      interstage.position.y = 6.9;
      // Payload Fairing + Escape Tower Nose Cone
      const fairing = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.62, 1.1, 20), whiteMat);
      fairing.position.y = 7.7;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.65, 20), new THREE.MeshPhongMaterial({ color: 0xf472b6, shininess: 85 }));
      nose.position.y = 9.05;
      const escapeRod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 0.9, 8), whiteMat);
      escapeRod.position.y = 10.1;
      // Main Engine Bell Cluster
      const mainBell = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.7, 16), darkMat);
      mainBell.position.y = 0.85;

      // Two Strap-On Solid Rocket Boosters (SRBs) with Nose Cones & Exhaust Bells!
      for (const zSide of [-0.82, 0.82]) {
        const srbBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 4.1, 14), rocketSkin);
        srbBody.position.set(0, 2.95, zSide);
        const srbNose = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.75, 14), new THREE.MeshPhongMaterial({ color: 0xf472b6, shininess: 80 }));
        srbNose.position.set(0, 5.35, zSide);
        const srbBell = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 12), darkMat);
        srbBell.position.set(0, 0.8, zSide);
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.45), slateMat);
        strut.position.set(0, 4.2, zSide * 0.55);
        stat.add(srbBody, srbNose, srbBell, strut);
      }

      // Steel Launch Umbilical Tower with Crew Access Swing Arms
      const gantrySkin = new THREE.MeshPhongMaterial({
        map: architecturalTowerSkinTexture('#334155', '#38bdf8', '#f472b6'),
        shininess: 65,
      });
      const gantryMast = new THREE.Mesh(new THREE.BoxGeometry(0.82, 8.6, 0.82), gantrySkin);
      gantryMast.position.set(1.85, 4.4, 0);
      for (const armY of [3.2, 5.6, 7.6]) {
        const deckCollar = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.18, 1.02), silverMat);
        deckCollar.position.set(1.85, armY, 0);
        const swingArm = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.24, 0.32), new THREE.MeshPhongMaterial({ color: 0x38bdf8 }));
        swingArm.position.set(1.1, armY, 0);
        stat.add(deckCollar, swingArm);
      }

      stat.add(pad, coreStage, interstage, fairing, nose, escapeRod, mainBell, gantryMast);
      this.centerStatic[9] = new Instanced(stat, SCENERY_POOL_LIMITS.staticPerCenter, scene, { name: 'c9-stat' });

      // Orbiting Deep-Space CubeSat with Gold Mylar Foil, Comms Dish & Gridded Solar Wings
      const kin = new THREE.Group();
      const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.045, 8, 32), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      orbitRing.rotation.x = Math.PI / 2.25;
      const satBus = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.52), goldFoilMat);
      satBus.position.set(1.85, 0, 0);
      const satDish = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.18, 12, 1, true), whiteMat);
      satDish.rotation.x = Math.PI / 2;
      satDish.position.set(1.85, 0.34, 0);
      const satWings = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 0.48), solarSkinMat);
      satWings.position.set(1.85, 0, 0);
      const satFrame = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.04, 0.52), silverMat);
      satFrame.position.set(1.85, -0.02, 0);
      kin.add(orbitRing, satBus, satDish, satWings, satFrame);
      this.centerKinetic[9] = new Instanced(kin, SCENERY_POOL_LIMITS.kineticPerCenter, scene, { name: 'c9-kin' });

      // Rotating Toroidal Orbital Space Station with Radial Spokes
      const over = new THREE.Group();
      const habWheel = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.22, 12, 28), whiteMat);
      habWheel.rotation.x = Math.PI / 2.8;
      const neonTrim = new THREE.Mesh(new THREE.TorusGeometry(1.92, 0.06, 8, 28), new THREE.MeshBasicMaterial({ color: 0xf472b6 }));
      neonTrim.rotation.x = Math.PI / 2.8;
      const coreHub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.3, 14), goldFoilMat);
      coreHub.rotation.x = Math.PI / 2.8 - Math.PI / 2;
      const spoke1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.6, 8), silverMat);
      spoke1.rotation.z = Math.PI / 2;
      over.add(habWheel, neonTrim, coreHub, spoke1);
      this.centerOverhead[9] = new Instanced(over, SCENERY_POOL_LIMITS.overheadPerCenter, scene, { name: 'c9-over' });
    }
  }

  /**
   * Large Holographic Billboards displaying each of the 9 TechnoPark Research Centers along the track!
   * Wrapped in a `THREE.Group` with twin support pillars, base pads, and 3D backing frame so `Instanced`
   * preserves the elevated screen height (`y = 3.8m`) and never sinks into the sidewalk.
   */
  private buildCenterBillboards(scene: THREE.Scene) {
    const pillarMat = new THREE.MeshPhongMaterial({ color: 0x334155, shininess: 60 });
    const frameMat = new THREE.MeshPhongMaterial({ color: 0x0f172a, shininess: 80 });

    for (const meta of CENTER_LIST) {
      const grp = new THREE.Group();
      grp.name = 'billboard-' + meta.id;
      const neonMat = new THREE.MeshBasicMaterial({ color: meta.color });

      // Twin support pillars + glowing ground base pads
      for (const sx of [-2.1, 2.1]) {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 0.24, 12), neonMat);
        pad.position.set(sx, 0.12, -0.14);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 3.6, 12), pillarMat);
        leg.position.set(sx, 1.8, -0.14);
        grp.add(pad, leg);
      }

      // 3D dark steel backing cabinet + top/bottom neon light bars
      const cabinet = new THREE.Mesh(new THREE.BoxGeometry(5.85, 3.0, 0.18), frameMat);
      cabinet.position.set(0, 3.6, -0.11);
      const topBar = new THREE.Mesh(new THREE.BoxGeometry(5.95, 0.14, 0.26), neonMat);
      topBar.position.set(0, 5.12, -0.08);
      const botBar = new THREE.Mesh(new THREE.BoxGeometry(5.95, 0.12, 0.26), neonMat);
      botBar.position.set(0, 2.08, -0.08);

      // High-contrast double-sided holographic display screen
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(5.6, 2.8),
        new THREE.MeshBasicMaterial({ map: centerBillboardTexture(meta.id), side: THREE.DoubleSide }),
      );
      screen.position.set(0, 3.6, 0.01);

      grp.add(cabinet, topBar, botBar, screen);
      this.centerBillboards[meta.id] = new Instanced(grp, SCENERY_POOL_LIMITS.billboardsPerCenter, scene, { name: 'bb-' + meta.id });
    }
  }

  private buildGhostPackPool(core: GLTF, scene: THREE.Scene) {
    const ringGeo = new THREE.RingGeometry(0.38, 0.56, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const runClip = core.animations.find((c) => c.name === 'run') || core.animations[0];

    for (let i = 0; i < 10; i++) {
      const group = new THREE.Group();
      group.visible = false;

      const charClone = cloneSkinned(this.player.model);
      charClone.rotation.set(0, Math.PI, 0);
      charClone.scale.set(0.92, 0.92, 0.92);
      const mixer = new THREE.AnimationMixer(charClone);
      if (runClip) {
        const act = mixer.clipAction(runClip);
        act.timeScale = 1.15;
        act.play();
        mixer.update(i * 0.23);
      }

      const attachments = createCenterAttachments();
      for (const grp of Object.values(attachments)) {
        group.add(grp);
      }

      const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.04;

      const spriteMat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
      const badge = new THREE.Sprite(spriteMat);
      badge.scale.set(1.45, 0.36, 1);
      badge.position.set(0, 2.05, 0);

      group.add(charClone, ring, badge);
      scene.add(group);
      this.ghostSlots.push({
        group,
        runnerId: '',
        charClone,
        avatar: 'non',
        mixer,
        attachments,
        activeCenter: null,
        wasStumbling: false,
        ring,
        badge,
        badgeKey: '',
        x: laneX(i % 3),
        y: 0,
        z: -4 - i * 3,
      });
    }
  }

  private buildGround() {
    const s = this.scene;
    const z = -GROUND_LEN / 2 + 30;
    const track = trackTexture();
    track.repeat.set(3, GROUND_LEN / LANE_W);
    this.trackMat = new THREE.MeshLambertMaterial({ map: track, color: 0xbae6fd });
    const trackMesh = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W * 3, GROUND_LEN), this.trackMat);
    trackMesh.rotation.x = -Math.PI / 2;
    trackMesh.position.set(0, 0, z);
    trackMesh.receiveShadow = true;
    s.add(trackMesh);

    const edge = trackTexture();
    edge.repeat.set(0.3, GROUND_LEN / LANE_W);
    edge.offset.x = 0.35;
    for (const side of [-1, 1]) {
      const w = SIDEWALK_IN - LANE_W * 1.5;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, GROUND_LEN), this.trackMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(side * (LANE_W * 1.5 + w / 2), 0, z);
      m.receiveShadow = true;
      s.add(m);
    }

    const pave = pavingTexture();
    pave.repeat.set(2, GROUND_LEN / 1.75);
    this.paveMat = new THREE.MeshLambertMaterial({ map: pave, color: 0x94a3b8 });
    this.curbMat = new THREE.MeshLambertMaterial({ color: 0x38bdf8, emissive: 0x0284c7 });
    for (const side of [-1, 1]) {
      const w = SIDEWALK_OUT - SIDEWALK_IN;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, GROUND_LEN), this.paveMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(side * (SIDEWALK_IN + w / 2), 0.25, z);
      m.receiveShadow = true;
      s.add(m);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, GROUND_LEN), this.curbMat);
      curb.position.set(side * (SIDEWALK_IN - 0.1), 0.14, z);
      curb.receiveShadow = true;
      s.add(curb);
    }

    const grass = groundTexture();
    grass.repeat.set(24, GROUND_LEN / 5);
    this.groundMat = new THREE.MeshLambertMaterial({ map: grass, color: 0x1e3a5f });
    const g = new THREE.Mesh(new THREE.PlaneGeometry(220, GROUND_LEN), this.groundMat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(0, -0.02, z);
    g.receiveShadow = true;
    s.add(g);

    this.scrollTex = [track, edge, pave, grass];
  }

  addScenery(_gltf: GLTF) {}
  warmScenery(_renderer: THREE.WebGLRenderer) {}

  get hasScenery() {
    return true;
  }

  resize(w: number, h: number) {
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  event(ev: SimEvent) {
    const fx = this.fx;
    switch (ev.type) {
      case 'coin':
        fx.burst(ev.x, ev.y, 0, 5, 0xffd75a, { speed: 2.4, up: 1.5, size: 0.4, life: 0.35, grav: 3 });
        break;
      case 'centerPower':
        fx.burst(ev.x, ev.y + 0.8, 0, 28, CENTERS[ev.centerId].color, { speed: 5.5, up: 2.2, size: 0.6, life: 0.65, grav: 2 });
        this.flash = 0.3;
        break;
      case 'centerStageChange':
        fx.burst(this.player.root.position.x, this.player.root.position.y + 1.2, -2, 32, CENTERS[ev.centerId].color, {
          speed: 6.5, up: 2.8, size: 0.65, life: 0.75, grav: 1.5,
        });
        break;
      case 'armorSmash':
        this.shake = 0.3;
        fx.burst(ev.x, ev.y + 1, -1.2, 24, 0xfacc15, { speed: 6, up: 2.4, size: 0.55, life: 0.5, grav: 4 });
        break;
      case 'shieldBlock':
        this.shake = 0.22;
        fx.burst(ev.x, ev.y + 1, -0.5, 20, 0x4ade80, { speed: 4.5, up: 1.8, size: 0.5, life: 0.45, grav: 2 });
        break;
      case 'land':
        if (ev.fall > 0.6) fx.burst(this.player.root.position.x, this.player.root.position.y + 0.1, 0.2, 6, 0x38bdf8, { speed: 2, up: 0.6, size: 0.5, life: 0.4, grav: 1 });
        break;
      case 'stumble':
      case 'hit':
        this.shake = 0.38;
        fx.burst(ev.x, ev.y + 1, -0.3, 14, 0xfb7185, { speed: 3.8, up: 1.2, size: 0.4, life: 0.4 });
        break;
      case 'bump':
        this.shake = 0.15;
        break;
    }
  }

  sync(sim: Sim, dt: number, menu: boolean, ghosts: RunnerNetState[] = [], localPlayerId = '', tvMode = false) {
    this.time += dt;
    const pd = sim.d;
    const zOf = (d: number) => -(d - pd);

    // 9-Center Open-Horizon Biome Atmosphere!
    const biome = lerpCenterBiome(menu ? 0 : sim.progress01);
    const activeAccentHex = sim.activeCenter ? CENTERS[sim.activeCenter].color : biome.neonHex;

    this.skyMat.uniforms.uSkyTop.value.set(biome.skyTopHex);
    this.skyMat.uniforms.uSkyMid.value.set(biome.skyMidHex);
    this.skyMat.uniforms.uSkyHorizon.value.set(biome.skyHorizonHex);
    this.skyMat.uniforms.uStarIntensity.value = biome.starIntensity;
    this.skyMat.uniforms.uTime.value = this.time;

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.set(biome.fogHex);
    }
    this.sun.color.set(biome.sunHex);
    this.hemi.color.set(biome.skyHorizonHex);
    this.hemi.groundColor.set(biome.groundTintHex);

    // Horizon Celestial Sun / Ringed Planet
    this.horizonSunMat.color.set(biome.sunHex);
    this.horizonGroup.scale.setScalar(biome.sunScale);
    this.horizonRing.visible = biome.hasPlanetRings;
    this.horizonRingMat.color.set(biome.neonHex);
    this.horizonRing.rotation.z = this.time * 0.25;

    // Ground, Sidewalk & Track Biome Tinting
    this.groundMat.color.set(biome.groundTintHex);
    this.paveMat.color.set(biome.groundTintHex).lerp(new THREE.Color(0xffffff), 0.38);
    this.trackMat.color.set(biome.trackTintHex);
    this.curbMat.color.set(activeAccentHex);
    this.curbMat.emissive.set(activeAccentHex).multiplyScalar(0.45);

    // scrolling ground
    for (const t of this.scrollTex) t.offset.y = (pd / (GROUND_LEN / t.repeat.y)) % 1;

    // obstacles
    for (const k in this.pools) this.pools[k].begin();
    const movers: Ob[] = [];
    for (const o of sim.obs) {
      if (o.d0 > pd + VIEW_AHEAD || o.d1 < pd - 12) continue;
      const x = laneX(o.lane);
      if (o.kind === 'train' || o.kind === 'mtrain') {
        for (let c = 0; c < o.cars; c++) {
          const dc = o.d0 + c * (CAR_LEN + CAR_GAP) + CAR_LEN / 2;
          m4.makeTranslation(x, 0, zOf(dc));
          this.pools.train.add(m4, TRAIN_TINTS[o.variant % 3]);
        }
        if (o.kind === 'mtrain') movers.push(o);
      } else {
        m4.makeTranslation(x, 0, zOf((o.d0 + o.d1) / 2));
        this.pools[o.kind].add(m4);
      }
    }
    for (const k in this.pools) this.pools[k].end();

    // coins + glow
    this.coins.begin();
    this.halos.begin();
    q.setFromEuler(e.set(0, this.time * 3.2, 0));
    const camQ = this.camera.quaternion;
    const gold = new THREE.Color(1.0, 0.78, 0.25).multiplyScalar(0.6);
    for (const c of sim.coinList) {
      if (c.d > pd + VIEW_AHEAD - 20) continue;
      let overlapsPickup = false;
      for (const cp of sim.pickups) {
        if (cp.lane === c.lane && Math.abs(cp.d - c.d) < 1.8) {
          overlapsPickup = true;
          break;
        }
      }
      if (overlapsPickup) continue;

      const z = zOf(c.d);
      m4.compose(v.set(c.x, c.y, z), q, one);
      this.coins.add(m4);
      m4.compose(v.set(c.x, c.y, z + 0.05), camQ, sc.set(1.5, 1.5, 1.5));
      this.halos.add(m4, gold);
    }

    // 9 Center Pickup Capsules
    for (const meta of CENTER_LIST) this.centerCards[meta.id].begin();
    for (const cp of sim.pickups) {
      if (cp.d > pd + VIEW_AHEAD - 15) continue;
      const z = zOf(cp.d);
      const bob = Math.sin(this.time * 3.6 + cp.d) * 0.16;
      const x = laneX(cp.lane);
      m4.compose(v.set(x, cp.y + bob, z), camQ, sc.set(1.3, 1.3, 1.3));
      this.centerCards[cp.centerId].add(m4);
      m4.compose(v.set(x, cp.y + bob, z + 0.06), camQ, sc.set(3.2, 3.2, 3.2));
      this.halos.add(m4, CENTER_COLORS[cp.centerId]);
    }
    for (const meta of CENTER_LIST) this.centerCards[meta.id].end();

    // moving trains headlights
    for (const o of movers) {
      const x = laneX(o.lane);
      const z = zOf(o.d0) + 0.08;
      const blink = 0.75 + 0.25 * Math.sin(this.time * 14 + o.id);
      const far = Math.max(0, o.d0 - pd);
      const size = 1.6 + far * 0.035;
      for (const side of [-1, 1]) {
        const on = side < 0 ? blink : 1.75 - blink;
        m4.compose(v.set(x + side * 0.72, 0.95, z), camQ, sc.set(size, size, size));
        this.halos.add(m4, LIGHT.clone().multiplyScalar(on));
      }
      m4.compose(v.set(x, 2.9, z), camQ, sc.set(1.1, 1.1, 1.1));
      this.halos.add(m4, LIGHT_RED.clone().multiplyScalar(blink));
      const len = 18;
      m4.compose(v.set(x, 0.06, z + len / 2), FLAT, sc.set(2.2, len, 1));
      this.halos.add(m4, LIGHT.clone().multiplyScalar(0.35 + 0.15 * blink));
    }
    this.coins.end();
    this.halos.end();

    // 9-Center Open-Horizon Scenery: Portal Gates, Animated 3D Center Landmarks, Overhead Sky Elements & Billboards!
    this.syncNineCenterScenery(sim, pd, zOf);
    this.syncGhostPack(dt, menu && !tvMode, ghosts, localPlayerId, tvMode, sim.speed > 0.1);

    this.player.root.visible = !tvMode;
    if (menu && !tvMode) this.player.menu(dt);
    this.updateCamera(sim, dt, menu && !tvMode, tvMode);
    this.skyDome.position.copy(this.camera.position);

    const speedFactor = menu || !sim.alive ? 0 : Math.max(0, Math.min(1, (sim.speed - 14) / 12));
    this.fx.update(dt, this.camera, menu || !sim.alive ? 0 : sim.speed, speedFactor);

    // Center active particle trail
    if (!menu && sim.activeCenter !== null && Math.random() < dt * 32) {
      const col = CENTERS[sim.activeCenter].color;
      this.fx.burst(sim.x + (Math.random() - 0.5) * 0.5, sim.y + 0.4, 0.3, 1, col, {
        speed: 0.9, up: 0.5, size: 0.35, life: 0.4, grav: 0,
      });
    }
  }

  private syncNineCenterScenery(sim: Sim, pd: number, zOf: (d: number) => number) {
    const stageCenter: CenterId = sim.stageCenter || 1;
    const gates = stageGateDistances(sim.matchDuration);

    // Helper: which Center stage owns distance `d` along the track?
    const centerAtDist = (d: number): CenterId => {
      let cId: CenterId = STAGE_CENTER_ORDER[0];
      for (let i = 1; i < gates.length; i++) {
        if (d >= gates[i].d) cId = gates[i].centerId;
        else break;
      }
      return cId;
    };

    // 1. Center Portal Gates at each stage boundary
    for (const meta of CENTER_LIST) this.centerGates[meta.id].begin();
    for (const g of gates) {
      if (g.d > pd - 18 && g.d < pd + VIEW_AHEAD) {
        m4.makeTranslation(0, 0, zOf(g.d));
        this.centerGates[g.centerId].add(m4);
      }
    }
    for (const meta of CENTER_LIST) this.centerGates[meta.id].end();

    // 2. 9-Center Roadside Static + Animated Kinetic 3D Landmarks (every 18m on both sides, plus outer vista row!)
    for (const meta of CENTER_LIST) {
      this.centerStatic[meta.id].begin();
      this.centerKinetic[meta.id].begin();
      this.centerOverhead[meta.id].begin();
    }

    const firstSlot = Math.floor((pd - 16) / 18) * 18;
    for (let d = firstSlot; d < pd + VIEW_AHEAD - 8; d += 18) {
      const cId = centerAtDist(d);
      const z = zOf(d);
      const phase = d * 0.13;
      const slotNum = Math.abs(Math.floor(d / 18));

      for (const side of [-1, 1]) {
        const scaleVar = 0.94 + ((slotNum * 5 + (side > 0 ? 2 : 0)) % 4) * 0.045;
        const baseX = side * (SIDEWALK_IN + 2.35);
        const yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        q.setFromEuler(e.set(0, yaw, 0));
        m4.compose(v.set(baseX, 0.25, z), q, sc.set(scaleVar, scaleVar, scaleVar));
        this.centerStatic[cId].add(m4);

        // Animated Kinetic attachment per Center (scaled proportionally so it locks to the static structure)!
        switch (cId) {
          case 1: // Rotating Dual-Band Airport Surveillance Radar at tower roof
            q.setFromEuler(e.set(0, this.time * 3.8 + phase, 0));
            m4.compose(v.set(baseX, 0.25 + 9.48 * scaleVar, z), q, sc.set(scaleVar, scaleVar, scaleVar));
            break;
          case 4: // Spinning 3-blade Wind Turbine rotor at nacelle front
            q.setFromEuler(e.set(0, yaw, this.time * 2.6 * side + phase));
            m4.compose(v.set(baseX, 0.25 + 7.6 * scaleVar, z), q, sc.set(scaleVar, scaleVar, scaleVar));
            break;
          case 5: { // Pulsing 5G mmWave transceiver array
            const pulse = (0.85 + 0.28 * Math.sin(this.time * 4.0 + phase)) * scaleVar;
            q.setFromEuler(e.set(0, this.time * 2.2 + phase, 0));
            m4.compose(v.set(baseX, 0.25 + 8.1 * scaleVar, z), q, sc.set(pulse, pulse, pulse));
            break;
          }
          case 3: // Spinning Maglev flux stator rings
            q.setFromEuler(e.set(this.time * 2.0, this.time * 3.0 + phase, 0));
            m4.compose(v.set(baseX, 0.25 + 6.45 * scaleVar, z), q, sc.set(scaleVar, scaleVar, scaleVar));
            break;
          case 2: // Pivoting articulated robot forearm & laser claw
            q.setFromEuler(e.set(0, yaw, Math.sin(this.time * 2.8 + phase) * 0.52));
            m4.compose(v.set(baseX, 0.25 + 5.05 * scaleVar, z), q, sc.set(scaleVar, scaleVar, scaleVar));
            break;
          case 6: // Rotating Parabolic Doppler radar dish
            q.setFromEuler(e.set(0, this.time * 2.4 * side + phase, 0));
            m4.compose(v.set(baseX, 0.25 + 5.15 * scaleVar, z), q, sc.set(scaleVar, scaleVar, scaleVar));
            break;
          case 7: // Spinning Double-Helix DNA strand
            q.setFromEuler(e.set(0, this.time * 2.2 * side + phase, 0));
            m4.compose(v.set(baseX, 0.25 + 3.85 * scaleVar, z), q, sc.set(scaleVar, scaleVar, scaleVar));
            break;
          case 8: // Rotating Beveled 3D Medical Cross & Gyro-Rings
            q.setFromEuler(e.set(0, this.time * 2.0 + phase, Math.sin(this.time * 2 + phase) * 0.15));
            m4.compose(v.set(baseX, 0.25 + 5.55 * scaleVar, z), q, sc.set(scaleVar, scaleVar, scaleVar));
            break;
          case 9: // Orbiting Gold-Foil CubeSat revolving around Space Rocket
            q.setFromEuler(e.set(0, this.time * 2.8 * side + phase, 0));
            m4.compose(v.set(baseX, 0.25 + 4.8 * scaleVar, z), q, sc.set(scaleVar, scaleVar, scaleVar));
            break;
        }
        this.centerKinetic[cId].add(m4);

        // Outer open-horizon vista row at x = ±(14.5..16.5) every 36m for deep panoramic depth!
        if (slotNum % 2 === 0) {
          const vistaScale = 1.18 + (slotNum % 3) * 0.12;
          const vistaX = side * (14.6 + (slotNum % 3) * 1.1);
          q.setFromEuler(e.set(0, yaw + side * 0.18, 0));
          m4.compose(v.set(vistaX, 0, z - 6), q, sc.set(vistaScale, vistaScale, vistaScale));
          this.centerStatic[cId].add(m4);
        }
      }

      // 3. Overhead Sky Elements every 36m (flying jets, clouds, hyperloop arches, laser gantries, space rings)
      if (slotNum % 2 === 0) {
        if (cId === 1) {
          // Supersonic Jet Fighter squadron banking overhead!
          const flyX = Math.sin(this.time * 1.8 + phase) * 3.8;
          const flyY = 9.6 + Math.cos(this.time * 2.2 + phase) * 0.8;
          q.setFromEuler(e.set(0, 0, -Math.cos(this.time * 1.8 + phase) * 0.35));
          m4.compose(v.set(flyX, flyY, z), q, one);
          this.centerOverhead[1].add(m4);
        } else if (cId === 3 || cId === 2 || cId === 8) {
          // Spanning Hyperloop / Laser Gantry / Med-Tech Sky Arch over the track
          q.identity();
          m4.compose(v.set(0, cId === 2 ? 9.2 : 0.2, z), q, one);
          this.centerOverhead[cId].add(m4);
        } else {
          // Floating clouds (#4, #6), 5G data cubes (#5), bio molecules (#7), or orbital space stations (#9)
          for (const side of [-1, 1]) {
            const bobY = 9.8 + Math.sin(this.time * 1.6 + phase + side) * 0.6;
            q.setFromEuler(e.set(0, this.time * 0.8 * side + phase, 0));
            m4.compose(v.set(side * 5.2, bobY, z), q, one);
            this.centerOverhead[cId].add(m4);
          }
        }
      }
    }

    for (const meta of CENTER_LIST) {
      this.centerStatic[meta.id].end();
      this.centerKinetic[meta.id].end();
      this.centerOverhead[meta.id].end();
    }

    // 4. Holographic 9-Center Billboards with 3D support legs angled toward the runner every 36m
    for (const meta of CENTER_LIST) this.centerBillboards[meta.id].begin();
    const firstBB = Math.floor((pd - 18) / 36) * 36;
    let slotIdx = Math.max(0, Math.floor(firstBB / 36));
    for (let d = firstBB; d < pd + VIEW_AHEAD - 12; d += 36) {
      const side = slotIdx % 2 === 0 ? -1 : 1;
      const centerId: CenterId = sim.activeCenter || centerAtDist(d) || stageCenter;
      q.setFromEuler(e.set(0, side * -0.36, 0));
      m4.compose(v.set(side * (SIDEWALK_OUT + 0.5), 0.0, zOf(d) - 9), q, one);
      this.centerBillboards[centerId].add(m4);
      slotIdx++;
    }
    for (const meta of CENTER_LIST) this.centerBillboards[meta.id].end();
  }

  private syncGhostPack(
    dt: number,
    menu: boolean,
    ghosts: RunnerNetState[],
    localPlayerId: string,
    tvMode: boolean,
    isRunning = true,
  ) {
    const others = menu
      ? []
      : ghosts.filter((g) => tvMode || g.id !== localPlayerId).slice(0, this.ghostSlots.length);

    if (others.length === 0) {
      for (const slot of this.ghostSlots) {
        slot.group.visible = false;
        slot.runnerId = '';
      }
      return;
    }

    // Bind each active ghost runner stably by `g.id` so rank swaps never swap 3D character slots or rebuild avatars mid-race!
    const byId = new Map<string, RunnerNetState>();
    for (const g of others) byId.set(g.id, g);

    const assigned = new Set<string>();
    for (const slot of this.ghostSlots) {
      if (slot.runnerId && byId.has(slot.runnerId)) {
        assigned.add(slot.runnerId);
      } else {
        slot.runnerId = '';
      }
    }
    for (const g of others) {
      if (assigned.has(g.id)) continue;
      const freeSlot = this.ghostSlots.find((s) => !s.runnerId);
      if (freeSlot) {
        freeSlot.runnerId = g.id;
        freeSlot.x = g.x ?? laneX(g.lane);
        freeSlot.y = g.y ?? 0;
        freeSlot.z = -g.packOffsetZ - 2;
        assigned.add(g.id);
      }
    }

    for (let i = 0; i < this.ghostSlots.length; i++) {
      const slot = this.ghostSlots[i];
      const g = slot.runnerId ? byId.get(slot.runnerId) : undefined;
      if (!g) {
        slot.group.visible = false;
        continue;
      }
      slot.group.visible = true;
      const gAvatar = sanitizeAvatarId(g.avatar);
      if (slot.avatar !== gAvatar) {
        slot.avatar = gAvatar;
        applyAvatarToCharacter(slot.charClone, gAvatar);
      }
      slot.mixer.update(dt * (isRunning ? 1.0 : 0.65));
      updateAvatarMotion(slot.charClone, this.time + i * 0.37, true);

      // Crouch/tuck cleanly during slide without breaking root bone orientation
      if (isRunning && g.sliding) {
        slot.charClone.scale.set(0.96, 0.56, 0.96);
      } else {
        slot.charClone.scale.set(0.92, 0.92, 0.92);
      }

      let targetX: number;
      let targetZ: number;
      if (!isRunning) {
        // Starting Line Grid in LOBBY / COUNTDOWN: spread runners across 3 columns and rows so all are clearly visible!
        const gridCol = (i % 3) - 1;
        const gridRow = Math.floor(i / 3);
        const hasCustomLane = !g.isBot && (g.lane !== 1 || Math.abs(g.x) > 0.05);
        targetX = hasCustomLane ? (g.x || laneX(g.lane)) + gridCol * 0.25 : gridCol * 2.15;
        targetZ = -1.2 - gridRow * 2.4;
      } else {
        const spreadX = ((i % 3) - 1) * 0.32;
        const rankZ = -7.8 + (g.rank - 1) * 1.65;
        targetX = (g.x ?? laneX(g.lane)) + spreadX;
        targetZ = Math.max(-11.0, Math.min(-1.0, rankZ - g.packOffsetZ * 0.35));
      }
      const targetY = g.activeCenter === 1 ? Math.max(g.y ?? 0, 3.2 + Math.sin(this.time * 4 + i) * 0.2) : (g.y ?? 0);
      const k = Math.min(1, dt * 9);
      slot.x += (targetX - slot.x) * k;
      slot.y += (targetY - slot.y) * k;
      slot.z += (targetZ - slot.z) * k;
      slot.group.position.set(slot.x, slot.y, slot.z);

      // Update 3D 9-Center power-up attachments & particle bursts on TV
      updateCenterAttachments(slot.attachments, g.activeCenter, this.time + i * 0.4);
      if (slot.activeCenter !== g.activeCenter) {
        if (g.activeCenter !== null) {
          const pCol = CENTERS[g.activeCenter].color;
          this.fx.burst(slot.x, slot.y + 1.0, slot.z, 22, pCol, {
            speed: 4.6, up: 3.6, size: 0.55, life: 0.55,
          });
        }
        slot.activeCenter = g.activeCenter;
      }
      if (isRunning && g.activeCenter !== null && Math.random() < dt * 26) {
        const pCol = CENTERS[g.activeCenter].color;
        this.fx.burst(
          slot.x + (Math.random() - 0.5) * 0.45,
          slot.y + 0.45,
          slot.z + 0.4,
          1,
          pCol,
          { speed: 1.0, up: 0.5, size: 0.36, life: 0.4, grav: 0 },
        );
      }

      // Stumble / obstacle hit spark burst & shake on TV
      const isStumbling = !!g.stumbling;
      if (isStumbling && !slot.wasStumbling) {
        this.fx.burst(slot.x, slot.y + 0.9, slot.z, 20, 0xff4422, {
          speed: 5.0, up: 3.2, size: 0.52, life: 0.45,
        });
      }
      slot.wasStumbling = isStumbling;
      slot.charClone.rotation.set(0, Math.PI, isStumbling ? Math.sin(this.time * 30 + i) * 0.34 : 0);

      const col = g.activeCenter ? CENTERS[g.activeCenter].color : g.color;
      (slot.ring.material as THREE.MeshBasicMaterial).color.set(col);

      const badgeKey = `${g.rank}:${g.name}:${col}`;
      if (slot.badgeKey !== badgeKey) {
        slot.badgeKey = badgeKey;
        const sm = slot.badge.material as THREE.SpriteMaterial;
        sm.map = nameBadgeTexture(g.name, g.rank, col);
        sm.needsUpdate = true;
      }
    }
  }

  resetScenery() {
    this.player.reset();
  }

  private updateCamera(sim: Sim, dt: number, menu: boolean, tvMode = false) {
    const cam = this.camera;
    const portrait = Math.max(0, Math.min(1, (1.2 - this.aspect) / 0.72));
    if (menu) {
      const t = this.time * 0.15;
      const wide = this.aspect > 1.25;
      cam.position.set(Math.sin(t) * 0.8 + (wide ? -1.2 : 0), 1.7 + portrait * 0.5, -4.6 - portrait * 1.6);
      cam.fov = 50 + portrait * 16;
      cam.updateProjectionMatrix();
      cam.lookAt(wide ? -2.2 : 0, wide ? 0.95 : 0.25 - portrait * 0.35, 0);
      this.camY = 0;
      return;
    }
    const target = sim.grounded ? sim.y : Math.max(sim.groundY, Math.min(sim.y, this.camY + 1.4));
    this.camY += (target - this.camY) * Math.min(1, dt * 5);
    const dist = (tvMode ? 6.8 : 5.4) + portrait * 2.4;
    const height = (tvMode ? 5.6 : 2.75) + portrait * 1.5;
    const sx = tvMode ? sim.x * 0.35 : sim.x * 0.65;
    let ox = 0, oy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const a = this.shake * 0.5;
      ox = (Math.random() - 0.5) * a;
      oy = (Math.random() - 0.5) * a;
    }
    cam.position.set(sx + ox, this.camY + height + oy, dist);
    const speedFactor = Math.max(0, Math.min(1, (sim.speed - 12) / 15));
    const fov = (tvMode ? 62 : 58) + portrait * 17 + speedFactor * 10;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
    cam.lookAt(tvMode ? 0 : sim.x * 0.8, this.camY + (tvMode ? 1.65 : 1.25), tvMode ? -11 : -9);
  }

  takeFlash() {
    const f = this.flash;
    this.flash = 0;
    return f;
  }

  warm(renderer: THREE.WebGLRenderer) {
    const all = [
      ...Object.values(this.pools),
      this.coins,
      this.halos,
      ...Object.values(this.centerGates),
      ...Object.values(this.centerStatic),
      ...Object.values(this.centerKinetic),
      ...Object.values(this.centerOverhead),
      ...Object.values(this.centerCards),
      ...Object.values(this.centerBillboards),
    ];
    for (const p of all) {
      p.begin();
      m4.makeTranslation(0, 1, -6);
      p.add(m4, new THREE.Color(1, 1, 1));
      p.end();
    }
    this.fx.warm(this.camera);
    for (let id = 1 as CenterId; id <= 9; id = (id + 1) as CenterId) {
      if (this.player.attachments[id]) this.player.attachments[id].visible = true;
    }
    for (const a of Object.values(this.player.actions)) a.play();
    renderer.compile(this.scene, this.camera);
    renderer.render(this.scene, this.camera);
    for (const a of Object.values(this.player.actions)) a.stop();
    this.player.current = null;
    this.player.setCenterEffect(null, 0);
    for (const p of all) { p.begin(); p.end(); }
    this.fx.clear();
  }
}

function rampMesh() {
  const w = OB.ramp.halfW, L = OB.ramp.depth / 2, H = OB.ramp.yt;
  const p = [
    [-w, 0, L], [w, 0, L], [-w, 0, -L], [w, 0, -L], [-w, H, -L], [w, H, -L],
  ];
  const tris: number[][] = [
    [0, 1, 5], [0, 5, 4],
    [0, 4, 2],
    [1, 3, 5],
    [2, 4, 5], [2, 5, 3],
  ];
  const pos: number[] = [], uv: number[] = [];
  for (const t of tris) for (const i of t) {
    pos.push(...p[i]);
    uv.push((p[i][0] + w) / (2 * w), (L - p[i][2]) / (2 * L) * 3 + p[i][1] * 0.3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: rampTexture(), side: THREE.FrontSide }));
  m.name = 'ramp';
  return m;
}
