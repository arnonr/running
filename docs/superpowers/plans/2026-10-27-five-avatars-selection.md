# 5-Character Selection System (`AvatarId`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 selectable 3D characters (`non`, `may`, `praw`, `kin`, `sky`) with surgical mesh-island removal (cap & backpack), bone-rigged 3D hairstyles & garments, dynamic Canvas outfit skins, live Waiting Lobby preview, and shared-track Ghost runner sync.

**Architecture:** `src/view/avatars.ts` defines the 5 `AvatarId` metadata definitions, connected mesh-island index filtering on `Boy01_Body_Geo` (removing cap & backpack islands cleanly for non-street avatars), dynamic Canvas outfit skins over `Boy01_diffuse`, and bone-attached 3D hairstyle/skirt/coat/helmet rigs on the Mixamo skeleton (`Head`, `Hips`, `Spine2`, `LeftShoulder`, `RightShoulder`). `PlayerView` and `World` apply and animate the chosen avatar on the local runner and Ghost Pack, while `NetClient` and `UI` persist and broadcast `avatar: AvatarId`.

**Tech Stack:** TypeScript 5, Three.js (`SkinnedMesh`, `BufferGeometry`, `CanvasTexture`, `SkeletonUtils`), HTML5 Canvas 2D, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-five-avatars-selection-design.md`

## Global Constraints

- Cosmetic only: all 5 characters (`non`, `may`, `praw`, `kin`, `sky`) have identical hitbox, speed, jump height, and power-up durations.
- Zero external `.glb` fetches: all 5 characters are built from `core.glb`'s `player` skeleton + `Boy01_Body_Geo` mesh-island filtering + bone-rigged 3D garments + procedural Canvas textures.
- Fallback safety: any missing or invalid `avatar` value in `localStorage` or network packets must fall back to `'non'`.

## Review Focus

1. **Invalid or legacy `PlayerProfile.avatar` in `localStorage` / network packets:** `sanitizeAvatarId(raw)` must normalize unknown/undefined values to `'non'` so existing saved profiles never crash.
2. **Repeated `setAvatar()` calls in Waiting Lobby:** Calling `applyAvatarToCharacter()` multiple times on the same character must remove previous bone-attached costume groups (`userData.isAvatarCostume`) before attaching new ones so meshes never stack up.
3. **Cap & Backpack mesh-island removal on `Boy01_Body_Geo`:** Filtering `geometry.index` must preserve all vertex attributes (`position`, `normal`, `uv`, `skinIndex`, `skinWeight`) intact and only omit triangles belonging to the cap/backpack islands so facial meshes (`Boy01_Brows_Geo`, `Boy01_Eyes_Geo`, `h_Geo`) and limb skinning remain 100% intact.
4. **Cloned Ghost Runners in `World.buildGhostPackPool()`:** Each ghost slot must clone its own `SkinnedMesh` material and switch its `geometry` + bone costume when `g.avatar` changes, without mutating the local player's mesh.
5. **Secondary hair/skirt animation during `run` and `menu`:** Ponytail (`may`) and skirt/coat flare (`may`, `praw`) must animate smoothly with `time` without drifting from the `Head` / `Hips` bone local space.

---

### Task 1: Avatar Metadata, Sanitizer & Mesh-Island Filtering (`src/view/avatars.ts` & `src/net.ts`)

**Files:**
- Create: `src/view/avatars.ts`
- Modify: `src/net.ts`
- Test: `tests/avatars.test.ts`

**Interfaces:**
- Produces in `src/view/avatars.ts`:
  - `export type AvatarId = 'non' | 'may' | 'praw' | 'kin' | 'sky'`
  - `export interface AvatarMeta { id: AvatarId; nameTh: string; roleBadgeTh: string; genderLabelTh: string; icon: string; accentHex: string; removeCap: boolean; removeBackpack: boolean; outfitPrimaryHex: string; outfitSecondaryHex: string; bottomsHex: string; hairHex: string }`
  - `export const AVATARS: Record<AvatarId, AvatarMeta>`
  - `export const AVATAR_LIST: AvatarMeta[]`
  - `export function sanitizeAvatarId(raw: unknown): AvatarId`
  - `export function filterBodyGeometryIslands(baseGeo: THREE.BufferGeometry, opts: { removeCap: boolean; removeBackpack: boolean }): THREE.BufferGeometry`
  - `export function applyAvatarToCharacter(characterRoot: THREE.Object3D, avatarId: AvatarId): void`
  - `export function updateAvatarMotion(characterRoot: THREE.Object3D, time: number, isRunning: boolean): void`
- Produces in `src/net.ts`:
  - `PlayerProfile.avatar?: AvatarId` and `RunnerNetState.avatar: AvatarId` populated across `join()`, `promoteWaitingQueue()`, and `BOT_PRESETS` (covering all 5 avatars).

- [ ] **Step 1: Write the failing test in `tests/avatars.test.ts`**
  - Verify `AVATAR_LIST` has 5 distinct avatars (`non`, `may`, `praw`, `kin`, `sky`) including female avatars (`may`, `praw`) with `removeCap: true` and `removeBackpack: true`.
  - Verify `sanitizeAvatarId` normalizes invalid/undefined inputs to `'non'`.
  - Verify `filterBodyGeometryIslands` removes cap/backpack triangle islands while keeping vertex attributes intact.
  - Verify `MatchRoomCore.addDemoBots(5)` assigns distinct avatars across bots and `join()` preserves `avatar`.
- [ ] **Step 2: Run test to verify it fails**
  - Run: `npx vitest run tests/avatars.test.ts`
- [ ] **Step 3: Implement `src/view/avatars.ts` and update `src/net.ts`**
  - Implement connected-component island detection on `BufferGeometry`, procedural Canvas outfit texture generation, and bone-rigged 3D hair/skirt/coat/visor/helmet builders for `non`, `may`, `praw`, `kin`, and `sky` (remembering Mixamo bone local space is scaled `100x` inside `player` whose scale is `0.01`).
- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run tests/avatars.test.ts`
- [ ] **Step 5: Commit**
  - `git add src/view/avatars.ts src/net.ts tests/avatars.test.ts && git commit -m "feat(avatars): add 5-character mesh island filter, bone costumes, and net sync"`

