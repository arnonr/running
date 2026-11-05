# TV Coin Collection & Spectator Hype System — Short Design

**Date:** 2026-11-05  
**Project:** TECHNO SURFERS 3D: 10 Floors to Space (`?mode=tv` / TV Live Arena)  
**Size:** Small change

## 1. Intent & Why
1. **Eliminate "Running Through Coins" on TV (`?mode=tv`):** Currently, each mobile player runs an independent [`Sim`](file:///Users/macbook-arnon/Projects/running/src/sim/sim.ts#L55-L1031) instance where coins disappear on contact, whereas the TV Live Arena only advances `sim.d` and never checks pickup collisions for the 3D ghost runners in [`World.syncGhostPack`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts#L1630-L1985). As a result, spectators watching the big TV screen see runners phase straight through coins and 9-Center capsules. Making coins and capsules visually magnet-pull and burst on contact on the TV screen keeps the big-screen presentation crisp and believable while leaving every mobile player's personal track coins 100% untouched.
2. **Multi-Moment Spectator Excitement at the Booth:** Spectators gathering around the booth TV need clear, high-energy visual and audio hooks throughout the 3-minute race—when someone takes the `#1` lead, activates a 9-Center power-up, drops to their last heart, gets eliminated, enters the final 30-second sprint, or claims the Top 3 podium.

## 2. Goals, Non-Goals & Anti-Goals
- **Goals:**
  1. Collect coins (`sim.coinList`) and 9-Center capsules (`sim.pickups`) on the TV's local `Sim` whenever any active (non-eliminated) 3D ghost runner in [`World.syncGhostPack`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts#L1630-L1985) touches them or pulls them with an active magnet Center (`#1, #2, #5, #9`), triggering golden/neon particle bursts (`fx.burst`) on the TV without affecting any mobile client's `Sim`.
  2. Highlight the current `#1` leader on the 3D track with a floating 3D golden crown mesh, a `👑 #1` nameplate badge in [`nameBadgeTexture`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts#L612-L645), and an enhanced floor aura ring.
  3. Add a **Live Broadcast Feed (`#tv-feed`)** on the TV overlay that announces and plays audio stingers for 4 key race moments:
     - 👑 **Lead Change:** A runner overtakes into Rank `#1`.
     - ⚡ **Center Power-Up:** A runner activates one of the 9 Research Center abilities.
     - 💔 **Last Heart Warning:** A human runner drops to `1` remaining life (`lives === 1` when `maxLives > 1`).
     - 💥 **Eliminated:** A human runner loses all lives and crashes out.
  4. Add a **Final 30s Sprint Fever Mode** (`phaseTimeLeft <= 30` during `RUNNING`) on the TV with a pulsing neon border/timer, a `"🔥 โค้งสุดท้าย 30 วินาทีเดือด!"` callout banner, accelerated music tempo, and final 5-second countdown beeps.
  5. Add a **Podium Top 3 Spotlight Card (`#tv-podium-card`)** + 3D sky fireworks (`fx.burst`) during the `PODIUM` phase on the TV screen so spectators can celebrate the Top 3 winners.
- **Non-Goals:** Changing mobile gameplay rules, altering `RoomSnapshot` network wire schemas, or removing coins from other players' phones when someone ahead collects a coin.
- **Anti-Goals:** Spamming the TV screen with overlapping/flickering notifications when two runners rapidly trade `#1`, or obscuring the center 3D track during `RUNNING`.

## 3. Constraints
- Must keep existing `RoomSnapshot` wire compatibility across WebSocket (`server/index.ts`), HTTP `/api/sync`, and `BroadcastChannel` (`src/net.ts`).
- Must maintain locked 60 FPS on the TV display by reusing instanced/pooled objects and bounding DOM feed rows (max 3 visible items at once).
- Must pass all existing Vitest unit tests in `tests/` and add unit test coverage for TV ghost coin/pickup collection and TV broadcast event diffing.

## 4. Approaches Considered
1. **Selected (User Picked #1) — TV-Side Visual Collision & Snapshot Diffing:**
   - The TV client checks each rendered ghost runner's `(slot.x, slot.y, slotD)` against its local `sim.coinList` and `sim.pickups` inside `World.syncGhostPack`, and diffs consecutive `RoomSnapshot` states on the TV client to trigger Live Broadcast Feed alerts, the `#1` 3D crown, Final 30s Fever, and the Podium Top 3 spotlight.
   - *Trade-off:* Coins disappear at the exact moment a 3D character visibly touches them on the TV screen (accounting for `rankZ` / `packOffsetZ` pack framing), requires zero extra network bandwidth, and works identically for human players and bots.
2. **Server-Broadcast Event Stream & Shared Coin IDs (`MatchRoomCore`):**
   - Mobile clients send collected coin IDs to the server, which broadcasts them to the TV alongside server-generated event logs.
   - *Trade-off:* Because TV ghost positions use smoothed pack offsets (`slotD`) rather than raw mobile `d`, coins would vanish before or after the TV character visually reaches them, while multiplying WebSocket traffic.

## 5. Decided Technical Design

### 5.1 TV-Side Coin & Capsule Collection ([`src/sim/sim.ts`](file:///Users/macbook-arnon/Projects/running/src/sim/sim.ts), [`src/view/world.ts`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts))
- Add `collectGhostPickupsAt(x: number, y: number, d: number, sliding: boolean, activeCenter: CenterId | null, dt: number): { coins: number; centers: CenterId[] }` on `Sim`:
  - Uses the runner's hitbox height (`sliding ? PLAYER.slideHeight : PLAYER.height`) and checks magnet pull (`activeCenter === 1 | 2 | 5 | 9`, range `MAGNET_RANGE * 1.5` for `5 | 9` else `MAGNET_RANGE`).
  - Pulls nearby coins in `this.coinList` toward `(x, y + 1, d)` when magnet is active (`k = Math.min(1, dt * 15)`).
  - Removes coins overlapping `Math.abs(c.d - d) < 1.15 && Math.abs(c.x - x) < 1.15 && c.y > y - 0.7 && c.y < y + h + 0.8` (returning them to `this.freeCoins`) and increments `coins`.
  - Removes 9-Center capsules in `this.pickups` overlapping `Math.abs(cp.d - d) < PICKUP_PULL_RANGE * 0.65 && Math.abs(laneX(cp.lane) - x) < PICKUP_PULL_RANGE * 0.65` (returning them to `this.freePickups`) and records `cp.centerId`.
- In `World.syncGhostPack`, when `tvMode && isRunning && !g.eliminated`:
  - Call `sim.collectGhostPickupsAt(slot.x, slot.y, slotD, effectiveSliding, g.activeCenter, dt)`.
  - Trigger golden coin burst `this.fx.burst(slot.x, slot.y + 0.85, slot.z, 5, 0xffd75a, ...)` when `coins > 0` and Center-colored burst when `centers.length > 0`.

### 5.2 3D `#1` Leader Crown & Nameplate Highlight ([`src/view/world.ts`](file:///Users/macbook-arnon/Projects/running/src/view/world.ts), [`src/view/textures.ts`](file:///Users/macbook-arnon/Projects/running/src/view/textures.ts))
- *(Agent call)* In `World.buildGhostPackPool`, attach a lightweight 3D golden crown group (`slot.crown: THREE.Group`, built from a gold cylinder base + 4 angled crown points + glowing gem ring) positioned at `y = 2.42` above each ghost slot.
- In `World.syncGhostPack`, set `slot.crown.visible = isRunning && !g.eliminated && g.rank === 1`, rotate it smoothly (`slot.crown.rotation.y = this.time * 2.4`), and scale `slot.ring` to `1.2x` for Rank `#1`.
- In `nameBadgeTexture(name, rank, color)`, render `👑 #1` with a gold-tinted rank badge when `rank === 1`.

### 5.3 Live Broadcast Feed, Final 30s Sprint & Podium Spotlight ([`src/ui.ts`](file:///Users/macbook-arnon/Projects/running/src/ui.ts), [`src/main.ts`](file:///Users/macbook-arnon/Projects/running/src/main.ts), [`src/audio.ts`](file:///Users/macbook-arnon/Projects/running/src/audio.ts), [`index.html`](file:///Users/macbook-arnon/Projects/running/index.html))
- **Broadcast Event Diffing (`TvBroadcastTracker` in `src/ui.ts`):**
  - *(Agent call)* Track previous runner states per `matchId` and emit typed `TvBroadcastEvent` items (`'lead' | 'power' | 'last_heart' | 'eliminated'`):
    - `lead`: Rank `#1` non-eliminated runner ID changes after `elapsed >= 3.0s` (with a `2.5s` cooldown so rapid rank swaps don't spam).
    - `power`: A runner's `activeCenter` changes from `null`/previous to a new `CenterId` (always emit for humans; throttle bot power-up callouts to at most 1 every `6.0s`).
    - `last_heart`: A human runner's `lives` drops from `> 1` to `1` while `snap.maxLives > 1` and `!r.eliminated`.
    - `eliminated`: A human runner transitions to `eliminated === true`.
  - Render up to 3 stacked `.tv-feed-item` banners in `#tv-feed` (top-center of `#tv-layer`, `pointer-events: none`), auto-removing each after `3.4s`.
- **Final 30s Sprint Fever Mode:**
  - When `snap.phase === 'RUNNING' && snap.phaseTimeLeft <= 30 && snap.phaseTimeLeft > 0`:
    - Toggle `.final-sprint` on `#tv-layer` (adds pulsing gold/crimson edge glow and highlights `#tv-timer`) and show `#tv-sprint-banner` (`🔥 โค้งสุดท้าย 30 วินาทีเดือด! · เร่งสปีดสู่ชั้น 10!`).
    - In `src/main.ts` when `isTvMode`: boost music tempo during the final 30s (`+14 BPM`), play a one-time alert stinger at `30s`, and play `audio.countdownBeep(false)` on each of the final `5..1` seconds.
- **Podium Top 3 Spotlight Card + 3D Fireworks:**
  - When `snap.phase === 'PODIUM'`:
    - Show `#tv-podium-card` in `#tv-layer` displaying the Top 3 runners (`🥇 #1`, `🥈 #2`, `🥉 #3`) with avatar icon, name, role label, score, and survival badge, hiding it automatically in `LOBBY` / `COUNTDOWN` / `RUNNING`.
    - In `World.sync` when `tvMode && !isRunning && ghosts.length > 0` during `PODIUM` (or via a `podiumActive` flag), launch periodic multi-color 3D firework bursts (`this.fx.burst`) in the upper sky every `~0.45s`.
- **TV Audio Cues (`src/audio.ts`, `src/main.ts`):**
  - *(Agent call)* Add `leadChange()`, `lastHeart()`, and `finalSprint()` synthesized WebAudio cues in `Audio`, and run background music on TV during `RUNNING` (respecting the mute toggle).

## 6. Left to the Builder
- Exact CSS animations/gradients for `.tv-feed-item`, `.final-sprint`, and `#tv-podium-card` in `index.html` so the center 3D runway remains unobstructed during `RUNNING`.
- Unit tests in `tests/` covering `sim.collectGhostPickupsAt`, `TvBroadcastTracker` event diffing/cooldowns, Final 30s state toggling, and Podium Top 3 rendering.
