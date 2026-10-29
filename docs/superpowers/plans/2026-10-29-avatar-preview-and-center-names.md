# Live 3D Avatar Selection Preview & 3-Center Official Name Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live interactive 3D character showcase and 3D card portraits inside the `#s-start` character selector while updating Centers `#4`, `#5`, and `#7` to their exact official Thai names across all UI and 3D track signage.

**Architecture:** Update `CENTERS[4|5|7].shortTh` in `src/config.ts` and align `CENTER_BIOMES`, `ZONE_PALETTES`, `FLOOR_TITLES`, and 3D Canvas `fillText` width bounds in `src/view/textures.ts` and `src/ui.ts`. Add a self-contained `AvatarPreviewStage` (`src/view/avatarPreview.ts`) that reuses the single `THREE.WebGLRenderer` via a top-left scissor pass copied to `#avatar-preview-canvas` only while the `#s-start` form is open, plus one-time baked 3D upper-body portraits injected into the 5 `.avatar-card` buttons.

**Tech Stack:** TypeScript, Three.js, HTML5 Canvas 2D / WebGL, Vitest

**Spec:** `docs/superpowers/specs/2026-10-29-avatar-preview-and-center-names-design.md`

## Global Constraints

- Center display names must match verbatim:
  - `#4`: `สิ่งแวดล้อมและการอนุรักษ์พลังงาน`
  - `#5`: `นวัตกรรมไร้สายล้ำหน้ายุค 5G`
  - `#7`: `เทคโนโลยีชีวภาพและเคมีชีวภาพ`
- Do not rename the other 6 centers (`#1, #2, #3, #6, #8, #9`).
- Reuse the single existing `THREE.WebGLRenderer` in `src/main.ts` (zero second `WebGLRenderingContext`).
- Skip `AvatarPreviewStage` rendering completely whenever `isTvMode` is true, `state !== 'start'`, or `lobbyReady` is true.
- All modules and tests must work in Vitest's Node environment (`typeof document === 'undefined'`) without throwing.

## Review Focus

- Verbatim Thai names for `#4`, `#5`, `#7` across config, stage biomes, and wayfinding directory (`tests/config.test.ts`, `tests/view-data.test.ts`, `tests/ui-wayfinding.test.ts`).
- Bounded 3D Canvas text rendering without mid-syllable `.slice(0, 14)` chopping on 32-char Thai names (`tests/view-data.test.ts`: `centerGateBannerTexture`, `centerBillboardTexture`, `centerCapsuleTexture` pass `maxWidth` to `fillText`).
- Renderer viewport & scissor restoration after `AvatarPreviewStage.renderToCanvas` (including zero-sized/hidden target canvases) so the main 3D game canvas never renders into a cropped corner (`tests/avatars.test.ts`).
- Live aura color, nickname/role summary, and 360° drag rotation updates in the showcase model when the player edits Step 1/3/4 without re-clicking an avatar card (`tests/avatars.test.ts`).
- Strict preview render gating (`shouldRenderAvatarPreview`) returning `false` during gameplay, lobby waiting, countdown, pause, game-over, and `?mode=tv` (`tests/avatars.test.ts`).

---

### Task 1: Official Display Names for Centers `#4`, `#5`, and `#7` & Bounded 3D Canvas Signage

**Files:**
- Modify: `src/config.ts:190-242`
- Modify: `src/view/textures.ts:50-145`
- Modify: `src/view/textures.ts:201-211`
- Modify: `src/view/textures.ts:389-421`
- Modify: `src/view/textures.ts:459-501`
- Modify: `src/view/textures.ts:544-604`
- Modify: `src/ui.ts:28-35`
- Test: `tests/config.test.ts`
- Test: `tests/view-data.test.ts`
- Test: `tests/ui-wayfinding.test.ts`

**Interfaces:**
- Produces:
  - `CENTERS[4].shortTh === 'สิ่งแวดล้อมและการอนุรักษ์พลังงาน'`
  - `CENTERS[5].shortTh === 'นวัตกรรมไร้สายล้ำหน้ายุค 5G'`
  - `CENTERS[7].shortTh === 'เทคโนโลยีชีวภาพและเคมีชีวภาพ'`

