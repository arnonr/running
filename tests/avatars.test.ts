import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
  AVATAR_LIST,
  AVATARS,
  sanitizeAvatarId,
  filterBodyGeometryIslands,
  applyAvatarToCharacter,
  updateAvatarMotion,
  type AvatarId,
} from '../src/view/avatars';
import { MatchRoomCore } from '../src/net';
import {
  AvatarPreviewStage,
  shouldRenderAvatarPreview,
} from '../src/view/avatarPreview';
import { describeAvatarShowcase } from '../src/ui';

describe('5-Character Selection System (Avatars)', () => {
  it('defines 5 distinct avatars including female characters with cap & backpack removal flags', () => {
    expect(AVATAR_LIST).toHaveLength(5);
    const ids = AVATAR_LIST.map((a) => a.id);
    expect(ids).toEqual(['non', 'may', 'praw', 'kin', 'sky']);

    expect(AVATARS.non.removeCap).toBe(false);
    expect(AVATARS.non.removeBackpack).toBe(false);

    expect(AVATARS.may.removeCap).toBe(true);
    expect(AVATARS.may.removeBackpack).toBe(true);
    expect(AVATARS.may.genderLabelTh).toContain('หญิง');

    expect(AVATARS.praw.removeCap).toBe(true);
    expect(AVATARS.praw.removeBackpack).toBe(true);
    expect(AVATARS.praw.genderLabelTh).toContain('หญิง');
  });

  it('sanitizes invalid or legacy avatar values safely to "non"', () => {
    expect(sanitizeAvatarId('may')).toBe('may');
    expect(sanitizeAvatarId('praw')).toBe('praw');
    expect(sanitizeAvatarId('kin')).toBe('kin');
    expect(sanitizeAvatarId('sky')).toBe('sky');
    expect(sanitizeAvatarId('')).toBe('non');
    expect(sanitizeAvatarId(undefined)).toBe('non');
    expect(sanitizeAvatarId(null)).toBe('non');
    expect(sanitizeAvatarId('unknown-hero')).toBe('non');
  });

  it('filters cap and backpack mesh islands from a BufferGeometry while keeping torso/head islands intact', () => {
    // Build a synthetic geometry with 3 disconnected triangle islands:
    // Island 0 (Torso): y in [0.8, 1.3], z in [-0.05, 0.05]
    // Island 1 (Cap dome): y in [1.6, 1.85], z in [-0.2, 0.2] (140 verts in real mesh; here a high-y cap island)
    // Island 2 (Backpack): y in [0.9, 1.25], z in [-0.28, -0.15] (back of torso, z < -0.12)
    const positions = new Float32Array([
      // Island 0: torso triangle (indices 0,1,2)
      0, 1.0, 0,
      0.1, 1.1, 0,
      -0.1, 1.1, 0,
      // Island 1: cap dome triangle (indices 3,4,5) -> minY >= 1.44 & maxY >= 1.62
      0, 1.56, -0.21,
      0.1, 1.84, 0.22,
      -0.1, 1.75, 0.0,
      // Island 2: backpack triangle (indices 6,7,8) -> minY >= 0.85, maxY <= 1.38, maxZ <= -0.075
      0, 0.92, -0.28,
      0.1, 1.24, -0.14,
      -0.1, 1.15, -0.18,
    ]);
    const indices = new Uint16Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    baseGeo.setIndex(new THREE.BufferAttribute(indices, 1));

    const keptAll = filterBodyGeometryIslands(baseGeo, { removeCap: false, removeBackpack: false });
    expect(keptAll.index!.count).toBe(9);

    const stripped = filterBodyGeometryIslands(baseGeo, { removeCap: true, removeBackpack: true });
    // Only Island 0 (3 indices) should remain!
    expect(stripped.index!.count).toBe(3);
    expect(Array.from(stripped.index!.array)).toEqual([0, 1, 2]);
  });

  it('attaches bone-rigged 3D costumes without stacking duplicates on repeated applyAvatarToCharacter calls', () => {
    const root = new THREE.Group();
    const head = new THREE.Bone();
    head.name = 'mixamorig:Head';
    const hips = new THREE.Bone();
    hips.name = 'mixamorig:Hips';
    const spine2 = new THREE.Bone();
    spine2.name = 'mixamorig:Spine2';
    const lShoulder = new THREE.Bone();
    lShoulder.name = 'mixamorig:LeftShoulder';
    const rShoulder = new THREE.Bone();
    rShoulder.name = 'mixamorig:RightShoulder';
    root.add(head, hips, spine2, lShoulder, rShoulder);

    for (const id of ['may', 'praw', 'kin', 'sky', 'non', 'may'] as AvatarId[]) {
      applyAvatarToCharacter(root, id);
      updateAvatarMotion(root, 1.25, true);
    }

    const headCostumes = head.children.filter((c) => c.userData.isAvatarCostume);
    const hipCostumes = hips.children.filter((c) => c.userData.isAvatarCostume);
    expect(headCostumes).toHaveLength(1);
    expect(hipCostumes).toHaveLength(1);
  });

  it('syncs avatar across MatchRoomCore join, waitingQueue promotion, and 5 demo bots', () => {
    const room = new MatchRoomCore();
    room.addDemoBots(5);
    const snap1 = room.getSnapshot();
    const botAvatars = new Set(snap1.activeRunners.map((r) => r.avatar));
    expect(botAvatars.size).toBe(5);

    room.join({
      id: 'p-female',
      name: 'น้องเมย์',
      role: 'senior',
      color: '#ec4899',
      avatar: 'may',
    });
    const snap2 = room.getSnapshot();
    const playerRunner = snap2.activeRunners.find((r) => r.id === 'p-female');
    expect(playerRunner?.avatar).toBe('may');
  });

  it('gates live 3D avatar preview strictly to mobile/desktop start form before lobbyReady', () => {
    expect(shouldRenderAvatarPreview({ isTvMode: false, screen: 'start', lobbyReady: false })).toBe(true);
    expect(shouldRenderAvatarPreview({ isTvMode: false, screen: 'start', lobbyReady: true })).toBe(false);
    expect(shouldRenderAvatarPreview({ isTvMode: false, screen: 'play', lobbyReady: false })).toBe(false);
    expect(shouldRenderAvatarPreview({ isTvMode: true, screen: 'start', lobbyReady: false })).toBe(false);
  });

  it('updates AvatarPreviewStage avatar, aura color, drag yaw, and restores renderer viewport & scissor cleanly', () => {
    const mockScene = new THREE.Group();
    const playerNode = new THREE.Group();
    playerNode.name = 'player';
    const head = new THREE.Bone();
    head.name = 'mixamorig:Head';
    const hips = new THREE.Bone();
    hips.name = 'mixamorig:Hips';
    playerNode.add(head, hips);
    mockScene.add(playerNode);

    const stage = new AvatarPreviewStage({ scene: mockScene, animations: [] });
    stage.setAvatar('may');
    stage.setAuraColor('#ec4899');
    const yaw0 = stage.getTurntableYaw();
    stage.rotateBy(0.65);
    expect(stage.getTurntableYaw()).toBeCloseTo(yaw0 + 0.65, 4);

    const calls: string[] = [];
    let scissorActive = false;
    let lastViewport = [0, 0, 0, 0];
    const fakeRenderer = {
      domElement: { width: 800, height: 600 } as unknown as HTMLCanvasElement,
      getPixelRatio: () => 2,
      getSize: (v: THREE.Vector2) => v.set(400, 300),
      setViewport: (x: number, y: number, w: number, h: number) => {
        lastViewport = [x, y, w, h];
        calls.push(`vp:${x},${y},${w},${h}`);
      },
      setScissor: (x: number, y: number, w: number, h: number) => {
        calls.push(`sc:${x},${y},${w},${h}`);
      },
      setScissorTest: (on: boolean) => {
        scissorActive = on;
        calls.push(`sct:${on}`);
      },
      render: () => {
        calls.push('render');
      },
    };
    const fakeTarget = {
      width: 140,
      height: 150,
      clientWidth: 140,
      clientHeight: 150,
      getContext: () => ({ clearRect: () => {}, drawImage: () => calls.push('drawImage') }),
    } as unknown as HTMLCanvasElement;

    const ok = stage.renderToCanvas(fakeRenderer as any, fakeTarget, 1 / 60);
    expect(ok).toBe(true);
    expect(calls).toContain('render');
    expect(calls).toContain('drawImage');
    expect(scissorActive).toBe(false);
    expect(lastViewport).toEqual([0, 0, 400, 300]);

    // Zero-size and null target canvases must return false without leaving scissor enabled
    const zeroTarget = {
      width: 0,
      height: 0,
      clientWidth: 0,
      clientHeight: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    expect(stage.renderToCanvas(fakeRenderer as any, zeroTarget, 1 / 60)).toBe(false);
    expect(stage.renderToCanvas(fakeRenderer as any, null, 1 / 60)).toBe(false);
    expect(scissorActive).toBe(false);
  });

  it('builds live showcase metadata reflecting selected avatar, custom nickname, role, aura color, and portrait URL', () => {
    const vm = describeAvatarShowcase(
      { id: 'p1', name: 'น้องเมย์', role: 'senior', color: '#ec4899', avatar: 'may' },
      { may: 'data:image/png;base64,AAA' },
    );
    expect(vm.avatarId).toBe('may');
    expect(vm.titleTh).toContain('เมย์');
    expect(vm.badgeTh).toContain('หญิง');
    expect(vm.playerLabelTh).toContain('น้องเมย์');
    expect(vm.playerLabelTh).toContain('ม.ปลาย');
    expect(vm.auraHex).toBe('#ec4899');
    expect(vm.portraitUrl).toBe('data:image/png;base64,AAA');
  });

  it('preserves GLTF player Armature rotation (π/2 X) and cm-to-meter scale (0.01) so character stays ~1.8m upright', () => {
    const mockScene = new THREE.Group();
    const playerNode = new THREE.Group();
    playerNode.name = 'player';
    playerNode.rotation.set(Math.PI / 2, 0, 0);
    playerNode.scale.set(0.01, 0.01, 0.01);
    playerNode.position.set(3, 4, 5);

    // In Mixamo Z-up cm space (rotated +π/2 around X -> local -Z maps to world +Y):
    // A 180cm mesh centered at local z = -90 spans local z ∈ [-180, 0] -> world y ∈ [0, 1.80]m
    const bodyGeo = new THREE.BoxGeometry(50, 30, 180);
    bodyGeo.translate(0, 0, -90);
    const bodyMesh = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial());
    playerNode.add(bodyMesh);
    mockScene.add(playerNode);

    const stage = new AvatarPreviewStage({ scene: mockScene, animations: [] });
    stage.scene.updateMatrixWorld(true);

    let clonedMesh: THREE.Mesh | null = null;
    stage.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry === bodyGeo) {
        clonedMesh = o as THREE.Mesh;
      }
    });
    expect(clonedMesh).not.toBeNull();
    const box = new THREE.Box3().setFromObject(clonedMesh!);
    const heightMeters = box.max.y - box.min.y;
    expect(heightMeters).toBeGreaterThan(1.7);
    expect(heightMeters).toBeLessThan(1.9);
    expect(box.min.y).toBeCloseTo(0, 2);
  });

  it('fades out idle clip when triggerCelebratePose plays jump instead of blending idle at full weight', () => {
    const mockScene = new THREE.Group();
    const playerNode = new THREE.Group();
    playerNode.name = 'player';
    mockScene.add(playerNode);

    const idleClip = new THREE.AnimationClip('idle', 1.0, [
      new THREE.NumberKeyframeTrack('.position[y]', [0, 1], [0, 0]),
    ]);
    const jumpClip = new THREE.AnimationClip('jump', 0.8, [
      new THREE.NumberKeyframeTrack('.position[y]', [0, 0.4, 0.8], [0, 0.5, 0]),
    ]);

    const stage = new AvatarPreviewStage({ scene: mockScene, animations: [idleClip, jumpClip] });
    stage.triggerCelebratePose();
    // Advance past the 0.08s cross-fade window while still mid-jump (< 0.8s)
    stage.step(0.15);

    const actions = (stage as any).actions as Record<string, THREE.AnimationAction>;
    expect(actions.jump.getEffectiveWeight()).toBeGreaterThan(0.95);
    expect(actions.idle.getEffectiveWeight()).toBeLessThan(0.05);
  });

  it('aligns drawImage source rectangle accurately when renderer pixelRatio is below 1 (zoomed-out browser)', () => {
    const mockScene = new THREE.Group();
    const stage = new AvatarPreviewStage({ scene: mockScene, animations: [] });

    let drawArgs: number[] = [];
    const fakeRenderer = {
      domElement: { width: 300, height: 225 } as unknown as HTMLCanvasElement,
      getPixelRatio: () => 0.75,
      getSize: (v: THREE.Vector2) => v.set(400, 300),
      setViewport: () => {},
      setScissor: () => {},
      setScissorTest: () => {},
      render: () => {},
    };
    const fakeTarget = {
      width: 120,
      height: 140,
      clientWidth: 120,
      clientHeight: 140,
      getContext: () => ({
        clearRect: () => {},
        drawImage: (_img: unknown, sx: number, sy: number, sw: number, sh: number) => {
          drawArgs = [sx, sy, sw, sh];
        },
      }),
    } as unknown as HTMLCanvasElement;

    expect(stage.renderToCanvas(fakeRenderer as any, fakeTarget, 0)).toBe(true);
    expect(drawArgs).toEqual([0, 0, 90, 105]);
  });

  it('skips redundant 3D bone-costume rebuilds when setAvatar is called repeatedly with the same avatarId', () => {
    const mockScene = new THREE.Group();
    const playerNode = new THREE.Group();
    playerNode.name = 'player';
    const head = new THREE.Bone();
    head.name = 'mixamorig:Head';
    playerNode.add(head);
    mockScene.add(playerNode);

    const stage = new AvatarPreviewStage({ scene: mockScene, animations: [] });
    stage.setAvatar('may');

    let clonedHead: THREE.Object3D | null = null;
    stage.scene.traverse((o) => {
      if (o.name === 'mixamorig:Head') clonedHead = o;
    });
    expect(clonedHead).not.toBeNull();
    const firstCostume = clonedHead!.children.find((c) => c.userData.isAvatarCostume);
    expect(firstCostume).toBeDefined();

    // Repeated call with same avatarId (e.g., on nickname input / aura color click) must keep exact instance
    stage.setAvatar('may');
    const secondCostume = clonedHead!.children.find((c) => c.userData.isAvatarCostume);
    expect(secondCostume).toBe(firstCostume);

    // Switching to a different avatarId must attach the new avatar's costume
    stage.setAvatar('praw');
    const thirdCostume = clonedHead!.children.find((c) => c.userData.isAvatarCostume);
    expect(thirdCostume).toBeDefined();
    expect(thirdCostume).not.toBe(firstCostume);
  });

  it('constrains .avatar-card and .av-thumb fluidly in index.html so 5 cards do not overflow 360px mobile panels', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    const cardMatch = html.match(/\.avatar-card\s*\{[^}]*\}/);
    const thumbMatch = html.match(/\.avatar-card\s+\.av-thumb\s*\{[^}]*\}/);
    expect(cardMatch?.[0]).toContain('min-width: 0');
    expect(thumbMatch?.[0]).toContain('min(44px, 100%)');
    expect(thumbMatch?.[0]).toContain('aspect-ratio: 1');
  });
});
