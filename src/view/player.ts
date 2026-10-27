// The runner: the skinned model from core.glb, its clips mixed by game state, plus 9-Center 3D attachments.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Sim } from '../sim/sim';
import type { SimEvent, CenterId } from '../sim/types';
import { PLAYER, JUMP_V, SUPER_JUMP_V, GRAVITY, laneX, CENTERS } from '../config';
import { architecturalTowerSkinTexture, rocketHullSkinTexture } from './textures';
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
      auraMat.color.set('#38bdf8');
      auraMat.opacity = 0.45;
      this.auraRing.scale.set(1, 1, 1);
    }
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
  const rocketSkinMat = new THREE.MeshPhongMaterial({
    map: rocketHullSkinTexture('#f472b6'),
    shininess: 80,
  });

  // #1 Jet Fighter Pack: textured swept-back aerospace delta wings + central spine + twin turbine nacelles + dual-core afterburners
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

    const wingRail = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.52, 8), basicMat('#38bdf8', 0.95));
    wingRail.rotation.x = Math.PI / 2;
    wingRail.position.set(s * 1.25, 1.2, 0.52);

    const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.62, 14), basicMat('#f97316', 0.88));
    flameOuter.rotation.x = Math.PI / 2;
    flameOuter.position.set(s * 0.36, 1.15, 1.02);
    const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.38, 12), basicMat('#fef08a', 0.96));
    flameCore.rotation.x = Math.PI / 2;
    flameCore.position.set(s * 0.36, 1.15, 0.9);

    g1.add(pod, intakeRing, nozzle, fin, finTip, wingRail, flameOuter, flameCore);
  }

  // #2 Robo-Wingman Drones
  const g2 = new THREE.Group();
  const roboMat = new THREE.MeshPhongMaterial({
    map: architecturalTowerSkinTexture('#fb923c', '#facc15', '#0f172a'),
    shininess: 80,
  });
  for (const s of [-1, 1]) {
    const droneBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.26, 12), roboMat);
    droneBody.position.set(s * 1.15, 1.45, -0.2);
    const droneEye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), basicMat('#38bdf8', 0.95));
    droneEye.position.set(s * 1.15, 1.45, -0.38);
    const rotorGuard = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 20), darkMetalMat);
    rotorGuard.rotation.x = Math.PI / 2;
    rotorGuard.position.set(s * 1.15, 1.62, -0.2);
    const rotorDisc = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.32, 20), basicMat('#fde047', 0.78));
    rotorDisc.rotation.x = Math.PI / 2;
    rotorDisc.position.set(s * 1.15, 1.63, -0.2);
    g2.add(droneBody, droneEye, rotorGuard, rotorDisc);
  }

  // #3 EV Express Train Armor
  const g3 = new THREE.Group();
  const plow = new THREE.Mesh(new THREE.ConeGeometry(0.92, 1.35, 6), new THREE.MeshPhongMaterial({
    color: 0xfacc15,
    emissive: 0xa16207,
    transparent: true,
    opacity: 0.72,
    shininess: 100,
  }));
  plow.rotation.x = -Math.PI / 2;
  plow.position.set(0, 0.95, -0.68);
  const bumperArch = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.06, 10, 24, Math.PI), basicMat('#38bdf8', 0.95));
  bumperArch.rotation.x = Math.PI / 2;
  bumperArch.position.set(0, 0.65, -0.25);
  g3.add(plow, bumperArch);

  // #4 Green Energy Shield
  const g4 = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(1.18, 1), basicMat('#4ade80', 0.42, true));
  dome.position.set(0, 1.0, 0);
  const eqRing = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.04, 8, 28), basicMat('#10b981', 0.85));
  eqRing.rotation.x = Math.PI / 2.3;
  eqRing.position.set(0, 1.0, 0);
  g4.add(dome, eqRing);

  // #5 5G Super Magnet
  const g5 = new THREE.Group();
  const node5G = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), basicMat('#f0abfc', 0.95));
  node5G.position.set(0, 2.35, 0);
  g5.add(node5G);
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(0.45 + i * 0.25, 0.035, 8, 24),
      basicMat(i % 2 === 0 ? '#c084fc' : '#38bdf8', 0.85 - i * 0.16),
    );
    r.rotation.x = Math.PI / 2;
    r.position.set(0, 1.85 + i * 0.18, 0);
    g5.add(r);
  }

  // #6 Radar Path Scanner
  const g6 = new THREE.Group();
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.22, 20, 1, true), chromeMat);
  dish.position.set(0, 2.08, 0);
  const dishRim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.03, 8, 20), basicMat('#2dd4bf', 0.95));
  dishRim.rotation.x = Math.PI / 2;
  dishRim.position.set(0, 2.18, 0);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.4, 16, 1, true), basicMat('#2dd4bf', 0.28));
  beam.rotation.x = Math.PI / 2;
  beam.position.set(0, 1.0, -1.4);
  g6.add(dish, dishRim, beam);

  // #7 Bio-Chem Bouncer Boots
  const g7 = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const bootRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.045, 8, 24),
      basicMat(i % 2 === 0 ? '#a3e635' : '#2dd4bf', 0.9),
    );
    bootRing.rotation.x = Math.PI / 2 + (i - 1) * 0.18;
    bootRing.position.set(0, 0.22 + i * 0.26, 0);
    g7.add(bootRing);
  }

  // #8 Med-Tech Recovery Drone
  const g8 = new THREE.Group();
  const crossOuterV = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.14), chromeMat);
  const crossOuterH = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.14), chromeMat);
  const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.16, 0.18), basicMat('#fb7185', 0.95));
  const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.54, 0.18), basicMat('#fb7185', 0.95));
  const medHalo = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.03, 8, 24), basicMat('#fecdd3', 0.85));
  for (const m of [crossOuterV, crossOuterH, bar1, bar2, medHalo]) m.position.set(0, 2.18, 0);
  g8.add(crossOuterV, crossOuterH, bar1, bar2, medHalo);

  // #9 Space Rocket Fever
  const g9 = new THREE.Group();
  for (const s of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.85, 16), rocketSkinMat);
    tank.position.set(s * 0.34, 1.18, 0.32);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.32, 16), basicMat('#f472b6', 0.95));
    nose.position.set(s * 0.34, 1.76, 0.32);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 14), darkMetalMat);
    bell.position.set(s * 0.34, 0.68, 0.32);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.48, 12), basicMat('#38bdf8', 0.9));
    plume.rotation.x = Math.PI;
    plume.position.set(s * 0.34, 0.38, 0.32);
    g9.add(tank, nose, bell, plume);
  }
  const starRing = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.04, 8, 28), basicMat('#f472b6', 0.8));
  starRing.position.set(0, 1.15, 0);
  g9.add(starRing);

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
    if (active) {
      if (id === 1) {
        grp.position.y = Math.sin(time * 18) * 0.025;
      } else if (id === 2 || id === 4 || id === 6 || id === 8) {
        grp.rotation.y = time * 3.2;
      } else if (id === 5) {
        grp.position.y = Math.sin(time * 8) * 0.08;
      } else if (id === 9) {
        const lastChild = grp.children[grp.children.length - 1];
        if (lastChild) lastChild.rotation.z = time * 4;
      }
    }
  }
}