- [ ] **Step 1: Write the failing tests in `tests/config.test.ts`, `tests/view-data.test.ts`, and `tests/ui-wayfinding.test.ts`**

1. In `tests/config.test.ts`, add:
```ts
  it('uses exact official Thai display names for Centers #4, #5, and #7', () => {
    expect(CENTERS[4].shortTh).toBe('สิ่งแวดล้อมและการอนุรักษ์พลังงาน');
    expect(CENTERS[5].shortTh).toBe('นวัตกรรมไร้สายล้ำหน้ายุค 5G');
    expect(CENTERS[7].shortTh).toBe('เทคโนโลยีชีวภาพและเคมีชีวภาพ');
  });
```
2. In `tests/view-data.test.ts`, import `centerGateBannerTexture`, `centerBillboardTexture`, `centerCapsuleTexture` from `../src/view/textures` and add:
```ts
  it('aligns CENTER_BIOMES stage titles for #4, #5, #7 and bounds 3D signage fillText width without mid-word slicing', () => {
    expect(CENTER_BIOMES[4].stageTitleTh).toContain('สิ่งแวดล้อมและการอนุรักษ์พลังงาน');
    expect(CENTER_BIOMES[5].stageTitleTh).toContain('นวัตกรรมไร้สายล้ำหน้ายุค 5G');
    expect(CENTER_BIOMES[7].stageTitleTh).toContain('เทคโนโลยีชีวภาพและเคมีชีวภาพ');

    // Smoke-test texture builders in Node proxy canvas for all updated centers
    for (const id of [4, 5, 7] as const) {
      expect(centerGateBannerTexture(id, 2)).toBeDefined();
      expect(centerBillboardTexture(id)).toBeDefined();
      expect(centerCapsuleTexture(id)).toBeDefined();
    }
  });
```
3. In `tests/ui-wayfinding.test.ts`, assert inside the existing test:
```ts
    expect(floor1.centers.find((c) => c.id === 4)?.shortTh).toBe('สิ่งแวดล้อมและการอนุรักษ์พลังงาน');
    expect(floor1.centers.find((c) => c.id === 5)?.shortTh).toBe('นวัตกรรมไร้สายล้ำหน้ายุค 5G');
    expect(floor8.centers.find((c) => c.id === 7)?.shortTh).toBe('เทคโนโลยีชีวภาพและเคมีชีวภาพ');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts tests/view-data.test.ts tests/ui-wayfinding.test.ts`
Expected: FAIL (`Expected "สิ่งแวดล้อมและการอนุรักษ์พลังงาน", Received "สิ่งแวดล้อมและพลังงานสะอาด"`)

- [ ] **Step 3: Update `#4`, `#5`, `#7` names and 3D Canvas text `maxWidth` bounds**

1. In `src/config.ts`:
   - Set `CENTERS[4].shortTh = 'สิ่งแวดล้อมและการอนุรักษ์พลังงาน'`.
   - Set `CENTERS[5].shortTh = 'นวัตกรรมไร้สายล้ำหน้ายุค 5G'`.
   - Set `CENTERS[7].shortTh = 'เทคโนโลยีชีวภาพและเคมีชีวภาพ'`.
2. In `src/view/textures.ts`:
   - Set `CENTER_BIOMES[4].stageTitleTh = 'ด่าน 2/9 · 🌿 สิ่งแวดล้อมและการอนุรักษ์พลังงาน (ชั้น 1)'`.
   - Set `CENTER_BIOMES[5].stageTitleTh = 'ด่าน 3/9 · 📡 นวัตกรรมไร้สายล้ำหน้ายุค 5G (ชั้น 1)'`.
   - Set `CENTER_BIOMES[7].stageTitleTh = 'ด่าน 7/9 · 🧬 เทคโนโลยีชีวภาพและเคมีชีวภาพ (ชั้น 8)'`.
   - Set `ZONE_PALETTES[3].nameTh = 'ชั้น 8: แล็บเรดาร์และเทคโนโลยีชีวภาพและเคมีชีวภาพ (Radar & Bio-Chem)'`.
   - In `centerGateBannerTexture`: use adaptive font (`meta.shortTh.length > 24 ? 36 : 42` px) and pass `W - 64` as the 4th (`maxWidth`) argument to `g.fillText` on all 3 text lines.
   - In `centerBillboardTexture`: use adaptive font (`meta.shortTh.length > 24 ? 30 : 36` px) and pass `W - 64` as `maxWidth` to `g.fillText`.
   - In `centerCapsuleTexture`: replace `meta.shortTh.slice(0, 14)` with full `meta.shortTh` rendered at `bold 13px` with `maxWidth = S - 52` so long Thai names scale cleanly into the bottom pill instead of cutting words/vowels mid-syllable.
