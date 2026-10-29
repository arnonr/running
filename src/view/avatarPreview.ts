// Live 3D Character Preview Stage & 3D Portrait Baker reusing the single WebGLRenderer via viewport/scissor.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  AVATARS,
  AVATAR_LIST,
  applyAvatarToCharacter,
  updateAvatarMotion,
  sanitizeAvatarId,
  type AvatarId,
} from './avatars';
import type { Screen } from '../ui';

export type AvatarPortraits = Partial<Record<AvatarId, string>>;

export type PreviewRendererLike = Pick<
  THREE.WebGLRenderer,
  'domElement' | 'getPixelRatio' | 'getSize' | 'setViewport' | 'setScissor' | 'setScissorTest' | 'render'
>;

/**
 * Strictly gates the live 3D preview pass to the mobile/desktop character-selection form
 * (`#s-start` before `lobbyReady`), guaranteeing zero extra draw calls during gameplay,
 * lobby waiting, countdown, pause, game-over, or TV mode (`?mode=tv`).
 */
export function shouldRenderAvatarPreview(opts: {
  isTvMode: boolean;
  screen: Screen;
  lobbyReady: boolean;
}): boolean {
  return !opts.isTvMode && opts.screen === 'start' && !opts.lobbyReady;
}

export class AvatarPreviewStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(44, 1, 0.15, 20);

  private turntable = new THREE.Group();
  private character: THREE.Object3D;
  private pedestal: THREE.Mesh;
  private auraRing: THREE.Mesh;
  private rimLight: THREE.PointLight;
  private mixer: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private currentClip: string | null = null;

  private avatarId: AvatarId = 'non';
  private auraColor = '#38bdf8';
  private baseYaw = -0.22;
  private userYaw = 0;
  private swayYaw = 0;
  private dragCooldown = 0;
  private time = 0;
  private portraitFraming = false;
  private fullSizeTmp = new THREE.Vector2();

  constructor(source: { scene: THREE.Object3D; animations?: THREE.AnimationClip[] }) {
    this.scene.background = new THREE.Color('#0b1324');

    // Studio 3-point lighting so hair, outfits, visors, and astronaut helmet pop cleanly
    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 1.75);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.35);
    keyLight.position.set(2.4, 3.8, 3.6);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbae6fd, 0.95);
    fillLight.position.set(-2.6, 2.0, 2.2);
    this.scene.add(fillLight);

    this.rimLight = new THREE.PointLight(0x38bdf8, 2.4, 8);
    this.rimLight.position.set(-1.3, 1.9, -1.6);
    this.scene.add(this.rimLight);

    // Circular studio pedestal + glowing aura ring under runner feet
    const pedGeo = new THREE.CylinderGeometry(0.68, 0.76, 0.1, 28);
    const pedMat = new THREE.MeshLambertMaterial({ color: 0x1e293b, emissive: 0x090d16 });
    this.pedestal = new THREE.Mesh(pedGeo, pedMat);
    this.pedestal.position.y = -0.05;
    this.scene.add(this.pedestal);

    const ringGeo = new THREE.RingGeometry(0.5, 0.68, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.auraRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.auraRing.position.y = 0.012;
    this.scene.add(this.auraRing);

    // Clone 'player' before or after World construction without mutating the source hierarchy
    const srcNode = source.scene.getObjectByName('player') ?? source.scene;
    this.character = cloneSkinned(srcNode);
    this.character.position.set(0, 0, 0);
    this.character.rotation.set(0, 0, 0);
    this.character.scale.set(1, 1, 1);
    this.character.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = false;
        m.frustumCulled = false;
      }
    });

    this.turntable.rotation.y = this.baseYaw;
    this.turntable.add(this.character);
    this.scene.add(this.turntable);

    this.mixer = new THREE.AnimationMixer(this.character);
    for (const clip of source.animations ?? []) {
      const action = this.mixer.clipAction(clip);
      if (['jump', 'jumpup', 'roll', 'die', 'runlookback'].includes(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[clip.name] = action;
    }

    this.mixer.addEventListener('finished', () => {
      if (this.currentClip !== 'idle') {
        this.playClip('idle', 0.18);
      }
    });

    this.playClip('idle', 0);
    this.mixer.update(0.016);
    this.applyCameraFraming(1);
    this.setAvatar('non');
  }

  private playClip(name: string, fade = 0.14) {
    const next = this.actions[name];
    if (!next) return;
    if (this.currentClip === name && next.isRunning()) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    const prev = this.currentClip ? this.actions[this.currentClip] : null;
    if (prev && prev !== next) prev.fadeOut(fade);
    this.currentClip = name;
  }

  private applyCameraFraming(aspect: number) {
    this.camera.aspect = Math.max(0.4, aspect || 1);
    if (this.portraitFraming) {
      this.camera.fov = 36;
      this.camera.position.set(0.14, 1.5, 1.44);
      this.camera.lookAt(0, 1.46, 0);
    } else {
      this.camera.fov = 44;
      this.camera.position.set(0, 1.05, 2.85);
      this.camera.lookAt(0, 0.95, 0);
    }
    this.camera.updateProjectionMatrix();
  }

  setAvatar(rawAvatarId: AvatarId): void {
    const nextId = sanitizeAvatarId(rawAvatarId);
    this.avatarId = nextId;
    applyAvatarToCharacter(this.character, nextId);
    this.rimLight.color.set(AVATARS[nextId].accentHex);
    updateAvatarMotion(this.character, this.time, false);
  }

  setAuraColor(hex: string): void {
    this.auraColor = hex || '#38bdf8';
    const mat = this.auraRing.material as THREE.MeshBasicMaterial;
    mat.color.set(this.auraColor);
  }

  triggerCelebratePose(): void {
    if (this.actions.jump) {
      const jump = this.actions.jump;
      jump.stop();
      this.currentClip = null;
      this.playClip('jump', 0.08);
    } else if (this.actions.jumpup) {
      this.actions.jumpup.stop();
      this.currentClip = null;
      this.playClip('jumpup', 0.08);
    }
  }

  rotateBy(deltaRad: number): void {
    if (!Number.isFinite(deltaRad)) return;
    this.userYaw += deltaRad;
    this.swayYaw = 0;
    this.dragCooldown = 2.5;
    this.turntable.rotation.y = this.baseYaw + this.userYaw;
  }

  getTurntableYaw(): number {
    return this.turntable.rotation.y;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.mixer.update(dt);
    const isJumping = this.currentClip === 'jump' || this.currentClip === 'jumpup';
    updateAvatarMotion(this.character, this.time, isJumping);

    if (this.dragCooldown > 0) {
      this.dragCooldown = Math.max(0, this.dragCooldown - dt);
    } else {
      const targetSway = Math.sin(this.time * 1.15) * 0.16;
      this.swayYaw += (targetSway - this.swayYaw) * Math.min(1, dt * 4);
    }
    this.turntable.rotation.y = this.baseYaw + this.userYaw + this.swayYaw;

    const pulse = 1 + Math.sin(this.time * 3.6) * 0.04;
    this.auraRing.scale.set(pulse, pulse, 1);
  }

  /**
   * Renders the studio preview into a scissored top-left sub-viewport of the shared WebGLRenderer,
   * blits it onto `targetCanvas`, and unconditionally restores full viewport + `setScissorTest(false)`.
   */
  renderToCanvas(
    renderer: PreviewRendererLike,
    targetCanvas: HTMLCanvasElement | null,
    dt: number,
  ): boolean {
    if (!targetCanvas) return false;

    renderer.getSize(this.fullSizeTmp);
    const fullW = this.fullSizeTmp.x;
    const fullH = this.fullSizeTmp.y;
    if (fullW < 16 || fullH < 16) return false;

    const pr = Math.max(1, renderer.getPixelRatio() || 1);
    const hasClientSize = targetCanvas.clientWidth > 0 && targetCanvas.clientHeight > 0;
    const hasBitmapOnlySize =
      !hasClientSize && targetCanvas.width > 0 && targetCanvas.height > 0;
    if (!hasClientSize && !hasBitmapOnlySize) return false;

    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return false;

    let cssW: number;
    let cssH: number;
    if (hasClientSize) {
      cssW = Math.min(fullW, Math.max(16, Math.floor(targetCanvas.clientWidth)));
      cssH = Math.min(fullH, Math.max(16, Math.floor(targetCanvas.clientHeight)));
      const desiredW = Math.max(1, Math.floor(cssW * pr));
      const desiredH = Math.max(1, Math.floor(cssH * pr));
      if (targetCanvas.width !== desiredW || targetCanvas.height !== desiredH) {
        targetCanvas.width = desiredW;
        targetCanvas.height = desiredH;
      }
    } else {
      cssW = Math.min(fullW, targetCanvas.width / pr);
      cssH = Math.min(fullH, targetCanvas.height / pr);
    }

    if (cssW <= 0 || cssH <= 0) return false;

    if (dt > 0) this.step(dt);
    this.applyCameraFraming(cssW / cssH);

    const vpY = Math.max(0, fullH - cssH);
    try {
      renderer.setViewport(0, vpY, cssW, cssH);
      renderer.setScissor(0, vpY, cssW, cssH);
      renderer.setScissorTest(true);
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, fullW, fullH);
    }

    const glY = Math.floor(vpY * pr);
    const glW = Math.max(1, Math.floor(cssW * pr));
    const glH = Math.max(1, Math.floor(cssH * pr));
    const domH = renderer.domElement.height || Math.floor(fullH * pr);
    const sy = Math.max(0, domH - (glY + glH));

    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.drawImage(
      renderer.domElement,
      0,
      sy,
      glW,
      glH,
      0,
      0,
      targetCanvas.width,
      targetCanvas.height,
    );
    return true;
  }

  /**
   * Captures 5 crisp 3D head-and-shoulders portrait data URLs (`non`, `may`, `praw`, `kin`, `sky`)
   * once at startup using the shared WebGLRenderer, then restores the active preview state.
   */
  capturePortraits(renderer: PreviewRendererLike, size = 112): AvatarPortraits {
    if (typeof document === 'undefined') return {};

    const scratch = document.createElement('canvas');
    scratch.width = size;
    scratch.height = size;

    const prevAvatar = this.avatarId;
    const prevUserYaw = this.userYaw;
    const prevSwayYaw = this.swayYaw;
    const prevCooldown = this.dragCooldown;
    const prevPedestalVis = this.pedestal.visible;
    const prevAuraVis = this.auraRing.visible;

    const portraits: AvatarPortraits = {};
    try {
      this.portraitFraming = true;
      this.pedestal.visible = false;
      this.auraRing.visible = false;

      for (const meta of AVATAR_LIST) {
        this.setAvatar(meta.id);
        for (const action of Object.values(this.actions)) action.stop();
        this.currentClip = null;
        if (this.actions.idle) {
          this.actions.idle.reset().setEffectiveWeight(1).play();
          this.currentClip = 'idle';
          this.mixer.setTime(0.25);
        }
        updateAvatarMotion(this.character, 0.25, false);
        this.turntable.rotation.y = -0.24;

        if (this.renderToCanvas(renderer, scratch, 0)) {
          portraits[meta.id] = scratch.toDataURL('image/png');
        }
      }
    } finally {
      this.portraitFraming = false;
      this.pedestal.visible = prevPedestalVis;
      this.auraRing.visible = prevAuraVis;
      this.userYaw = prevUserYaw;
      this.swayYaw = prevSwayYaw;
      this.dragCooldown = prevCooldown;
      this.setAvatar(prevAvatar);
      this.setAuraColor(this.auraColor);
      for (const action of Object.values(this.actions)) action.stop();
      this.currentClip = null;
      this.playClip('idle', 0);
      this.mixer.update(0.016);
      this.turntable.rotation.y = this.baseYaw + this.userYaw + this.swayYaw;
      this.applyCameraFraming(1);
    }

    return portraits;
  }
}
