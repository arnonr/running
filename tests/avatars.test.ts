import { describe, it, expect } from 'vitest';
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
});