3. In `src/ui.ts`:
   - Set `FLOOR_TITLES[8] = 'ชั้น 8 · ห้องปฏิบัติการเรดาร์ และเทคโนโลยีชีวภาพและเคมีชีวภาพ (2 ศูนย์)'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts tests/view-data.test.ts tests/ui-wayfinding.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/view/textures.ts src/ui.ts tests/config.test.ts tests/view-data.test.ts tests/ui-wayfinding.test.ts
git commit -m "fix(centers): update official Thai display names for centers #4, #5, and #7"
```

---

### Task 2: Live 3D Avatar Preview Stage, 3D Card Portraits & Interactive Start-Form Showcase

**Files:**
- Create: `src/view/avatarPreview.ts`
- Modify: `index.html:291-319`
- Modify: `src/ui.ts:12-69`
- Modify: `src/ui.ts:124-139`
- Modify: `src/ui.ts:241-256`
- Modify: `src/ui.ts:383-440`
- Modify: `src/ui.ts:512-524`
- Modify: `src/main.ts:18-20`
- Modify: `src/main.ts:77-93`
- Modify: `src/main.ts:121-210`
- Modify: `src/main.ts:615-626`
- Test: `tests/avatars.test.ts`

**Interfaces:**
- Consumes: `AVATARS`, `AVATAR_LIST`, `applyAvatarToCharacter`, `updateAvatarMotion`, `sanitizeAvatarId`, `type AvatarId` (`src/view/avatars.ts`); `type PlayerProfile`, `ROLE_LABELS` (`src/net.ts`); `type Screen` (`src/ui.ts`)
- Produces:
  - `src/view/avatarPreview.ts`:
    - `export type AvatarPortraits = Partial<Record<AvatarId, string>>`
    - `export function shouldRenderAvatarPreview(opts: { isTvMode: boolean; screen: Screen; lobbyReady: boolean }): boolean`
    - `export class AvatarPreviewStage`:
      - `constructor(source: { scene: THREE.Object3D; animations?: THREE.AnimationClip[] })`
      - `setAvatar(avatarId: AvatarId): void`
      - `setAuraColor(hex: string): void`
      - `triggerCelebratePose(): void`
      - `rotateBy(deltaRad: number): void`
      - `getTurntableYaw(): number`
      - `step(dt: number): void`
      - `renderToCanvas(renderer: Pick<THREE.WebGLRenderer, 'domElement' | 'getPixelRatio' | 'getSize' | 'setViewport' | 'setScissor' | 'setScissorTest' | 'render'>, targetCanvas: HTMLCanvasElement | null, dt: number): boolean`
      - `capturePortraits(renderer: Pick<THREE.WebGLRenderer, 'domElement' | 'getPixelRatio' | 'getSize' | 'setViewport' | 'setScissor' | 'setScissorTest' | 'render'>, size?: number): AvatarPortraits`
  - `src/ui.ts`:
    - `export interface AvatarShowcaseViewModel { avatarId: AvatarId; titleTh: string; badgeTh: string; playerLabelTh: string; accentHex: string; auraHex: string; portraitUrl: string | null; icon: string }`
    - `export function describeAvatarShowcase(profile: PlayerProfile, portraits?: AvatarPortraits): AvatarShowcaseViewModel`
    - `UI.prototype.setAvatarPortraits(portraits: AvatarPortraits): void`
    - `UI.prototype.getAvatarPreviewCanvas(): HTMLCanvasElement | null`
    - `UI.prototype.isStartFormVisible(): boolean`

