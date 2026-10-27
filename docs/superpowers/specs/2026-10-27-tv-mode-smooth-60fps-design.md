# TV Mode 60 FPS Smooth Rendering & GPU Optimization — Short Design

**Date:** 2026-10-27  
**Project:** TECHNO SURFERS 3D: 10 Floors to Space (`?mode=tv` / TV Live Arena)  
**Size:** Small change

## 1. Intent & Why
Eliminate severe frame stuttering in TV Live Arena (`?mode=tv`) so the shared track, 9-Center 3D scenery, ghost runner pack, and live leaderboard render at a locked, buttery-smooth 60 FPS on booth displays.

## 2. Goals, Non-Goals & Anti-Goals
- **Goals:**
  1. Advance TV mode `sim.time` and `sim.d` continuously every animation frame (`dt` at 60 FPS) with smooth drift correction toward `latestRoom` snapshots instead of stepping at 10 Hz (`100ms`).
  2. Cache `nameBadgeTexture` instances in [`src/view/textures.ts`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts) / [`src/view/world.ts`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts) so rank or active-center changes on ghost runners never trigger mid-frame Canvas/WebGL texture allocations or disposals.
  3. Replace full `innerHTML` rebuilds in [`UI.updateRoomSnapshot`](file:///Users/macbook-arnon/Projects/running/src/ui.ts) with in-place DOM row updates and replace expensive multi-card `backdrop-filter: blur(10px)` on `.tv-*` overlays in [`index.html`](file:///Users/macbook-arnon/Projects/running/index.html) with high-contrast translucent gradients that do not trigger GPU compositor readbacks over the WebGL canvas.
- **Non-Goals:** Changing WebSocket / BroadcastChannel 10 Hz network tick rates or altering gameplay rules.
- **Anti-Goals:** Visual popping/snapping when a new room snapshot arrives, or memory leaks from unbounded texture caches.

## 3. Constraints
- Must keep TV camera synchronized with the active match timeline (`0..matchDuration`) and reset cleanly on new matches or transitions back to `LOBBY`.
- Badge texture cache must be bounded (LRU/cap at 64 entries) so long-running exhibition booths never leak GPU memory.

## 4. Approaches Considered
1. **Selected — Comprehensive 3-Part Fix (60 FPS Frame Interpolation + Bounded Badge Texture Cache + In-Place Leaderboard DOM & Compositor Fix):** Fixes the 10 Hz track stepping, GPU texture uploads, and compositor readbacks together.
2. **Track Interpolation Only:** Fixes `sim.d` stepping in [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts) but leaves 10 Hz DOM thrashing and `backdrop-filter` GPU stalls on 4K/1080p TV screens.

## 5. Technical Design
- **[`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts) (60 FPS TV Clock & Distance Interpolation):**
  - Maintain a continuous `tvElapsed` state during `RUNNING`. Each frame (`tick(dt)`), advance `tvElapsed += dt` and gently blend toward `targetElapsed = latestRoom.matchDuration - latestRoom.phaseTimeLeft` (`tvElapsed += (targetElapsed - tvElapsed) * Math.min(1, dt * 6)`, or snap if `Math.abs(targetElapsed - tvElapsed) > 1.5`).
  - Compute `sim.time = tvElapsed`, `sim.d = distanceAtTime(tvElapsed, latestRoom.matchDuration)`, `sim.floor = floorAtProgress(sim.progress01)`, `sim.stageIndex`, `sim.stageCenter`, and `sim.speed = speedAtProgress(sim.progress01)` at full 60 FPS precision.
- **[`src/view/textures.ts`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts) & [`src/view/world.ts`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts) (Cached Name Badges & Smooth Ghost Interpolation):**
  - Cache `nameBadgeTexture(name, rank, accentHex)` in a bounded `Map<string, THREE.CanvasTexture>` (max 64 entries) and remove `sm.map.dispose()` from [`World.syncGhostPack`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts).
- **[`src/ui.ts`](file:///Users/macbook-arnon/Projects/running/src/ui.ts) & [`index.html`](file:///Users/macbook-arnon/Projects/running/index.html) (Zero-Thrash TV Leaderboard & GPU-Friendly Overlay):**
  - Pre-create or reuse `.tv-lb-row` elements in `#tv-lb-list` and only update changed text/styles.
  - Remove `backdrop-filter: blur(10px)` from `.tv-top`, `.tv-qr-card`, `.tv-host-card`, and `.tv-board-card` in [`index.html`](file:///Users/macbook-arnon/Projects/running/index.html), using a crisp `rgba(15, 23, 42, 0.92)` surface instead.
