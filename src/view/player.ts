// The runner: the skinned model from core.glb, its clips mixed by game state, plus 9-Center 3D attachments.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Sim } from '../sim/sim';
import type { SimEvent, CenterId } from '../sim/types';
import { PLAYER, JUMP_V, SUPER_JUMP_V, GRAVITY, laneX, CENTERS } from '../config';
import {
  architecturalTowerSkinTexture,
  rocketHullSkinTexture,
  solarArraySkinTexture,
  serverRackSkinTexture,
  bioreactorSkinTexture,
  nameBadgeTexture,
} from './textures';
import {
  applyAvatarToCharacter, updateAvatarMotion, sanitizeAvatarId, type AvatarId,
} from './avatars';

type Clip = 'idle' | 'run' | 'jump' | 'jumpup' | 'fall' | 'roll' | 'die' | 'runlookback';

export class PlayerView {
  root = new THREE.Group();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions = {} as Record<Clip, THREE.AnimationAction>;
  current: Clip | null = null;
  avatarId: AvatarId = 'non';
  attachments: Record<CenterId, THREE.Group> = {} as Record<CenterId, THREE.Group>;
  private auraRing: THREE.Mesh;
  private auraColor = '#38bdf8';
  private nameBadge: THREE.Sprite;
  private badgeKey = '';
  private lean = 0;
  private leanV = 0;
  private yaw = 0;
  private yawV = 0;
  private squash = 0;
  private stumbleT = 0;
  private menuT = 0;
  private lobbyLane = 1;
  private lobbyX = 0;