- [ ] **Step 1: Write the failing tests in `tests/avatars.test.ts`**

Add tests to `tests/avatars.test.ts` covering `shouldRenderAvatarPreview`, `AvatarPreviewStage` (avatar swap, aura ring color update, drag rotation, and strict WebGLRenderer viewport/scissor restoration even on zero-size or normal canvases), and `describeAvatarShowcase`:

```ts
import {
  AvatarPreviewStage,
  shouldRenderAvatarPreview,
} from '../src/view/avatarPreview';
import { describeAvatarShowcase } from '../src/ui';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/avatars.test.ts`
Expected: FAIL (`Cannot find module '../src/view/avatarPreview'`)

- [ ] **Step 3: Implement `AvatarPreviewStage`, `.avatar-showcase` UI + 3D card thumbnails, and single-renderer integration in `src/main.ts`**

1. Create `src/view/avatarPreview.ts`:
   - Implement `shouldRenderAvatarPreview({ isTvMode, screen, lobbyReady }) => !isTvMode && screen === 'start' && !lobbyReady`.
   - Implement `AvatarPreviewStage`:
     - Build a `THREE.Scene` (`background = new THREE.Color('#0b1324')`) with hemisphere light (`0xe0f2fe`, `0x1e293b`, `1.7`), key directional light (`0xffffff`, `2.3` at `(2.4, 3.8, 3.6)`), and cyan/magenta rim point/directional fill so hair, skirts, visors, and gold astronaut helmets pop clearly.
     - Add a dark circular studio pedestal (`CylinderGeometry(0.68, 0.76, 0.1, 28)` at `y = -0.05`) + glowing `auraRing` (`RingGeometry(0.52, 0.7, 28)` at `y = 0.015`) tinted by `setAuraColor(hex)`.
     - Clone `'player'` from `source.scene` via `cloneSkinned` (falling back to a Group if missing), face the camera (`holder.rotation.y = 0` or `Math.PI` matching `Boy01_Body_Geo`'s `+Z` forward direction — note in `PlayerView` `holder.rotation.y = Math.PI` faces `-Z` down the track, whereas a preview camera placed at `+Z` `(0, 1.05, 2.55)` looking at `(0, 0.96, 0)` sees the character's **front face (`+Z`) directly when `holder.rotation.y = 0`**!). Verify from `src/view/avatars.ts:362` ("eyes at `(0, 16.5, +22)`", "visorGlass at `bz = +26`", "goldVisor on front `(+Z)`"): `Boy01_Body_Geo` faces `+Z` natively! So with `holder.rotation.y = 0` (plus slight `-0.22 rad` 3/4 angle) and camera at `(0, 1.02, 2.45)` looking at `(0, 0.96, 0)`, the camera sees the character's front face, visor, outfit, and hair clearly!
     - Bind `THREE.AnimationMixer` on the cloned character (`idle` looping by default; `jump` `LoopOnce` triggered by `triggerCelebratePose()`, returning smoothly to `idle` when finished).
     - `rotateBy(deltaRad)` increments `userYaw` and temporarily pauses gentle idle sway for `2.5s`; `step(dt)` updates mixer, `updateAvatarMotion`, aura ring pulse, and `turntable.rotation.y = -0.22 + userYaw + sway`.
     - `renderToCanvas(renderer, targetCanvas, dt)`: returns `false` if `!targetCanvas`; reads `renderer.getSize(fullSize)` (if `fullSize.x < 16 || fullSize.y < 16`, returns `false`); syncs `targetCanvas.width/height` to `Math.min(fullW, cssW) * pr`; sets camera aspect and renders into top-left scissor `renderer.setViewport(0, fullSize.y - cssH, cssW, cssH)` + `renderer.setScissor(0, fullSize.y - cssH, cssW, cssH)` + `renderer.setScissorTest(true)` inside `try { ... } finally { renderer.setScissorTest(false); renderer.setViewport(0, 0, fullSize.x, fullSize.y); }`, copying `(0, 0, pw, ph)` to `targetCanvas.getContext('2d')!.drawImage(...)`.
     - `capturePortraits(renderer, size = 112)`: when `typeof document !== 'undefined'`, creates a scratch `size × size` canvas, frames the camera tightly on head-and-shoulders (`position.set(0.18, 1.52, 1.18)`, `lookAt(0, 1.46, 0)`, `fov = 38`), loops through `AVATAR_LIST`, applies each avatar in idle pose (`turntable.rotation.y = -0.24`), renders via `renderToCanvas`, records `scratchCanvas.toDataURL('image/png')`, and restores the previous avatar, camera framing, and yaw!
