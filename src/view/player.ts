// The runner: the skinned model from core.glb, its clips mixed by game state, plus 9-Center 3D attachments.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Sim } from '../sim/sim';
import type { SimEvent, CenterId } from '../sim/types';
import { PLAYER, JUMP_V, SUPER_JUMP_V, GRAVITY, laneX, CENTERS } from '../config';

type Clip = 'idle' | 'run' | 'jump' | 'jumpup' | 'fall' | 'roll' | 'die' | 'runlookback';

export class PlayerView {
  root = new THREE.Group();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions = {} as Record<Clip, THREE.AnimationAction>;
  current: Clip | null = null;
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

    this.buildCenterAttachments();
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

  private buildCenterAttachments() {
    const mat = (hex: string, opacity = 0.85, wireframe = false) =>
      new THREE.MeshBasicMaterial({ color: hex, transparent: opacity < 1, opacity, wireframe });

    // #1 Jet Fighter Pack: sleek swept-back delta wings + central jet fuselage + twin tail fins + glowing afterburners
    const g1 = new THREE.Group();
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0.45);
    wingShape.lineTo(1.25, -0.25);
    wingShape.lineTo(1.15, -0.45);
    wingShape.lineTo(0, -0.1);
    wingShape.lineTo(-1.15, -0.45);
    wingShape.lineTo(-1.25, -0.25);
    wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.06, bevelEnabled: false });
    wingGeo.rotateX(Math.PI / 2);
    const wing = new THREE.Mesh(wingGeo, mat('#38bdf8', 0.92));
    wing.position.set(0, 1.2, 0.22);

    const podGeo = new THREE.CylinderGeometry(0.11, 0.14, 0.75, 10);
    podGeo.rotateX(Math.PI / 2);
    for (const s of [-1, 1]) {
      const pod = new THREE.Mesh(podGeo, mat('#0ea5e9', 0.95));
      pod.position.set(s * 0.34, 1.15, 0.25);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.32), mat('#e0f2fe', 0.95));
      fin.position.set(s * 0.34, 1.38, 0.38);
      fin.rotation.z = -s * 0.22;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.55, 10), mat('#f97316', 0.92));
      flame.rotation.x = Math.PI / 2;
      flame.position.set(s * 0.34, 1.15, 0.78);
      g1.add(pod, fin, flame);
    }
    g1.add(wing);

    // #2 Robo-Wingman Drones: two hovering companion drones Left & Right
    const g2 = new THREE.Group();
    for (const s of [-1, 1]) {
      const drone = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat('#fb923c', 0.92));
      drone.position.set(s * 1.15, 1.45, -0.2);
      const rotor = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.36, 16), mat('#fde047', 0.75));
      rotor.rotation.x = Math.PI / 2;
      rotor.position.set(s * 1.15, 1.72, -0.2);
      g2.add(drone, rotor);
    }

    // #3 EV Express Train Armor: glowing V-shaped front ram + side rails
    const g3 = new THREE.Group();
    const plow = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.4, 4), mat('#facc15', 0.65));
    plow.rotation.x = -Math.PI / 2;
    plow.rotation.z = Math.PI / 4;
    plow.position.set(0, 0.95, -0.65);
    g3.add(plow);

    // #4 Green Energy Shield: geodesic protective sphere around runner
    const g4 = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(1.18, 1), mat('#4ade80', 0.42, true));
    dome.position.set(0, 1.0, 0);
    g4.add(dome);

    // #5 5G Super Magnet: expanding purple 5G signal rings overhead
    const g5 = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.45 + i * 0.25, 0.03, 8, 24), mat('#c084fc', 0.8 - i * 0.18));
      r.rotation.x = Math.PI / 2;
      r.position.set(0, 1.85 + i * 0.18, 0);
      g5.add(r);
    }

    // #6 Radar Path Scanner: rotating radar dish + sweep cone ahead
    const g6 = new THREE.Group();
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.12, 0.18, 16), mat('#2dd4bf', 0.85));
    dish.position.set(0, 2.05, 0);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.4, 12, 1, true), mat('#2dd4bf', 0.28));
    beam.rotation.x = Math.PI / 2;
    beam.position.set(0, 1.0, -1.4);
    g6.add(dish, beam);

    // #7 Bio-Chem Bouncer Boots: glowing lime-green DNA rings around legs
    const g7 = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const bootRing = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.05, 8, 20), mat('#a3e635', 0.88));
      bootRing.rotation.x = Math.PI / 2;
      bootRing.position.set(0, 0.25 + i * 0.35, 0);
      g7.add(bootRing);
    }

    // #8 Med-Tech Recovery Drone: orbiting rose-pink medical cross halo
    const g8 = new THREE.Group();
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.16), mat('#fb7185', 0.95));
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), mat('#fb7185', 0.95));
    bar1.position.set(0, 2.15, 0);
    bar2.position.set(0, 2.15, 0);
    g8.add(bar1, bar2);

    // #9 Space Rocket Fever: twin pink-magenta space boosters + star halo
    const g9 = new THREE.Group();
    for (const s of [-1, 1]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.85, 10), mat('#f472b6', 0.92));
      tank.position.set(s * 0.32, 1.15, 0.32);
      g9.add(tank);
    }
    const starRing = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.04, 8, 24), mat('#f472b6', 0.75));
    starRing.position.set(0, 1.1, 0);
    g9.add(starRing);

    const list: [CenterId, THREE.Group][] = [
      [1, g1], [2, g2], [3, g3], [4, g4], [5, g5], [6, g6], [7, g7], [8, g8], [9, g9],
    ];
    for (const [id, grp] of list) {
      grp.visible = false;
      this.attachments[id] = grp;
      this.root.add(grp);
    }
  }

  setCenterEffect(centerId: CenterId | null, time: number) {
    for (let id = 1 as CenterId; id <= 9; id = (id + 1) as CenterId) {
      const grp = this.attachments[id];
      if (!grp) continue;
      const active = centerId === id;
      grp.visible = active;
      if (active) {
        if (id === 2 || id === 4 || id === 6 || id === 8) {
          grp.rotation.y = time * 3.2;
        } else if (id === 5) {
          grp.position.y = Math.sin(time * 8) * 0.08;
        } else if (id === 9) {
          grp.children[2].rotation.z = time * 4;
        }
      }
    }
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
  }
}