  constructor(gltf: GLTF, scene: THREE.Scene) {
    const src = gltf.scene.getObjectByName('player')!;
    const model = src;
    model.removeFromParent();
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI;
    holder.add(model);
    this.model = holder;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = false;
        m.frustumCulled = false;
      }
    });
    this.root.add(holder);

    // Base glowing ring under runner feet
    const ringGeo = new THREE.RingGeometry(0.42, 0.62, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.auraRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
    );
    this.auraRing.position.y = 0.04;
    this.root.add(this.auraRing);

    const spriteMat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
    this.nameBadge = new THREE.Sprite(spriteMat);
    this.nameBadge.scale.set(1.6, 0.36, 1);
    this.nameBadge.position.set(0, 2.1, 0);
    this.root.add(this.nameBadge);

    this.attachments = createCenterAttachments();
    for (const grp of Object.values(this.attachments)) {
      this.root.add(grp);
    }
    scene.add(this.root);

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const name = clip.name as Clip;
      const a = this.mixer.clipAction(clip);
      if (['jump', 'jumpup', 'roll', 'die', 'runlookback'].includes(name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[name] = a;
    }
  }

  setCenterEffect(centerId: CenterId | null, time: number) {
    updateCenterAttachments(this.attachments, centerId, time);
    const auraMat = this.auraRing.material as THREE.MeshBasicMaterial;
    if (centerId) {
      auraMat.color.set(CENTERS[centerId].color);
      auraMat.opacity = 0.85;
      const pulse = 1 + Math.sin(time * 10) * 0.12;
      this.auraRing.scale.set(pulse, pulse, 1);
    } else {
      auraMat.color.set(this.auraColor || '#38bdf8');
      auraMat.opacity = 0.55;
      this.auraRing.scale.set(1, 1, 1);
    }
  }

  /** Updates the 3D floating nameplate & aura ring color above the local player's character. */
  setProfileBadge(name: string, rank = 1, color = '#38bdf8') {
    const cleanName = (name || '').trim() || 'นักวิ่ง Techno';
    this.auraColor = color || '#38bdf8';
    const r = Math.max(1, rank || 1);
    const key = `${r}:${cleanName}:${this.auraColor}`;
    if (this.badgeKey !== key) {
      this.badgeKey = key;
      const sm = this.nameBadge.material as THREE.SpriteMaterial;
      sm.map = nameBadgeTexture(cleanName, r, this.auraColor);
      sm.needsUpdate = true;
    }
    const auraMat = this.auraRing.material as THREE.MeshBasicMaterial;
    auraMat.color.set(this.auraColor);
  }

  /** Switches the runner's 3D character avatar (mesh island filtering + UV outfit skin + bone-rigged 3D hair/skirt/helmet). */
  setAvatar(avatarId: AvatarId) {
    this.avatarId = sanitizeAvatarId(avatarId);
    applyAvatarToCharacter(this.model, this.avatarId);
  }

  /** Interactive Warm-Up in the Waiting Lobby: lets waiting players swipe Left/Right/Jump/Roll on their 3D character! */
  warmUpAction(action: 'left' | 'right' | 'up' | 'down') {
    if (action === 'left') this.lobbyLane = Math.max(0, this.lobbyLane - 1);
    else if (action === 'right') this.lobbyLane = Math.min(2, this.lobbyLane + 1);
    else if (action === 'up') this.play('jump', 0.06, 1.1);
    else if (action === 'down') this.play('roll', 0.06, 1.2);
  }

  private spring(dt: number, target: number, k: 'lean' | 'yaw', kv: 'leanV' | 'yawV', stiff: number, damp: number) {
    const c = 2 * Math.sqrt(stiff) * damp;
    let t = Math.min(dt, 0.05);
    while (t > 0) {
      const h = Math.min(t, 1 / 120);
      this[kv] += (stiff * (target - this[k]) - c * this[kv]) * h;
      this[k] += this[kv] * h;
      t -= h;
    }
  }

  play(name: Clip, fade = 0.12, timeScale = 1) {
    const next = this.actions[name];
    if (!next) return;
    next.timeScale = timeScale;
    if (this.current === name && next.isRunning()) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    const prev = this.current ? this.actions[this.current] : null;
    if (prev && prev !== next) prev.fadeOut(fade);
    this.current = name;
  }

  reset() {
    this.mixer.stopAllAction();
    this.current = null;
    this.lean = 0;
    this.leanV = 0;
    this.yaw = 0;
    this.yawV = 0;
    this.squash = 0;
    this.stumbleT = 0;
    this.lobbyLane = 1;
    this.lobbyX = 0;
    this.root.scale.set(1, 1, 1);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;
    this.setCenterEffect(null, 0);
  }

  menu(dt: number) {
    this.menuT += dt;
    const targetX = (this.lobbyLane - 1) * 1.1;
    this.lobbyX += (targetX - this.lobbyX) * Math.min(1, dt * 10);
    if (!this.current || (this.current !== 'jump' && this.current !== 'roll') || !this.actions[this.current]?.isRunning()) {
      this.play('idle', 0.25);
    }
    this.root.position.set(this.lobbyX, 0, 0);
    this.root.rotation.set(0, Math.sin(this.menuT * 0.4) * 0.25, 0);
    this.setCenterEffect(null, this.menuT);
    this.mixer.update(dt);
    updateAvatarMotion(this.model, this.menuT, this.current === 'jump' || this.current === 'roll');
  }

  update(sim: Sim, dt: number, events: SimEvent[]) {
    this.root.rotation.y = 0;
    for (const e of events) {
      if (e.type === 'jump') {
        const v0 = e.super ? SUPER_JUMP_V : JUMP_V;
        const air = (2 * v0) / GRAVITY;
        const d = this.actions.jump.getClip().duration;
        this.play('jump', 0.06, d / (air * 1.1));
      } else if (e.type === 'slide') {
        this.play('roll', 0.06, this.actions.roll.getClip().duration / (PLAYER.slideTime * 1.05));
      } else if (e.type === 'land') {
        this.squash = Math.min(0.22, 0.08 + e.fall * 0.04);
      } else if (e.type === 'stumble' || e.type === 'hit') {
        this.stumbleT = 0.55;
        this.play('runlookback', 0.08, 1.8);
      }
    }
    this.stumbleT = Math.max(0, this.stumbleT - dt);
    if (sim.alive) {
      const busy = (this.current === 'jump' && !sim.grounded) || (this.current === 'roll' && sim.sliding) || this.stumbleT > 0;
      if (!busy) {
        if (sim.activeCenter === 1) this.play('jumpup', 0.15, 0.5);
        else if (!sim.grounded && sim.vy < -3 && this.current !== 'jump') this.play('fall', 0.15);
        else if (sim.grounded && !sim.sliding) this.play('run', 0.12, 0.9 + sim.speed / 22);
      }
      if (this.current === 'roll' && !sim.sliding && sim.grounded) this.play('run', 0.1, 0.9 + sim.speed / 22);
    }

    const toGo = laneX(sim.lane) - sim.x;
    const dir = sim.alive && Math.abs(toGo) > 0.35 ? Math.sign(toGo) : 0;
    const air = sim.grounded ? 1 : 0.6;
    this.spring(dt, dir * air, 'lean', 'leanV', 700, 0.7);
    this.spring(dt, dir * 0.44 * air, 'yaw', 'yawV', 1000, 0.62);
    this.squash = Math.max(0, this.squash - dt * 1.4);
    this.root.position.set(sim.x, sim.y, 0);
    this.root.rotation.z = -this.lean * 0.18;
    this.model.rotation.y = Math.PI - this.yaw;
    const sq = this.squash;
    this.root.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);

    // Invulnerability blink after stumble/hit
    if (sim.invulnerableT > 0 && sim.activeCenter === null) {
      this.model.visible = Math.floor(sim.invulnerableT * 16) % 2 === 0;
    } else {
      this.model.visible = true;
    }

    this.setCenterEffect(sim.activeCenter, sim.time);
    this.mixer.update(dt);
    updateAvatarMotion(this.model, sim.time, sim.alive);
  }
}