---

### Task 2: Integrate Avatar Rigging into `PlayerView`, `World` Ghost Pack, `UI` Lobby Selector & `main.ts`

**Files:**
- Modify: `src/view/player.ts`
- Modify: `src/view/world.ts`
- Modify: `src/ui.ts`
- Modify: `src/main.ts`
- Modify: `index.html`

**Interfaces:**
- Consumes: `AvatarId`, `AVATAR_LIST`, `AVATARS`, `sanitizeAvatarId`, `applyAvatarToCharacter`, `updateAvatarMotion` from `src/view/avatars.ts`
- Produces:
  - `PlayerView.setAvatar(avatarId: AvatarId): void`
  - `UIHandlers.selectAvatar(avatarId: AvatarId): void`

- [ ] **Step 1: Update `PlayerView` (`src/view/player.ts`) and `World` (`src/view/world.ts`)**
  - Add `PlayerView.setAvatar(avatarId: AvatarId)` and call `updateAvatarMotion(this.model, ...)` in `menu()` and `update()`.
  - Track `avatar: AvatarId` on each `GhostSlot` in `src/view/world.ts` and call `applyAvatarToCharacter(slot.charClone, g.avatar)` whenever a ghost slot's `avatar` changes.
- [ ] **Step 2: Add 5-Card Character Selector UI in `src/ui.ts`, `index.html`, and wire `selectAvatar` in `src/main.ts`**
  - Render the 5 character cards (`⚡ นนท์`, `🎀 เมย์`, `🧬 ดร.พราว`, `🤖 คิน`, `🚀 กัปตันสกาย`) in `#s-start` (`src/ui.ts`), style `.avatar-grid` and `.avatar-card` in `index.html`, and wire `selectAvatar(avatarId)` in `src/main.ts` so clicking any character immediately transforms the 3D character in the lobby, plays a warm-up jump/wave, saves `profile`, and updates the lobby registration.
- [ ] **Step 3: Run full test suite and production build**
  - Run: `npm test && npm run build`
  - Expected: All test suites pass and Vite bundle builds with 0 errors.
- [ ] **Step 4: Commit**
  - `git add index.html src/ui.ts src/main.ts src/view/player.ts src/view/world.ts && git commit -m "feat(ui,view): wire 5-character selector in lobby with live 3D preview and ghost sync"`
