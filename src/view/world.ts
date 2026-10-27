// The three.js scene: 9-Center Open-Horizon Biomes, Dynamic Shader Sky Dome, Center Portal Gates, and Animated 3D Worlds.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Instanced } from './pools';
import { Fx } from './fx';
import { PlayerView } from './player';
import {
  trackTexture, pavingTexture, groundTexture, glowTexture,
  centerCapsuleTexture, centerBillboardTexture, centerGateBannerTexture,
  nameBadgeTexture, rampTexture, HORIZON, lerpCenterBiome,
} from './textures';
import {
  LANE_W, laneX, CAR_LEN, CAR_GAP, VIEW_AHEAD, OB, CENTERS, CENTER_LIST,
  STAGE_CENTER_ORDER, stageGateDistances,
} from '../config';
import type { Sim } from '../sim/sim';
import type { SimEvent, CenterId, Ob } from '../sim/types';
import type { RunnerNetState } from '../net';

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

interface GhostSlot {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
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
   * Builds 9 distinct, detailed 3D Worlds (Static Architecture + Animated Kinetic Mechanisms + Overhead Sky Elements)
   * so every single Center (#1..#9) transforms the open horizon!
   */
  private buildNineCenterWorlds(scene: THREE.Scene) {
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
    const silverMat = new THREE.MeshLambertMaterial({ color: 0xcbd5e1 });
    const slateMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x0f172a });

