# Live 3D Avatar Selection Preview & 3-Center Official Name Update — Short Design

**Date:** 2026-10-29  
**Project:** TECHNO SURFERS 3D: 10 Floors to Space  
**Size:** Small change

## 1. Intent & Why
1. **Live 3D Avatar Preview on Mobile & Desktop:** On mobile portrait screens, the `#s-start` registration panel covers ~90% of the viewport and blurs out the background 3D character, while the 5 character buttons only show emoji icons (`⚡ 🎀 🧬 🤖 🚀`). Players need to clearly see what each character looks like (face, hairstyle, costume, and chosen aura color) right inside the character picker before joining the lobby.
2. **Official Display Names for Centers `#4`, `#5`, and `#7`:** Booth reviewers reported that the displayed names for `#4`, `#5`, and `#7` were shortened/paraphrased (`shortTh` / `stageTitleTh`). They must display the exact requested names across all UI screens and 3D track signage:
   - `#4 สิ่งแวดล้อมและการอนุรักษ์พลังงาน`
   - `#5 นวัตกรรมไร้สายล้ำหน้ายุค 5G`
   - `#7 เทคโนโลยีชีวภาพและเคมีชีวภาพ`

## 2. Goals, Non-Goals & Anti-Goals
- **Goals:**
  1. Embed an interactive **Live 3D Character Preview Stage** inside Step 2 of `#s-start` ([`src/ui.ts`](file:///Users/macbook-arnon/Projects/running/src/ui.ts)) showing the actual 3D [`Boy01_Body_Geo`](file:///Users/macbook-arnon/Projects/running/src/view/avatars.ts#L662-L696) model with its bone-rigged hairstyle/costume, idle & selection-pose animation, chosen aura ring color, live nickname/role badge, and touch/mouse drag-to-rotate (`360°`).
  2. Render crisp 3D upper-body portrait thumbnails onto all 5 `.avatar-card` selector buttons (replacing plain emoji-only previews, with emoji fallback for headless/non-WebGL environments).
  3. Update `shortTh` in [`CENTERS`](file:///Users/macbook-arnon/Projects/running/src/config.ts#L190-L241) and `stageTitleTh` in [`CENTER_BIOMES`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts#L50-L145) for `#4`, `#5`, and `#7` to the exact requested Thai strings, and clamp text rendering width (`maxWidth`) on 3D Canvas textures so longer Thai names never clip or overflow.
- **Non-Goals:** Adding external `.glb` or image file downloads, altering gameplay physics/power-ups, or renaming the other 6 centers (`#1, #2, #3, #6, #8, #9`).
- **Anti-Goals:** Creating a second `WebGLRenderingContext` (which risks mobile Safari WebGL context limits), running the preview pass during active gameplay or `?mode=tv`, or making `#s-start` cramped/unscrollable on small phones.

## 3. Constraints
- Must reuse the single existing `THREE.WebGLRenderer` in [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts) and skip preview rendering whenever the `#s-start` form is hidden (`state !== 'start'`, `lobbyReady === true`, or `isTvMode === true`).
- Must work cleanly in Vitest/Node unit tests where WebGL / DOM `HTMLCanvasElement` 2D contexts are mocked or unavailable.

## 4. Approaches Considered
1. **Selected (User Picked #1) — Live 3D Character Preview Box inside Form + 3D Portrait Thumbnails on all 5 Cards:** Reuses the existing `WebGLRenderer` via a top-left scissor pass copied to an in-form `<canvas>` while `#s-start` is open, plus one-time baked 3D portrait thumbnails on the 5 `.avatar-card` buttons. Gives an unmistakable 1:1 3D preview right where the user taps without shrinking the form or hurting in-game FPS.
2. **Split Top-Window Layout (Shrink Form to Bottom Half + Reveal Background 3D Scene):** Less new code, but squeezes the 6-step mobile registration form into ~55% of the screen (awkward when the virtual keyboard opens) and leaves the 5 cards as emojis.
3. **2D Illustrated SVG/Canvas Portraits Only:** Lightweight DOM-only art, but does not match the actual 3D Mixamo model or allow 360° rotation and real 3D animations.

## 5. Decided Technical Design
- **Official Center Names ([`src/config.ts`](file:///Users/macbook-arnon/Projects/running/src/config.ts), [`src/view/textures.ts`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts), [`src/ui.ts`](file:///Users/macbook-arnon/Projects/running/src/ui.ts)):**
  - Update `CENTERS[4].shortTh = 'สิ่งแวดล้อมและการอนุรักษ์พลังงาน'`, `CENTERS[5].shortTh = 'นวัตกรรมไร้สายล้ำหน้ายุค 5G'`, and `CENTERS[7].shortTh = 'เทคโนโลยีชีวภาพและเคมีชีวภาพ'`.
  - *(Agent call)* Align `CENTER_BIOMES[4|5|7].stageTitleTh`, `ZONE_PALETTES[3].nameTh`, and `FLOOR_TITLES[8]` with the updated terminology so stage transitions and floor headers match.
  - *(Agent call)* Add `maxWidth` bounds (and adaptive font sizing for strings > 22 chars) in [`centerGateBannerTexture`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts#L389-L421), [`centerBillboardTexture`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts#L459-L501), and [`centerCapsuleTexture`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts#L544-L604) (replacing `.slice(0, 14)` truncation on capsules with full bounded text or clean fit so Thai words/vowels aren't cut mid-syllable).
- **Live 3D Avatar Preview Stage ([`src/view/avatarPreview.ts`](file:///Users/macbook-arnon/Projects/running/src/view/avatarPreview.ts), [`src/ui.ts`](file:///Users/macbook-arnon/Projects/running/src/ui.ts), [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts), [`index.html`](file:///Users/macbook-arnon/Projects/running/index.html)):**
  - *(Agent call)* Create `AvatarPreviewStage` holding a dedicated mini `THREE.Scene`, studio 3-point lighting, circular glowing aura podium, `PerspectiveCamera`, and one `cloneSkinned` character root from `core.glb` animated by its own `AnimationMixer`.
  - *(Agent call)* At startup, `AvatarPreviewStage.capturePortraits(renderer)` renders 5 crisp upper-body 3D portraits (`non`, `may`, `praw`, `kin`, `sky`) as data URLs and injects them into the 5 `.avatar-card` buttons via `ui.setAvatarPortraits(...)`.
  - *(Agent call)* Render a compact horizontal `.avatar-showcase` card (~140px tall so mobile form ergonomics stay fast) directly above `#avatar-grid` inside Step 2: left side holds `<canvas id="avatar-preview-canvas">` (with touch/pointer horizontal drag to spin 360° and tap/select jump-pose reaction); right side displays the selected character's full title, gender/costume description, and live nickname + aura color preview pill.
  - *(Agent call)* In `main.ts`'s `tick()`, call `avatarPreview.renderToCanvas(renderer, ui.getAvatarPreviewCanvas(), dt)` **only** when `!isTvMode && state === 'start' && !ui.isLobbyReady()`, restoring full-screen viewport/scissor before rendering `world.scene`.

## 6. Left to the Builder
- Exact studio camera FOV/framing angles for full-body live preview vs. head-and-shoulders card portraits so all 5 silhouettes (including May's high ponytail and Sky's helmet) fit with clean padding.
- Unit tests in `tests/` verifying the exact `#4`, `#5`, `#7` names across config/biomes/wayfinding and verifying `AvatarPreviewStage` state/drag rotation and UI showcase updates.