export function createCenterAttachments(): Record<CenterId, THREE.Group> {
  const attachments = {} as Record<CenterId, THREE.Group>;
  const basicMat = (hex: string, opacity = 0.85, wireframe = false) =>
    new THREE.MeshBasicMaterial({ color: hex, transparent: opacity < 1, opacity, wireframe });
  const aeroSkinMat = new THREE.MeshPhongMaterial({
    map: architecturalTowerSkinTexture('#f8fafc', '#38bdf8', '#0284c7'),
    shininess: 75,
  });
  const darkMetalMat = new THREE.MeshPhongMaterial({ color: 0x1e293b, shininess: 85 });
  const chromeMat = new THREE.MeshPhongMaterial({ color: 0xe2e8f0, shininess: 100 });
  const goldFoilMat = new THREE.MeshPhongMaterial({
    color: 0xfacc15,
    emissive: 0x854d0e,
    emissiveIntensity: 0.35,
    shininess: 110,
  });
  const rocketSkinMat = new THREE.MeshPhongMaterial({
    map: rocketHullSkinTexture('#f472b6'),
    shininess: 80,
  });
  const solarSkinMat = new THREE.MeshPhongMaterial({
    map: solarArraySkinTexture(),
    shininess: 95,
  });
  const serverSkinMat = new THREE.MeshPhongMaterial({
    map: serverRackSkinTexture(),
    shininess: 85,
  });
  const bioSkinMat = new THREE.MeshPhongMaterial({
    map: bioreactorSkinTexture(),
    shininess: 90,
  });

  // ==========================================================================
  // #1 อากาศยานและป้องกันประเทศ: Jet Fighter Pack (Swept Delta Wings + Twin Turbofans + Wingtip Missiles + Afterburners)
  // ==========================================================================
  const g1 = new THREE.Group();
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.48);
  wingShape.lineTo(1.32, -0.22);
  wingShape.lineTo(1.18, -0.46);
  wingShape.lineTo(0, -0.12);
  wingShape.lineTo(-1.18, -0.46);
  wingShape.lineTo(-1.32, -0.22);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.055,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.02,
    bevelThickness: 0.02,
  });
  wingGeo.rotateX(Math.PI / 2);
  const wing = new THREE.Mesh(wingGeo, aeroSkinMat);
  wing.position.set(0, 1.22, 0.22);

  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.85, 14), darkMetalMat);
  spine.rotation.x = Math.PI / 2;
  spine.position.set(0, 1.26, 0.22);
  const spineCore = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.65), basicMat('#38bdf8', 0.95));
  spineCore.position.set(0, 1.35, 0.22);
  g1.add(wing, spine, spineCore);

  const podGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.78, 16);
  podGeo.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(podGeo, aeroSkinMat);
    pod.position.set(s * 0.36, 1.15, 0.24);
    const intakeRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 8, 16), basicMat('#38bdf8', 0.95));
    intakeRing.position.set(s * 0.36, 1.15, -0.15);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.22, 14), darkMetalMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(s * 0.36, 1.15, 0.66);

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.42, 0.36), aeroSkinMat);
    fin.position.set(s * 0.38, 1.4, 0.36);
    fin.rotation.z = -s * 0.26;
    const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 0.36), basicMat('#facc15', 0.95));
    finTip.position.set(s * 0.43, 1.6, 0.36);
    finTip.rotation.z = -s * 0.26;

    // Wingtip Sidewinder Air-to-Air Missile + Launch Rail
    const wingRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.56), darkMetalMat);
    wingRail.position.set(s * 1.25, 1.2, 0.48);
    const missileBody = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.58, 10), chromeMat);
    missileBody.rotation.x = Math.PI / 2;
    missileBody.position.set(s * 1.25, 1.15, 0.46);
    const missileNose = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.14, 10), basicMat('#f97316', 0.98));
    missileNose.rotation.x = -Math.PI / 2;
    missileNose.position.set(s * 1.25, 1.15, 0.10);

    const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.62, 14), basicMat('#f97316', 0.88));
    flameOuter.rotation.x = Math.PI / 2;
    flameOuter.position.set(s * 0.36, 1.15, 1.02);
    flameOuter.userData.isAfterburner = true;
    const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.38, 12), basicMat('#fef08a', 0.96));
    flameCore.rotation.x = Math.PI / 2;
    flameCore.position.set(s * 0.36, 1.15, 0.9);
    flameCore.userData.isAfterburner = true;

    g1.add(pod, intakeRing, nozzle, fin, finTip, wingRail, missileBody, missileNose, flameOuter, flameCore);
  }

  // ==========================================================================
  // #2 หุ่นยนต์และระบบอัตโนมัติ: Twin Autonomous Quadcopter Wingman Drones + Mecha Telemetry Pack
  // ==========================================================================
  const g2 = new THREE.Group();
  const roboMat = new THREE.MeshPhongMaterial({
    map: architecturalTowerSkinTexture('#fb923c', '#facc15', '#0f172a'),
    shininess: 85,
  });
  const orangeMetalMat = new THREE.MeshPhongMaterial({ color: 0xf97316, shininess: 90 });

  // Back-mounted Mecha Command & Control Unit
  const mechaPack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.22), roboMat);
  mechaPack.position.set(0, 1.18, 0.24);
  const mechaCore = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.25, 14), basicMat('#38bdf8', 0.95));
  mechaCore.rotation.x = Math.PI / 2;
  mechaCore.position.set(0, 1.2, 0.25);
  g2.add(mechaPack, mechaCore);

  // Two Quadcopter Wingman Drones hovering at left & right shoulders (bobbing, never spinning around in a circle)
  for (const s of [-1, 1]) {
    const drone = new THREE.Group();
    drone.position.set(s * 0.95, 1.52, -0.1);
    drone.userData.droneSide = s;

    // Armored central quadcopter fuselage + top GPS dome + front optical camera turret
    const chassis = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.16, 8), roboMat);
    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.08, 8), orangeMetalMat);
    topCap.position.y = 0.11;
    const camPod = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), darkMetalMat);
    camPod.position.set(0, -0.04, -0.16);
    const camLens = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), basicMat('#38bdf8', 0.98));
    camLens.position.set(0, -0.04, -0.22);

    // Lower articulated robotic collector pincer claws
    for (const cs of [-1, 1]) {
      const clawUpper = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.14, 0.04), darkMetalMat);
      clawUpper.position.set(cs * 0.09, -0.14, -0.04);
      clawUpper.rotation.z = cs * 0.28;
      const clawTip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.04), orangeMetalMat);
      clawTip.position.set(cs * 0.07, -0.23, -0.04);
      clawTip.rotation.z = -cs * 0.35;
      drone.add(clawUpper, clawTip);
    }

    // 4 Diagonal Carbon-Fiber Quadcopter Arms + 4 Corner Motor Pods + 4 Spinning 2-Blade Propellers
    for (const ax of [-1, 1]) {
      for (const az of [-1, 1]) {
        const rx = ax * 0.23;
        const rz = az * 0.23;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.04), darkMetalMat);
        arm.position.set(rx * 0.5, 0.02, rz * 0.5);
        arm.rotation.y = ax * az > 0 ? -Math.PI / 4 : Math.PI / 4;

        const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 10), orangeMetalMat);
        motor.position.set(rx, 0.04, rz);
        const shroud = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.016, 6, 16), darkMetalMat);
        shroud.rotation.x = Math.PI / 2;
        shroud.position.set(rx, 0.07, rz);

        const prop = new THREE.Group();
        prop.position.set(rx, 0.09, rz);
        prop.userData.isRotor = true;
        const blade1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, 0.032), basicMat('#fde047', 0.92));
        const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.01, 0.22), basicMat('#fde047', 0.92));
        prop.add(blade1, blade2);

        drone.add(arm, motor, shroud, prop);
      }
    }

    drone.add(chassis, topCap, camPod, camLens);
    g2.add(drone);
  }

  // ==========================================================================
  // #3 ยานยนต์ไฟฟ้าและระบบราง: EV Express Bullet-Train Maglev Exo-Armor Rig
  // ==========================================================================
  const g3 = new THREE.Group();
  const evSkinMat = new THREE.MeshPhongMaterial({
    map: architecturalTowerSkinTexture('#facc15', '#38bdf8', '#0f172a'),
    shininess: 90,
  });

  // Twin Side Bullet-Train Aerodynamic Maglev Bogie Pods & Levitation Skirts (left & right of legs/hips)
  for (const s of [-1, 1]) {
    const sideHull = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.92), evSkinMat);
    sideHull.position.set(s * 0.52, 0.68, -0.05);
    // Streamlined bullet-train nose cone at front (-Z) of each side pod
    const noseCone = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.48, 12), evSkinMat);
    noseCone.rotation.x = -Math.PI / 2;
    noseCone.position.set(s * 0.52, 0.64, -0.74);
    // Glowing cyan Maglev superconducting rail runner underneath
    const magRail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 1.15), basicMat('#38bdf8', 0.95));
    magRail.position.set(s * 0.52, 0.43, -0.12);
    // High-intensity LED Headlight Pod + lens
    const lampHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 12), darkMetalMat);
    lampHousing.rotation.x = Math.PI / 2;
    lampHousing.position.set(s * 0.52, 0.82, -0.52);
    const lampLens = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 10), basicMat('#fef08a', 0.98));
    lampLens.position.set(s * 0.52, 0.82, -0.58);

    g3.add(sideHull, noseCone, magRail, lampHousing, lampLens);
  }

  // Front Sculpted V-Chevron Locomotive Cowcatcher Deflector Grille (angled bars, no raw cone!)
  for (let row = 0; row < 3; row++) {
    const y = 0.52 + row * 0.13;
    for (const s of [-1, 1]) {
      const slat = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.055, 0.08),
        row === 1 ? basicMat('#38bdf8', 0.95) : evSkinMat,
      );
      slat.position.set(s * 0.25, y, -0.62 + Math.abs(s) * 0.08);
      slat.rotation.y = s * 0.38;
      g3.add(slat);
    }
  }
  const centerProw = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.18), chromeMat);
  centerProw.position.set(0, 0.65, -0.68);
  g3.add(centerProw);

  // Back-Mounted Electric Train Diamond Pantograph Power Collector on Backpack
  const pantoBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.22), darkMetalMat);
  pantoBase.position.set(0, 1.38, 0.26);
  for (const s of [-1, 1]) {
    const lowerArm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 8), chromeMat);
    lowerArm.position.set(s * 0.12, 1.54, 0.26);
    lowerArm.rotation.z = s * 0.42;
    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 8), chromeMat);
    upperArm.position.set(s * 0.12, 1.78, 0.26);
    upperArm.rotation.z = -s * 0.42;
    g3.add(lowerArm, upperArm);
  }
  const contactBow = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.08), basicMat('#38bdf8', 0.96));
  contactBow.position.set(0, 1.92, 0.26);
  g3.add(pantoBase, contactBow);

  // ==========================================================================
  // #4 สิ่งแวดล้อมและพลังงานสะอาด: Solar-Wind Clean Energy Pack (Spinning 3-Blade Wind Turbine + Gridded Solar Wings)
  // ==========================================================================
  const g4 = new THREE.Group();
  const cleanSkinMat = new THREE.MeshPhongMaterial({
    map: architecturalTowerSkinTexture('#f8fafc', '#4ade80', '#15803d'),
    shininess: 80,
  });
  const emeraldMat = new THREE.MeshPhongMaterial({
    color: 0x10b981,
    emissive: 0x065f46,
    emissiveIntensity: 0.35,
    shininess: 95,
  });

  // Back-Mounted Wind Turbine Tower Mast & Nacelle Generator
  const turbineMast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.72, 14), cleanSkinMat);
  turbineMast.position.set(0, 1.38, 0.28);
  const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.34, 14), cleanSkinMat);
  nacelle.rotation.x = Math.PI / 2;
  nacelle.position.set(0, 1.75, 0.32);
  g4.add(turbineMast, nacelle);

  // Spinning 3-Blade Wind Turbine Rotor Assembly behind shoulders
  const windRotor = new THREE.Group();
  windRotor.position.set(0, 1.75, 0.5);
  windRotor.userData.spinZ = true;
  const hubCone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 14), emeraldMat);
  hubCone.rotation.x = Math.PI / 2;
  hubCone.position.z = 0.06;
  windRotor.add(hubCone);
  for (let b = 0; b < 3; b++) {
    const bladePivot = new THREE.Group();
    bladePivot.rotation.z = (b * Math.PI * 2) / 3;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.56, 0.025), chromeMat);
    blade.position.y = 0.3;
    blade.rotation.y = 0.22;
    const bladeTip = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.12, 0.028), basicMat('#4ade80', 0.95));
    bladeTip.position.y = 0.54;
    bladeTip.rotation.y = 0.22;
    bladePivot.add(blade, bladeTip);
    windRotor.add(bladePivot);
  }
  g4.add(windRotor);

  // Twin Fold-Out Gridded Photovoltaic Solar Panel Wings on Left & Right of Backpack
  for (const s of [-1, 1]) {
    const wingFrame = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.38, 0.04), chromeMat);
    wingFrame.position.set(s * 0.58, 1.24, 0.26);
    wingFrame.rotation.z = s * 0.15;
    wingFrame.rotation.y = -s * 0.2;
    const solarPanel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.05), solarSkinMat);
    solarPanel.position.copy(wingFrame.position);
    solarPanel.rotation.copy(wingFrame.rotation);
    g4.add(wingFrame, solarPanel);
  }

  // Orbiting Clean-Energy Solar-Crystal Hexagonal Barrier Nodes around waist
  const shieldOrbit = new THREE.Group();
  shieldOrbit.position.set(0, 1.0, 0);
  shieldOrbit.userData.orbitGroup = true;
  for (let k = 0; k < 3; k++) {
    const ang = (k * Math.PI * 2) / 3;
    const hexPlate = new THREE.Group();
    hexPlate.position.set(Math.cos(ang) * 0.88, 0, Math.sin(ang) * 0.88);
    hexPlate.rotation.y = -ang + Math.PI / 2;
    const hexCore = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 6), solarSkinMat);
    hexCore.rotation.x = Math.PI / 2;
    const hexRim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.028, 8, 6), emeraldMat);
    hexPlate.add(hexCore, hexRim);
    shieldOrbit.add(hexPlate);
  }
  g4.add(shieldOrbit);

  // ==========================================================================
  // #5 นวัตกรรมไร้สาย 5G: 5G mmWave Transceiver Pack + Twin Classic U-Shaped Horseshoe Electro-Magnets
  // ==========================================================================
  const g5 = new THREE.Group();
  const magnetRedMat = new THREE.MeshPhongMaterial({
    color: 0xe11d48,
    emissive: 0x881337,
    emissiveIntensity: 0.3,
    shininess: 95,
  });
  const purple5GMat = new THREE.MeshPhongMaterial({
    color: 0xc084fc,
    emissive: 0x581c87,
    emissiveIntensity: 0.35,
    shininess: 95,
  });

  // Back-Mounted 5G mmWave Server & Phased-Array Transceiver Tower
  const rackPack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 0.24), serverSkinMat);
  rackPack.position.set(0, 1.2, 0.26);
  const mast5G = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.52, 10), chromeMat);
  mast5G.position.set(0, 1.68, 0.26);
  g5.add(rackPack, mast5G);
  for (let p = 0; p < 3; p++) {
    const a = (p * Math.PI * 2) / 3;
    const sectorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.04), purple5GMat);
    sectorPanel.position.set(Math.sin(a) * 0.1, 1.78, 0.26 + Math.cos(a) * 0.1);
    sectorPanel.rotation.y = a;
    g5.add(sectorPanel);
  }

  // Two Iconic 3D U-Shaped Horseshoe Magnets hovering on Left & Right to attract coins!
  for (const s of [-1, 1]) {
    const magGrp = new THREE.Group();
    magGrp.position.set(s * 0.78, 1.15, -0.05);
    magGrp.rotation.y = -s * 0.22;
    magGrp.userData.magnetSide = s;

    // Red U-bend arch at back (+Z)
    const uArch = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.065, 12, 20, Math.PI), magnetRedMat);
    uArch.rotation.y = Math.PI / 2;
    uArch.rotation.x = -Math.PI / 2;
    uArch.position.set(0, 0, 0.08);
    magGrp.add(uArch);

    // Upper & Lower straight magnetic poles extending forward (-Z) + Chrome/Silver Pole Tips + Electric Arcs
    for (const py of [-0.18, 0.18]) {
      const redLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.22, 12), magnetRedMat);
      redLeg.rotation.x = Math.PI / 2;
      redLeg.position.set(0, py, -0.03);
      const chromeTip = new THREE.Mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.12, 12), chromeMat);
      chromeTip.rotation.x = Math.PI / 2;
      chromeTip.position.set(0, py, -0.2);
      const poleCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.068, 0.068, 0.02, 12),
        basicMat(py > 0 ? '#38bdf8' : '#f0abfc', 0.98),
      );
      poleCap.rotation.x = Math.PI / 2;
      poleCap.position.set(0, py, -0.26);
      magGrp.add(redLeg, chromeTip, poleCap);
    }

    // Glowing Magnetic Flux Ring between the North & South pole tips
    const fluxArc = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 8, 16), basicMat('#38bdf8', 0.9));
    fluxArc.position.set(0, 0, -0.28);
    fluxArc.userData.isFluxArc = true;
    magGrp.add(fluxArc);

    g5.add(magGrp);
  }

  // ==========================================================================
  // #6 เรดาร์และพยากรณ์อากาศ: AWACS Rotating Radar Rotodome Saucer + Ground Target Reticle
  // ==========================================================================
  const g6 = new THREE.Group();
  const radarSkinMat = new THREE.MeshPhongMaterial({
    map: architecturalTowerSkinTexture('#0f172a', '#2dd4bf', '#38bdf8'),
    shininess: 90,
  });
  const tealMetalMat = new THREE.MeshPhongMaterial({
    color: 0x14b8a6,
    emissive: 0x115e59,
    emissiveIntensity: 0.35,
    shininess: 95,
  });

  // Back-Mounted Dual V-Pylon Struts supporting the overhead AWACS Rotodome
  const radarPack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.22), radarSkinMat);
  radarPack.position.set(0, 1.18, 0.25);
  g6.add(radarPack);
  for (const s of [-1, 1]) {
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.038, 0.68, 10), chromeMat);
    pylon.position.set(s * 0.14, 1.65, 0.25);
    pylon.rotation.z = -s * 0.12;
    g6.add(pylon);
  }

  // Authentic Rotating AWACS Radar Rotodome Saucer Assembly
  const rotodome = new THREE.Group();
  rotodome.position.set(0, 1.98, 0.22);
  rotodome.userData.spinY = true;

  const saucerDome = new THREE.Mesh(new THREE.SphereGeometry(0.48, 24, 16), radarSkinMat);
  saucerDome.scale.set(1, 0.26, 1);
  const saucerRim = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.032, 10, 28), tealMetalMat);
  saucerRim.rotation.x = Math.PI / 2;
  const phasedBar = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.08, 0.14), chromeMat);
  phasedBar.position.y = 0.09;
  const centerBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), basicMat('#2dd4bf', 0.98));
  centerBeacon.position.y = 0.15;
  rotodome.add(saucerDome, saucerRim, phasedBar, centerBeacon);
  g6.add(rotodome);

  // Crisp Flat Ground-Projected Tactical Radar Reticle ahead on the track (no floating cone!)
  const groundReticle = new THREE.Group();
  groundReticle.position.set(0, 0.06, -1.65);
  groundReticle.userData.spinY = true;
  const outerReticle = new THREE.Mesh(new THREE.RingGeometry(0.68, 0.76, 28), basicMat('#2dd4bf', 0.85));
  outerReticle.rotation.x = -Math.PI / 2;
  const innerReticle = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.38, 24), basicMat('#38bdf8', 0.75));
  innerReticle.rotation.x = -Math.PI / 2;
  const crossLine1 = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.02, 0.045), basicMat('#2dd4bf', 0.8));
  const crossLine2 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, 1.45), basicMat('#2dd4bf', 0.8));
  groundReticle.add(outerReticle, innerReticle, crossLine1, crossLine2);
  g6.add(groundReticle);

  // ==========================================================================
  // #7 เคมีชีวภาพและวัสดุใหม่: Twin Bioreactor Vessels + 3D Double-Helix DNA Spiral + Hydraulic Exo-Boots
  // ==========================================================================
  const g7 = new THREE.Group();
  const limeMetalMat = new THREE.MeshPhongMaterial({
    color: 0x84cc16,
    emissive: 0x365314,
    emissiveIntensity: 0.35,
    shininess: 95,
  });

  // Twin Back-Mounted Glowing Green Bioreactor Cylinders with Chrome End-Caps & Valves
  for (const s of [-1, 1]) {
    const vessel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.68, 16), bioSkinMat);
    vessel.position.set(s * 0.22, 1.22, 0.28);
    const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.132, 14, 10), chromeMat);
    capTop.position.set(s * 0.22, 1.56, 0.28);
    const capBot = new THREE.Mesh(new THREE.SphereGeometry(0.132, 14, 10), chromeMat);
    capBot.position.set(s * 0.22, 0.88, 0.28);
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), limeMetalMat);
    valve.position.set(s * 0.22, 1.68, 0.28);
    g7.add(vessel, capTop, capBot, valve);

    // Hydraulic Exo-Jump Leg Struts & Repulsor Jump Pads on Lower Legs
    const legStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.44, 10), chromeMat);
    legStrut.position.set(s * 0.26, 0.36, 0.05);
    const jumpCuff = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 8, 16), limeMetalMat);
    jumpCuff.rotation.x = Math.PI / 2;
    jumpCuff.position.set(s * 0.2, 0.22, 0);
    g7.add(legStrut, jumpCuff);
  }

  // Rotating 3D Double-Helix DNA Strand (paired nucleotide spheres + cross-rungs)
  const dnaHelix = new THREE.Group();
  dnaHelix.position.set(0, 0.35, 0);
  dnaHelix.userData.spinY = true;
  for (let k = 0; k < 8; k++) {
    const ang = k * 0.78;
    const hy = k * 0.18;
    const rad = 0.68;
    const x1 = Math.cos(ang) * rad;
    const z1 = Math.sin(ang) * rad;
    const atom1 = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 10), limeMetalMat);
    atom1.position.set(x1, hy, z1);
    const atom2 = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 10), tealMetalMat);
    atom2.position.set(-x1, hy, -z1);
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, rad * 2, 6), chromeMat);
    rung.position.set(0, hy, 0);
    rung.rotation.z = Math.PI / 2;
    rung.rotation.y = -ang;
    dnaHelix.add(atom1, atom2, rung);
  }
  g7.add(dnaHelix);

  // ==========================================================================
  // #8 เทคโนโลยีการแพทย์ครบวงจร: Med-Tech Rescue Pack + Autonomous Ambulance Quad-Drone
  // ==========================================================================
  const g8 = new THREE.Group();
  const medSkinMat = new THREE.MeshPhongMaterial({
    map: architecturalTowerSkinTexture('#f8fafc', '#fb7185', '#e11d48'),
    shininess: 90,
  });
  const roseChromeMat = new THREE.MeshPhongMaterial({
    color: 0xf43f5e,
    emissive: 0x881337,
    emissiveIntensity: 0.35,
    shininess: 100,
  });

  // Back-Mounted Med-Tech Bio-Monitor & Defibrillator Pack with Beveled 3D Medical Cross
  const medPack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.22), medSkinMat);
  medPack.position.set(0, 1.18, 0.26);
  const packCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.32, 0.05), roseChromeMat);
  packCrossV.position.set(0, 1.18, 0.38);
  const packCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.11, 0.05), roseChromeMat);
  packCrossH.position.set(0, 1.18, 0.38);
  g8.add(medPack, packCrossV, packCrossH);
  for (const s of [-1, 1]) {
    const cryoVial = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.42, 12), basicMat('#fda4af', 0.92));
    cryoVial.position.set(s * 0.28, 1.18, 0.26);
    g8.add(cryoVial);
  }

  // Hovering Autonomous Medical Ambulance Quad-Drone (escorting above right shoulder)
  const medDrone = new THREE.Group();
  medDrone.position.set(0.75, 1.68, -0.05);
  medDrone.userData.isMedDrone = true;

  const cabin = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.22, 10, 16), medSkinMat);
  cabin.rotation.x = Math.PI / 2;
  const cockpitVisor = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), basicMat('#38bdf8', 0.95));
  cockpitVisor.position.set(0, 0.03, -0.14);
  const topCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.24), roseChromeMat);
  topCrossV.position.set(0, 0.16, 0);
  const topCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.08), roseChromeMat);
  topCrossH.position.set(0, 0.16, 0);
  const scanHalo = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 20), basicMat('#fb7185', 0.9));
  scanHalo.rotation.x = Math.PI / 2;
  scanHalo.position.y = -0.16;
  medDrone.add(cabin, cockpitVisor, topCrossV, topCrossH, scanHalo);

  for (const ax of [-1, 1]) {
    for (const az of [-1, 1]) {
      const rx = ax * 0.24;
      const rz = az * 0.22;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 8), chromeMat);
      strut.position.set(rx * 0.5, 0, rz * 0.5);
      strut.rotation.z = Math.PI / 2;
      strut.rotation.y = ax * az > 0 ? -Math.PI / 4 : Math.PI / 4;
      const duct = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 8, 16), roseChromeMat);
      duct.rotation.x = Math.PI / 2;
      duct.position.set(rx, 0.02, rz);
      const rotor = new THREE.Group();
      rotor.position.set(rx, 0.03, rz);
      rotor.userData.isRotor = true;
      rotor.add(
        new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.01, 0.028), chromeMat),
        new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.01, 0.18), chromeMat),
      );
      medDrone.add(strut, duct, rotor);
    }
  }
  g8.add(medDrone);

  // ==========================================================================
  // #9 สถาบันวิจัยอวกาศ: Multi-Stage Orbital Rocket Booster Pack + Orbiting Gold-Foil CubeSat
  // ==========================================================================
  const g9 = new THREE.Group();

  // Central Cryogenic Core Stage + Gold Mylar Interstage + Nose Fairing + Escape Spike
  const coreTank = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.98, 18), rocketSkinMat);
  coreTank.position.set(0, 1.24, 0.34);
  const goldInterstage = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.18, 18), goldFoilMat);
  goldInterstage.position.set(0, 1.52, 0.34);
  const coreNose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 18), chromeMat);
  coreNose.position.set(0, 1.92, 0.34);
  const escapeSpike = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.22, 8), basicMat('#f472b6', 0.98));
  escapeSpike.position.set(0, 2.18, 0.34);
  const coreBell = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.26, 16), darkMetalMat);
  coreBell.position.set(0, 0.66, 0.34);
  const corePlume = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.56, 14), basicMat('#fef08a', 0.96));
  corePlume.rotation.x = Math.PI;
  corePlume.position.set(0, 0.32, 0.34);
  corePlume.userData.isAfterburner = true;
  g9.add(coreTank, goldInterstage, coreNose, escapeSpike, coreBell, corePlume);

  // Twin Strap-On Solid Rocket Boosters (SRBs) with Swept Stabilizer Fins & Plasma Plumes
  for (const s of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.78, 16), rocketSkinMat);
    tank.position.set(s * 0.32, 1.15, 0.32);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 16), basicMat('#f472b6', 0.95));
    nose.position.set(s * 0.32, 1.67, 0.32);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.28, 0.03), rocketSkinMat);
    fin.position.set(s * 0.45, 0.92, 0.32);
    fin.rotation.z = s * 0.25;
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.2, 14), darkMetalMat);
    bell.position.set(s * 0.32, 0.68, 0.32);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.46, 12), basicMat('#38bdf8', 0.92));
    plume.rotation.x = Math.PI;
    plume.position.set(s * 0.32, 0.38, 0.32);
    plume.userData.isAfterburner = true;
    g9.add(tank, nose, fin, bell, plume);
  }

  // Orbiting Miniature Gold-Foil CubeSat with Gridded Solar Panels & Comms Dish
  const satOrbit = new THREE.Group();
  satOrbit.position.set(0, 1.35, 0);
  satOrbit.userData.orbitGroup = true;
  const satTrack = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.018, 8, 32), basicMat('#f472b6', 0.65));
  satTrack.rotation.x = Math.PI / 2.2;
  const satBus = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), goldFoilMat);
  satBus.position.set(0.92, 0, 0);
  const satWings = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.025, 0.18), solarSkinMat);
  satWings.position.set(0.92, 0, 0);
  const satDish = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.08, 12, 1, true), chromeMat);
  satDish.position.set(0.92, 0.14, 0);
  satOrbit.add(satTrack, satBus, satWings, satDish);
  g9.add(satOrbit);

  const list: [CenterId, THREE.Group][] = [
    [1, g1], [2, g2], [3, g3], [4, g4], [5, g5], [6, g6], [7, g7], [8, g8], [9, g9],
  ];
  for (const [id, grp] of list) {
    grp.visible = false;
    attachments[id] = grp;
  }
  return attachments;
}