    // ========================================================================
    // #1 AVIATION (ชั้น 1): Air Traffic Control Tower + Hangar Arch + Jet Squadron
    // ========================================================================
    {
      const stat = new THREE.Group();
      const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.1, 4.2, 8), whiteMat);
      towerBase.position.y = 2.1;
      const towerShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 3.6, 8), silverMat);
      towerShaft.position.y = 5.8;
      const cabGlass = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 0.9, 1.3, 10), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      cabGlass.position.y = 8.1;
      const cabRoof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.6, 10), whiteMat);
      cabRoof.position.y = 9.0;
      const windsockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6), silverMat);
      windsockPole.position.set(1.8, 1.4, 0);
      const windsock = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.95, 8), new THREE.MeshBasicMaterial({ color: 0xf97316 }));
      windsock.rotation.z = Math.PI / 2;
      windsock.position.set(2.25, 2.6, 0);
      stat.add(towerBase, towerShaft, cabGlass, cabRoof, windsockPole, windsock);
      this.centerStatic[1] = new Instanced(stat, 24, scene, { name: 'c1-stat' });

      const kin = new THREE.Group();
      const radarBar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.28), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      beacon.position.y = 0.25;
      kin.add(radarBar, beacon);
      this.centerKinetic[1] = new Instanced(kin, 24, scene, { name: 'c1-kin' });

      const over = new THREE.Group();
      const fuselage = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.8, 8), whiteMat);
      fuselage.rotation.x = -Math.PI / 2;
      const wings = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.85), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      wings.position.z = 0.2;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.65, 0.55), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      tail.position.set(0, 0.32, 0.95);
      const burner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.75, 8), new THREE.MeshBasicMaterial({ color: 0xf97316 }));
      burner.rotation.x = Math.PI / 2;
      burner.position.z = 1.65;
      over.add(fuselage, wings, tail, burner);
      this.centerOverhead[1] = new Instanced(over, 16, scene, { name: 'c1-over' });
    }

    // ========================================================================
    // #4 CLEAN ENERGY (ชั้น 1): Giant Wind Turbine + Solar Array + Eco Tree Dome
    // ========================================================================
    {
      const stat = new THREE.Group();
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.38, 7.6, 12), whiteMat);
      mast.position.y = 3.8;
      const solarPanel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.6), new THREE.MeshBasicMaterial({ color: 0x0284c7 }));
      solarPanel.position.set(2.1, 1.4, 0);
      solarPanel.rotation.x = 0.45;
      const solarFrame = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.08, 1.75), silverMat);
      solarFrame.position.set(2.1, 1.36, 0);
      solarFrame.rotation.x = 0.45;
      const ecoTree = new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 1), new THREE.MeshLambertMaterial({ color: 0x22c55e }));
      ecoTree.position.set(-1.9, 1.3, 0);
      stat.add(mast, solarPanel, solarFrame, ecoTree);
      this.centerStatic[4] = new Instanced(stat, 24, scene, { name: 'c4-stat' });

      const kin = new THREE.Group();
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 10), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
      kin.add(hub);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.1, 0.08), whiteMat);
        blade.rotation.z = (i * Math.PI * 2) / 3;
        blade.translateY(1.55);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.55, 0.1), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
        tip.rotation.z = (i * Math.PI * 2) / 3;
        tip.translateY(2.85);
        kin.add(blade, tip);
      }
      this.centerKinetic[4] = new Instanced(kin, 24, scene, { name: 'c4-kin' });

      const over = new THREE.Group();
      const c1 = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 10), whiteMat);
      const c2 = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 10), whiteMat);
      c2.position.set(1.1, -0.15, 0);
      const c3 = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 10), whiteMat);
      c3.position.set(-1.0, -0.2, 0);
      over.add(c1, c2, c3);
      this.centerOverhead[4] = new Instanced(over, 16, scene, { name: 'c4-over' });
    }

    // ========================================================================
    // #5 DIGITAL 5G & AI (ชั้น 1): 5G Lattice Cell Tower + AI Server Monolith + Signal Rings
    // ========================================================================
    {
      const stat = new THREE.Group();
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.55, 7.8, 6), slateMat);
      spire.position.y = 3.9;
      for (let h = 2; h <= 6; h += 2) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.65 - h * 0.05, 0.06, 6, 16), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = h;
        stat.add(ring);
      }
      const serverBox = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.8, 1.4), darkMat);
      serverBox.position.set(2.0, 1.9, 0);
      const serverGlow = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.25, 1.46), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      serverGlow.position.set(2.0, 3.1, 0);
      stat.add(spire, serverBox, serverGlow);
      this.centerStatic[5] = new Instanced(stat, 24, scene, { name: 'c5-stat' });

      const kin = new THREE.Group();
      const wave1 = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.07, 8, 24), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
      const wave2 = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      wave2.rotation.y = Math.PI / 2;
      const coreNode = new THREE.Mesh(new THREE.OctahedronGeometry(0.48, 0), new THREE.MeshBasicMaterial({ color: 0xf0abfc }));
      kin.add(wave1, wave2, coreNode);
      this.centerKinetic[5] = new Instanced(kin, 24, scene, { name: 'c5-kin' });

      const over = new THREE.Group();
      const dataCube = new THREE.Mesh(new THREE.OctahedronGeometry(0.95, 0), new THREE.MeshBasicMaterial({ color: 0xc084fc, wireframe: true }));
      over.add(dataCube);
      this.centerOverhead[5] = new Instanced(over, 16, scene, { name: 'c5-over' });
    }

    // ========================================================================
    // #3 RAIL & EV (ชั้น 1): Golden Maglev Supercharger Pylon + Hyperloop Tube Arches
    // ========================================================================
    {
      const stat = new THREE.Group();
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5.4, 1.5), slateMat);
      pylon.position.y = 2.7;
      const goldTrim = new THREE.Mesh(new THREE.BoxGeometry(0.96, 5.0, 0.35), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      goldTrim.position.set(0, 2.7, 0.65);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 2.2), whiteMat);
      canopy.position.set(-0.6, 5.5, 0);
      canopy.rotation.z = 0.22;
      stat.add(pylon, goldTrim, canopy);
      this.centerStatic[3] = new Instanced(stat, 24, scene, { name: 'c3-stat' });

      const kin = new THREE.Group();
      const gyro1 = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 8, 20), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      const gyro2 = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.08, 8, 20), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      gyro2.rotation.x = Math.PI / 2;
      kin.add(gyro1, gyro2);
      this.centerKinetic[3] = new Instanced(kin, 24, scene, { name: 'c3-kin' });

      const over = new THREE.Group();
      const archRing = new THREE.Mesh(
        new THREE.TorusGeometry(5.4, 0.16, 10, 32, Math.PI),
        new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
      );
      over.add(archRing);
      this.centerOverhead[3] = new Instanced(over, 16, scene, { name: 'c3-over' });
    }

    // ========================================================================
    // #2 ROBOTICS (ชั้น 2-6): Articulated Industrial Robot Arm + Laser Gantry
    // ========================================================================
    {
      const stat = new THREE.Group();
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.15, 1.2, 8), slateMat);
      ped.position.y = 0.6;
      const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.9), new THREE.MeshBasicMaterial({ color: 0xfb923c }));
      shoulder.position.y = 1.6;
      const lowerBoom = new THREE.Mesh(new THREE.BoxGeometry(0.48, 3.4, 0.48), whiteMat);
      lowerBoom.position.set(0, 3.5, 0);
      lowerBoom.rotation.z = 0.18;
      stat.add(ped, shoulder, lowerBoom);
      this.centerStatic[2] = new Instanced(stat, 24, scene, { name: 'c2-stat' });

      const kin = new THREE.Group();
      const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 10), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      joint.rotation.x = Math.PI / 2;
      const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 2.6, 0.38), new THREE.MeshBasicMaterial({ color: 0xfb923c }));
      forearm.position.set(-0.6, 1.1, 0);
      forearm.rotation.z = 0.55;
      const claw = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 8, 16, Math.PI * 1.4), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      claw.position.set(-1.35, 2.2, 0);
      kin.add(joint, forearm, claw);
      this.centerKinetic[2] = new Instanced(kin, 24, scene, { name: 'c2-kin' });

      const over = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.35, 0.45), slateMat);
      const laser = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.12, 0.16), new THREE.MeshBasicMaterial({ color: 0xfb923c }));
      laser.position.y = -0.24;
      over.add(beam, laser);
      this.centerOverhead[2] = new Instanced(over, 16, scene, { name: 'c2-over' });
    }

    // ========================================================================
    // #6 WEATHER RADAR (ชั้น 8): Geodesic Radome Tower + Spinning Doppler Dish + Rain Clouds
    // ========================================================================
    {
      const stat = new THREE.Group();
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.05, 4.4, 10), whiteMat);
      tower.position.y = 2.2;
      const radome = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 1), new THREE.MeshBasicMaterial({ color: 0x2dd4bf, wireframe: true }));
      radome.position.set(2.1, 1.6, 0);
      stat.add(tower, radome);
      this.centerStatic[6] = new Instanced(stat, 24, scene, { name: 'c6-stat' });

      const kin = new THREE.Group();
      const dish = new THREE.Mesh(new THREE.ConeGeometry(1.45, 0.75, 16, 1, true), whiteMat);
      dish.rotation.z = Math.PI / 3;
      const feedHorn = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
      feedHorn.rotation.z = -Math.PI / 6;
      feedHorn.position.set(0.45, 0.3, 0);
      const scanRing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 8, 24), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
      scanRing.rotation.x = Math.PI / 2;
      kin.add(dish, feedHorn, scanRing);
      this.centerKinetic[6] = new Instanced(kin, 24, scene, { name: 'c6-kin' });

      const over = new THREE.Group();
      const cl1 = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 10), whiteMat);
      const cl2 = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 10), whiteMat);
      cl2.position.set(1.15, -0.1, 0);
      const rainStreak = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
      rainStreak.position.set(0.4, -1.6, 0);
      over.add(cl1, cl2, rainStreak);
      this.centerOverhead[6] = new Instanced(over, 16, scene, { name: 'c6-over' });
    }

    // ========================================================================
    // #7 BIO-MATERIALS (ชั้น 8): Bioreactor Column + Spinning 3D Double-Helix DNA + Molecule
    // ========================================================================
    {
      const stat = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.9, 6), slateMat);
      base.position.y = 0.45;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 6), slateMat);
      cap.position.y = 6.8;
      const glassCore = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 6.0, 12), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
      glassCore.position.set(2.0, 3.0, 0);
      stat.add(base, cap, glassCore);
      this.centerStatic[7] = new Instanced(stat, 24, scene, { name: 'c7-stat' });

      const kin = new THREE.Group();
      for (let i = 0; i < 8; i++) {
        const y = -2.2 + i * 0.65;
        const ang = i * 0.75;
        const x1 = Math.cos(ang) * 0.85;
        const z1 = Math.sin(ang) * 0.85;
        const n1 = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), new THREE.MeshBasicMaterial({ color: 0xa3e635 }));
        n1.position.set(x1, y, z1);
        const n2 = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
        n2.position.set(-x1, y, -z1);
        const rung = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.08), whiteMat);
        rung.position.set(0, y, 0);
        rung.rotation.y = -ang;
        kin.add(n1, n2, rung);
      }
      this.centerKinetic[7] = new Instanced(kin, 24, scene, { name: 'c7-kin' });

      const over = new THREE.Group();
      const hexRing = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.1, 6, 6), new THREE.MeshBasicMaterial({ color: 0xa3e635 }));
      over.add(hexRing);
      this.centerOverhead[7] = new Instanced(over, 16, scene, { name: 'c7-over' });
    }

    // ========================================================================
    // #8 MEDICAL TECH (ชั้น 9): Clean Alabaster Sanctuary Pillar + Rotating 3D Medical Cross
    // ========================================================================
    {
      const stat = new THREE.Group();
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 3.8, 12), whiteMat);
      col.position.y = 1.9;
      const trim = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 8, 20), new THREE.MeshBasicMaterial({ color: 0xfb7185 }));
      trim.rotation.x = Math.PI / 2;
      trim.position.y = 3.7;
      const ecgPillar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.2, 0.35), new THREE.MeshBasicMaterial({ color: 0xfb7185 }));
      ecgPillar.position.set(2.0, 2.6, 0);
      stat.add(col, trim, ecgPillar);
      this.centerStatic[8] = new Instanced(stat, 24, scene, { name: 'c8-stat' });

      const kin = new THREE.Group();
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.85, 0.45), new THREE.MeshBasicMaterial({ color: 0xfb7185 }));
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.55, 0.45), new THREE.MeshBasicMaterial({ color: 0xfb7185 }));
      const haloRing = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.08, 8, 24), whiteMat);
      kin.add(crossV, crossH, haloRing);
      this.centerKinetic[8] = new Instanced(kin, 24, scene, { name: 'c8-kin' });

      const over = new THREE.Group();
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(5.2, 0.14, 8, 28, Math.PI),
        new THREE.MeshBasicMaterial({ color: 0xfecdd3 }),
      );
      over.add(arch);
      this.centerOverhead[8] = new Instanced(over, 16, scene, { name: 'c8-over' });
    }

    // ========================================================================
    // #9 SPACE INSTITUTE (ชั้น 10): Space Rocket + Launch Tower + Orbiting CubeSat
    // ========================================================================
    {
      const stat = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.6, 12), slateMat);
      pad.position.y = 0.3;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.65, 6.2, 14), whiteMat);
      body.position.y = 3.6;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.8, 14), new THREE.MeshBasicMaterial({ color: 0xf472b6 }));
      nose.position.y = 7.6;
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.7), new THREE.MeshBasicMaterial({ color: 0xf472b6 }));
        const a = (i * Math.PI) / 2;
        fin.position.set(Math.cos(a) * 0.7, 1.2, Math.sin(a) * 0.7);
        fin.rotation.y = -a;
        stat.add(fin);
      }
      const launchGantry = new THREE.Mesh(new THREE.BoxGeometry(0.55, 7.8, 0.55), new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true }));
      launchGantry.position.set(1.65, 3.9, 0);
      stat.add(pad, body, nose, launchGantry);
      this.centerStatic[9] = new Instanced(stat, 24, scene, { name: 'c9-stat' });

      const kin = new THREE.Group();
      const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.06, 8, 28), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      orbitRing.rotation.x = Math.PI / 2.3;
      const satBody = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      satBody.position.set(1.75, 0, 0);
      const satPanels = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.38), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      satPanels.position.set(1.75, 0, 0);
      kin.add(orbitRing, satBody, satPanels);
      this.centerKinetic[9] = new Instanced(kin, 24, scene, { name: 'c9-kin' });

      const over = new THREE.Group();
      const ringStation = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.14, 10, 24), new THREE.MeshBasicMaterial({ color: 0xf472b6 }));
      ringStation.rotation.x = Math.PI / 3;
      const coreHub = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 10), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      over.add(ringStation, coreHub);
      this.centerOverhead[9] = new Instanced(over, 16, scene, { name: 'c9-over' });
    }
  }

  /** Large Holographic Billboards displaying each of the 9 TechnoPark Research Centers along the track! */
  private buildCenterBillboards(scene: THREE.Scene) {
    for (const meta of CENTER_LIST) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(5.6, 2.8),
        new THREE.MeshBasicMaterial({ map: centerBillboardTexture(meta.id), side: THREE.DoubleSide }),
      );
      plane.position.y = 3.6;
      plane.name = 'billboard-' + meta.id;
      this.centerBillboards[meta.id] = new Instanced(plane, 6, scene, { name: 'bb-' + meta.id });
    }
  }

  private buildGhostPackPool(core: GLTF, scene: THREE.Scene) {
    const ringGeo = new THREE.RingGeometry(0.38, 0.56, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const runClip = core.animations.find((c) => c.name === 'run') || core.animations[0];

    for (let i = 0; i < 6; i++) {
      const group = new THREE.Group();
      group.visible = false;

      const charClone = cloneSkinned(this.player.model);
      charClone.scale.set(0.92, 0.92, 0.92);
      const mixer = new THREE.AnimationMixer(charClone);
      if (runClip) {
        const act = mixer.clipAction(runClip);
        act.timeScale = 1.15;
        act.play();
        mixer.update(i * 0.23);
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
      this.ghostSlots.push({ group, mixer, ring, badge, badgeKey: '', x: laneX(i % 3), y: 0, z: -4 - i * 3 });
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
    this.syncGhostPack(dt, menu, ghosts, localPlayerId, tvMode);

    this.player.root.visible = !tvMode || menu;
    if (menu) this.player.menu(dt);
    this.updateCamera(sim, dt, menu, tvMode);
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

      for (const side of [-1, 1]) {
        const baseX = side * (SIDEWALK_IN + 2.3);
        const yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        q.setFromEuler(e.set(0, yaw, 0));
        m4.compose(v.set(baseX, 0.25, z), q, one);
        this.centerStatic[cId].add(m4);

        // Animated Kinetic attachment per Center!
        switch (cId) {
          case 1: // Rotating ATC radar beacon at y = 9.45
            q.setFromEuler(e.set(0, this.time * 3.8 + phase, 0));
            m4.compose(v.set(baseX, 9.45, z), q, one);
            break;
          case 4: // Spinning 3-blade Wind Turbine rotor at y = 7.6
            q.setFromEuler(e.set(0, yaw, this.time * 2.6 * side + phase));
            m4.compose(v.set(baseX, 7.6, z), q, one);
            break;
          case 5: { // Pulsing 5G signal rings at y = 7.9
            const pulse = 0.85 + 0.3 * Math.sin(this.time * 4.0 + phase);
            q.setFromEuler(e.set(0, this.time * 2.2 + phase, 0));
            m4.compose(v.set(baseX, 7.9, z), q, sc.set(pulse, pulse, pulse));
            break;
          }
          case 3: // Spinning Maglev gyro-rings at y = 6.4
            q.setFromEuler(e.set(this.time * 2.0, this.time * 3.0 + phase, 0));
            m4.compose(v.set(baseX, 6.4, z), q, one);
            break;
          case 2: // Pivoting articulated robot forearm at y = 5.1
            q.setFromEuler(e.set(0, yaw, Math.sin(this.time * 2.8 + phase) * 0.55));
            m4.compose(v.set(baseX, 5.1, z), q, one);
            break;
          case 6: // Rotating Doppler radar dish at y = 5.1
            q.setFromEuler(e.set(0, this.time * 2.4 * side + phase, 0));
            m4.compose(v.set(baseX, 5.1, z), q, one);
            break;
          case 7: // Spinning Double-Helix DNA strand at y = 3.85
            q.setFromEuler(e.set(0, this.time * 2.2 * side + phase, 0));
            m4.compose(v.set(baseX, 3.85, z), q, one);
            break;
          case 8: // Rotating 3D Medical Cross & Holo-Ring at y = 5.4
            q.setFromEuler(e.set(0, this.time * 2.0 + phase, Math.sin(this.time * 2 + phase) * 0.15));
            m4.compose(v.set(baseX, 5.4, z), q, one);
            break;
          case 9: // Orbiting CubeSat revolving around Space Rocket at y = 4.6
            q.setFromEuler(e.set(0, this.time * 2.8 * side + phase, 0));
            m4.compose(v.set(baseX, 4.6, z), q, one);
            break;
        }
        this.centerKinetic[cId].add(m4);

        // Outer open-horizon vista row at x = ±14.5 every 36m for deep panoramic depth!
        if (Math.abs(Math.floor(d / 18)) % 2 === 0) {
          q.setFromEuler(e.set(0, yaw, 0));
          m4.compose(v.set(side * 14.5, 0, z - 6), q, sc.set(1.25, 1.25, 1.25));
          this.centerStatic[cId].add(m4);
        }
      }

      // 3. Overhead Sky Elements every 36m (flying jets, clouds, hyperloop arches, laser gantries, space rings)
      if (Math.abs(Math.floor(d / 18)) % 2 === 0) {
        if (cId === 1) {
          // Jet Fighter squadron banking overhead!
          const flyX = Math.sin(this.time * 1.8 + phase) * 3.8;
          const flyY = 9.5 + Math.cos(this.time * 2.2 + phase) * 0.8;
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

    // 4. Holographic 9-Center Billboards angled toward the runner every 36m (matching the stage Center at `d`!)
    for (const meta of CENTER_LIST) this.centerBillboards[meta.id].begin();
    const firstBB = Math.floor((pd - 18) / 36) * 36;
    let slotIdx = Math.max(0, Math.floor(firstBB / 36));
    for (let d = firstBB; d < pd + VIEW_AHEAD - 12; d += 36) {
      const side = slotIdx % 2 === 0 ? -1 : 1;
      const centerId: CenterId = sim.activeCenter || centerAtDist(d) || stageCenter;
      q.setFromEuler(e.set(0, side * -0.36, 0));
      m4.compose(v.set(side * (SIDEWALK_OUT + 0.6), 0.6, zOf(d) - 9), q, one);
      this.centerBillboards[centerId].add(m4);
      slotIdx++;
    }
    for (const meta of CENTER_LIST) this.centerBillboards[meta.id].end();
  }

  private syncGhostPack(dt: number, menu: boolean, ghosts: RunnerNetState[], localPlayerId: string, tvMode: boolean) {
    const others = menu
      ? []
      : ghosts.filter((g) => tvMode || g.id !== localPlayerId).slice(0, this.ghostSlots.length);

    for (let i = 0; i < this.ghostSlots.length; i++) {
      const slot = this.ghostSlots[i];
      const g = others[i];
      if (!g) {
        slot.group.visible = false;
        continue;
      }
      slot.group.visible = true;
      slot.mixer.update(dt);

      const spreadX = ((i % 3) - 1) * 0.28;
      const spreadZ = -i * 1.35;
      const targetX = (g.x ?? laneX(g.lane)) + spreadX;
      const targetY = g.y ?? 0;
      const targetZ = -g.packOffsetZ + spreadZ;
      const k = Math.min(1, dt * 7);
      slot.x += (targetX - slot.x) * k;
      slot.y += (targetY - slot.y) * k;
      slot.z += (targetZ - slot.z) * k;
      slot.group.position.set(slot.x, slot.y, slot.z);

      const col = g.activeCenter ? CENTERS[g.activeCenter].color : g.color;
      (slot.ring.material as THREE.MeshBasicMaterial).color.set(col);

      const badgeKey = `${g.rank}:${g.name}:${col}`;
      if (slot.badgeKey !== badgeKey) {
        slot.badgeKey = badgeKey;
        const sm = slot.badge.material as THREE.SpriteMaterial;
        if (sm.map) sm.map.dispose();
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
    const dist = (tvMode ? 7.2 : 5.4) + portrait * 2.4;
    const height = (tvMode ? 3.8 : 2.75) + portrait * 1.5;
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
    cam.lookAt(tvMode ? 0 : sim.x * 0.8, this.camY + 1.25, -9);
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
