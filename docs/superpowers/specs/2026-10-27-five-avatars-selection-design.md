# TECHNO SURFERS 3D: 5-Character Selection System (`AvatarId`) — Design Spec

**Date:** 2026-10-27  
**Branch:** `feat/techno-surfers-3d`  
**Status:** Draft for User Approval

---

## 1. Intent & Why

Booth visitors at SUTO TechnoPark come from diverse backgrounds (male and female students, researchers, engineers, and general public). Currently, every runner on the track and in the waiting lobby uses the exact same street-runner boy model (`Boy01_Body_Geo` with baseball cap and backpack).

Adding **5 distinct selectable 3D characters** (including 2 female characters and 1 full-suit space cadet) in the Waiting Lobby lets players pick an avatar with a clearly different **gender, hairstyle, and outfit silhouette**, while keeping gameplay 100% fair (purely cosmetic, no passive gameplay buffs).

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
1. **5 Distinct Playable 3D Avatars (`AvatarId`):**
   - `non` (**⚡ นนท์ · Street Runner — ชาย**): Original street runner with backwards cap, cyan-orange hoodie, and backpack.
   - `may` (**🎀 เมย์ · Techno Girl — หญิง**): Removes baseball cap & bulky backpack; adds a high **flowing ponytail** with pink bow ribbon on `mixamorig:Head`, school blazer & tie texture, and a **3D pleated skirt** attached to `mixamorig:Hips`.
   - `praw` (**🧬 ดร.พราว · Lab Researcher — หญิง**): Removes baseball cap & bulky backpack; adds **twin hair buns** with mint hairpins + translucent **Hologram Lab Visor** on `mixamorig:Head`, white-mint lab coat texture with **3D flared lab-coat hem** on `mixamorig:Hips`, and a compact bio-med pack on `mixamorig:Spine2`.
   - `kin` (**🤖 คิน · Robo Engineer — ชาย**): Removes baseball cap & bulky backpack; adds **spiky hair + tech comms headset & safety visor** on `mixamorig:Head`, amber-charcoal robotics jacket texture with **3D armored shoulder pads** on `mixamorig:LeftShoulder` / `RightShoulder`, and a compact power core on `mixamorig:Spine2`.
   - `sky` (**🚀 กัปตันสกาย · Space Cadet — นักบินอวกาศ**): Removes baseball cap & bulky backpack; adds a **full 3D Astronaut Bubble Helmet with gold reflective visor** on `mixamorig:Head`, cosmic white-magenta pressure suit texture, and **twin oxygen life-support tanks** on `mixamorig:Spine2`.
2. **Surgical Mesh Island Filtering + Bone-Rigged 3D Garments + Dynamic Canvas Outfit Skins:**
   - Filter disconnected triangle islands in `Boy01_Body_Geo` (`removeCap`, `removeBackpack`, `removeHoodStrings`) so characters without the baseball cap or bulky backpack have a clean head and back with zero vertex distortion.
   - Generate 5 distinct Canvas outfit textures mapped onto `Boy01_Body_Geo`'s UV islands (torso/sleeves, trousers, shoes, hair).
   - Attach 3D hair, helmets, visors, skirts, lab-coat hems, and shoulder pads directly to the animated Mixamo skeleton bones (`mixamorig:Head`, `mixamorig:Spine2`, `mixamorig:Hips`, `mixamorig:LeftShoulder`, `mixamorig:RightShoulder`) so they animate naturally during `idle`, `run`, `jump`, `roll`, and `runlookback`.
3. **Instant Live Preview in Waiting Lobby + Shared Track Ghost Sync:**
   - Add a 5-card Character Selector row in the Waiting Lobby UI (`src/ui.ts`). Clicking any character immediately updates the 3D player standing in the lobby (`world.player.setAvatar(avatarId)`), plays a cheerful warm-up animation, and saves `profile.avatar` to `localStorage`.
   - Sync `avatar: AvatarId` across `PlayerProfile` and `RunnerNetState` (`src/net.ts`) and assign all 5 avatars across the AI demo bots and Ghost Pack slots (`src/view/world.ts`) so the shared track and TV Arena show a diverse mix of male, female, researcher, engineer, and astronaut runners.