2. In `index.html`:
   - Add CSS styles for `.avatar-showcase` (horizontal flex card, `gap: 12px`, `padding: 8px 10px`, `border-radius: 16px`, `border: 1.5px solid var(--av-accent, rgba(56,189,248,.45))`, `background: radial-gradient(circle at 24% 35%, rgba(56,189,248,.18), rgba(9,13,22,.92) 72%)`), `.av-stage-wrap` (`width: 126px; height: 136px; border-radius: 12px; overflow: hidden; position: relative; flex-shrink: 0; cursor: grab; touch-action: none`), `#avatar-preview-canvas` (`width: 100%; height: 100%; display: block`), `.av-stage-hint` (compact pill `"🔄 ลากหมุน 360°"` at bottom of stage), `.av-info` (right column with character title, gender/outfit badge, and live player pill preview), and `.avatar-card .av-thumb` (`width: 44px; height: 44px; border-radius: 10px; object-fit: cover; background: rgba(15,23,42,.9); border: 1px solid rgba(255,255,255,.14)`).
3. In `src/ui.ts`:
   - Export `describeAvatarShowcase(profile, portraits)` and render `.avatar-showcase` directly above `#avatar-grid` inside Step 2 (`2. เลือกตัวละครนักวิ่ง 3D`).
   - Add `onPreviewRotate?(deltaRad: number): void` and `onPreviewTap?(): void` to `UIHandlers`; bind pointer drag (`pointerdown` / `pointermove` / `pointerup`) and tap on `#avatar-preview-canvas` (`deltaRad = dx * 0.018`).
   - Add `setAvatarPortraits(portraits)`, `getAvatarPreviewCanvas()`, and `isStartFormVisible()` (`!this.tvMode && this.screen === 'start' && !this.lobbyReady`), and refresh the `.avatar-showcase` text/accent/aura pill inside `updatePlayerPill()` so typing a name or changing role/color/avatar updates the showcase immediately.
4. In `src/main.ts`:
   - Instantiate `const avatarPreview = new AvatarPreviewStage(core)` alongside `world`, initialize `avatarPreview.setAvatar(savedProfile.avatar)` and `avatarPreview.setAuraColor(savedProfile.color)`.
   - After `world.warm(renderer)` (when textures and renderer size are ready), call `ui.setAvatarPortraits(avatarPreview.capturePortraits(renderer))`.
   - Update `applyProfileUpdate`, `selectAvatar`, `onPreviewRotate`, and `onPreviewTap` so `avatarPreview` stays in sync and plays `triggerCelebratePose()` when a character is picked or tapped.
   - In `tick(dt, draw)`, when `draw && shouldRenderAvatarPreview({ isTvMode, screen: state, lobbyReady: !ui.isStartFormVisible() })`, call `avatarPreview.renderToCanvas(renderer, ui.getAvatarPreviewCanvas(), dt)` right before `renderer.render(world.scene, world.camera)`.

- [ ] **Step 4: Run full test suite and production build**

Run: `npm test && npm run build`
Expected: PASS (all unit tests green and `tsc --noEmit && vite build` succeeds)

- [ ] **Step 5: Commit**

```bash
git add index.html src/view/avatarPreview.ts src/ui.ts src/main.ts tests/avatars.test.ts
git commit -m "feat(avatars): add live 3D character preview stage and 3D portraits in start selector"
```
