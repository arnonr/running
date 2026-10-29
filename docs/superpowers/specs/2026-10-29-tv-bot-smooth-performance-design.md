# TV Mode Bot-Only Smooth 60 FPS & Smart Bot Reflexes — Short Design

**Date:** 2026-10-29  
**Project:** TECHNO SURFERS 3D: 10 Floors to Space (`?mode=tv` / TV Live Arena)  
**Size:** Small change

## 1. Intent & Why
Eliminate micro-stuttering, camera shake jitter, and abrupt bot position jumps on the TV Live Arena display (`?mode=tv`) when running with bots only (or bots alongside players), so booth displays run at a locked, fluid 60 FPS and bots showcase smooth, believable obstacle avoidance.

## 2. Goals, Non-Goals & Anti-Goals
- **Goals:**
  1. Remove 10 Hz speed/distance sawtooth oscillation in [`stepTvClock`](file:///Users/macbook-arnon/Projects/running/src/config.ts#L296-L335) and [`MatchRoomCore.getSnapshot`](file:///Users/macbook-arnon/Projects/running/src/net.ts#L513-L549) by preserving millisecond precision on `phaseTimeLeft` (`.toFixed(3)`) and ensuring monotonic, low-gain clock drift correction (`dt * 2.0` rate modulation without backward jumps).
  2. Eliminate TV camera shake (`this.shake`) triggered by bots and give bots track-aware reflexes in [`World.syncGhostPack`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts#L1624-L1900) so they smoothly dodge trains, jump low/hurdle barriers, and roll under overhead barriers instead of repeatedly crashing.
  3. Smooth bot `targetZ`, lane spreading, and jump trajectories (`y`) so rank swaps or shared lanes never cause sudden positional snapping.
  4. Reduce per-frame CPU/GPU overhead in TV mode by sharing procedural materials/textures across all 11 [`createCenterAttachments`](file:///Users/macbook-arnon/Projects/running/src/view/player.ts#L246-L278) instances, caching animated child nodes instead of calling `.traverse()` every frame in [`updateCenterAttachments`](file:///Users/macbook-arnon/Projects/running/src/view/player.ts#L876-L922) and [`updateAvatarMotion`](file:///Users/macbook-arnon/Projects/running/src/view/avatars.ts#L693-L705), and skipping hidden mobile [`UI.hud`](file:///Users/macbook-arnon/Projects/running/src/ui.ts#L710-L756) DOM updates in [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts#L596-L615) when `isTvMode` is active.
- **Non-Goals:** Changing WebSocket / HTTP sync protocol schemas or running full server-side `Sim` instances per bot.
- **Anti-Goals:** Any backward movement of `sim.d` on TV, camera shake when no human player is hit, or visual popping when bots overtake one another.

## 3. Constraints
- Must preserve existing `RoomSnapshot` wire compatibility across WebSocket, HTTP `/api/sync`, and `BroadcastChannel`.
- Must keep all existing unit and integration tests passing while adding coverage for monotonic TV clock progression and bot obstacle avoidance.

## 4. Approaches Considered
1. **Selected — Comprehensive 3-Layer Fix (Monotonic High-Precision TV Clock + View-Side Smart Bot Reflexes & Smooth Pack Positioning + Shared Attachment Textures & Cached Scene Traversal):** Fixes the 10 Hz clock sawtooth, stops bot-induced camera shake, makes bots dodge obstacles smoothly, and removes per-frame traversal/DOM overhead without adding server CPU load.
2. **Clock & Interpolation Fix Only:** Fixes `phaseTimeLeft` precision and `targetZ` smoothing, but leaves bots crashing into trains/barriers on TV and keeps redundant per-frame `.traverse()` and mobile HUD updates.
3. **Full Server-Side `Sim` Instance Per Bot:** Runs a full physics simulation for every bot across all 4 booth channels on the server, multiplying server CPU usage by 4–10× while still requiring view-side interpolation on the TV client.

## 5. Decided Technical Design
- **Clock & Distance Continuity ([`src/net.ts`](file:///Users/macbook-arnon/Projects/running/src/net.ts), [`src/config.ts`](file:///Users/macbook-arnon/Projects/running/src/config.ts), [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts)):**
  - Export `phaseTimeLeft` with `.toFixed(3)` and `referenceDistance` with `.toFixed(2)` in `MatchRoomCore.getSnapshot()`.
  - In `stepTvClock()`, smoothly modulate rate toward `targetElapsed` (`const drift = targetElapsed - next; next = Math.max(prevElapsed, prevElapsed + dt * Math.max(0.75, Math.min(1.25, 1 + drift * 2.5)))`, snapping only if `Math.abs(drift) > 1.5`) so `elapsed` and `d` never step backward or oscillate at 10 Hz.
  - In `MatchRoomCore.tick()`, replace the square-wave bot jump (`Math.sin(...) > 0.85 ? 1.5 : 0`) with a smooth parabolic jump curve (`Math.sin` half-wave) and staggered lane-change phases per bot.
- **Smart Bot Reflexes & Smooth Pack Positioning ([`src/view/world.ts`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts)):**
  - In `World.syncGhostPack()`, compute continuous `targetZ` primarily from continuous `packOffsetZ` (with gentle rank spacing blended smoothly via `kz = Math.min(1, dt * 4.5)`) and deterministic per-runner lateral offset (`((hash(g.id) % 3) - 1) * 0.22`) when sharing a lane so rank or lane changes never snap other runners.
  - Add lightweight lookahead obstacle avoidance for bots (`isBot`) in `syncGhostPack()`: inspect `sim.obs` within `16m` ahead of `slotD`; if a `train`/`mtrain` blocks the bot's lane, steer to an open lane; if a `low`/`hurdle` is within `9m`, trigger a smooth visual jump arc; if an `overhead` barrier is within `9m`, trigger `sliding` (`roll` animation).
  - Never trigger `this.shake` on the TV camera from bot obstacle interactions (`if (!g.isBot) this.shake = ...`).
- **CPU/GPU Frame Optimization ([`src/view/player.ts`](file:///Users/macbook-arnon/Projects/running/src/view/player.ts), [`src/view/avatars.ts`](file:///Users/macbook-arnon/Projects/running/src/view/avatars.ts), [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts)):**
  - Cache shared `MeshPhongMaterial` and `MeshBasicMaterial` instances at module scope in `src/view/player.ts` so `createCenterAttachments()` reuses 1 set of procedural textures across the player and all 10 ghost slots instead of creating 55 duplicate canvas textures.
  - Store animated child references in `grp.userData.animNodes` inside `createCenterAttachments()` and in `characterRoot.userData.motionNodes` inside `attachBoneCostumes()` so `updateCenterAttachments()` and `updateAvatarMotion()` iterate flat arrays instead of calling `.traverse()` 10+ times every frame.
  - In `src/main.ts`, skip calling `world.player.setProfileBadge(...)` and `ui.hud(...)` every frame when `isTvMode` is true.

## 6. Left to the Builder
- Exact lookahead distances (`8m–18m`) and damping constants (`kx`, `ky`, `kz`) for bot evasion so visual jumps/rolls align naturally with obstacle geometry.
- Unit tests in `tests/` verifying monotonic `stepTvClock`, bot smooth jump curves, and zero camera shake from bots in TV mode.