export function updateCenterAttachments(
  attachments: Record<CenterId, THREE.Group>,
  centerId: CenterId | null,
  time: number,
) {
  for (let id = 1 as CenterId; id <= 9; id = (id + 1) as CenterId) {
    const grp = attachments[id];
    if (!grp) continue;
    const active = centerId === id;
    grp.visible = active;
    if (!active) continue;

    if (id === 1) {
      grp.position.y = Math.sin(time * 18) * 0.022;
    }

    grp.traverse((o) => {
      const ud = o.userData;
      if (!ud) return;
      if (ud.isAfterburner) {
        const flicker = 0.88 + Math.sin(time * 38) * 0.16;
        o.scale.set(1, flicker, 1);
      } else if (ud.isRotor) {
        o.rotation.y = time * 26;
      } else if (ud.droneSide) {
        const s = ud.droneSide as number;
        o.position.y = 1.52 + Math.sin(time * 5.5 + s) * 0.08;
        o.rotation.z = Math.sin(time * 4.2 + s) * 0.1;
      } else if (ud.spinZ) {
        o.rotation.z = time * 6.5;
      } else if (ud.spinY) {
        o.rotation.y = time * 3.6;
      } else if (ud.orbitGroup) {
        o.rotation.y = time * 2.8;
      } else if (ud.magnetSide) {
        const s = ud.magnetSide as number;
        o.position.y = 1.15 + Math.sin(time * 6 + s) * 0.06;
      } else if (ud.isFluxArc) {
        const pulse = 0.82 + Math.sin(time * 22) * 0.24;
        o.scale.set(pulse, pulse, 1);
      } else if (ud.isMedDrone) {
        o.position.y = 1.68 + Math.sin(time * 4.8) * 0.08;
        o.rotation.z = Math.cos(time * 3.5) * 0.08;
      }
    });
  }
}