### Non-Goals
- No gameplay stat modifiers or passive abilities per character.
- No external `.glb` network fetches that would increase initial load time.

### Anti-Goals
- Never leave the original baseball cap or bulky backpack clipping through female hairstyles or astronaut helmets.

---

## 3. Approaches Considered

| Approach | Summary | Trade-offs | Decision |
|---|---|---|---|
| **A: Hybrid Mesh-Island Filtering + Bone-Rigged 3D Costumes + Dynamic Canvas Skins (Selected ⭐)** | Surgically strips cap/backpack triangle islands from `Boy01_Body_Geo` per avatar, recolors outfit UV regions via Canvas, and attaches 3D hairstyles, skirts, lab coats, visors, and helmets to Mixamo bones (`Head`, `Hips`, `Spine2`, `Shoulders`). | Requires a dedicated `src/view/avatars.ts` module (~280 LOC), but delivers unmistakable male/female/sci-fi silhouettes at 60 FPS with zero extra asset downloads. | **Chosen by User** |
| **B: Simple Accessory Overlay + Color Tint** | Places oversized hats/hair on top of the existing cap and tints the whole material color. | Less code, but the baseball cap and bulky backpack remain visible underneath, making female hairstyles look bulky and unnatural. | Rejected |

---

## 4. Technical Architecture

1. **`src/view/avatars.ts` (New Module):**
   - Defines `AvatarId = 'non' | 'may' | 'praw' | 'kin' | 'sky'`, `AVATAR_LIST`, and `AVATARS: Record<AvatarId, AvatarMeta>` (Thai name, role badge, icon, theme color, outfit palette).
   - `applyAvatarToCharacter(characterRoot: THREE.Object3D, baseBodyGeo: THREE.BufferGeometry, baseDiffuseImage: CanvasImageSource | null, avatarId: AvatarId)`:
     - Builds (and caches per `AvatarId`) a filtered `BufferGeometry` from `Boy01_Body_Geo` that strips the cap islands (`y > 1.44` on `Hat`/`Head` cap components) and backpack islands (`z < -0.08` on `RHoodieString2`/`LBackpack_Strap`/`RBackpack_Strap`) when `avatarId !== 'non'`.
     - Builds (and caches per `AvatarId`) a customized Canvas texture over `Boy01_diffuse` that recolors the outfit, sleeves, trousers, shoes, and hair regions for each of the 5 characters.
     - Attaches bone-rigged 3D costume groups (`Head`, `Hips`, `Spine2`, `LeftShoulder`, `RightShoulder`) such as May's swaying ponytail + pleated skirt, Dr. Praw's twin buns + hologram glasses + flared lab coat skirt, Kin's spiky hair + engineer headset + shoulder armor, and Sky's gold-visored astronaut helmet + twin life-support tanks.
2. **`src/view/player.ts` & `src/view/world.ts`:**
   - `PlayerView.setAvatar(avatarId: AvatarId)` swaps the player's avatar rig in-place and animates secondary hair/skirt motion during `update()` and `menu()`.
   - `World.syncGhostPack()` applies each Ghost runner's `g.avatar` to its cloned 3D character slot (caching the last applied `avatarId` per slot so it only updates when a slot's runner changes).
3. **`src/net.ts`, `src/ui.ts`, & `src/main.ts`:**
   - `PlayerProfile.avatar` and `RunnerNetState.avatar` default to `'non'` (and `BOT_PRESETS` use all 5 avatars: `'non'`, `'may'`, `'praw'`, `'kin'`, `'sky'`).
   - `src/ui.ts` renders the 5-card Character Selector in `#s-start` with live preview callback `onSelectAvatar(avatarId)` so clicking a character updates the 3D runner in the lobby immediately.
