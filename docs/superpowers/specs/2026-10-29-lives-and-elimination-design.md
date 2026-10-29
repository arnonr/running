# Lives Quota, Obstacle Elimination & Last-Survivor Winner Rules — Design Specification

**Date:** 2026-10-29  
**Project:** TECHNO SURFERS 3D: 10 Floors to Space  
**Size:** Project

## 1. Intent & Why
Booth reviewers noted that when collisions only deduct `-50` / `-20` points without ever eliminating a runner, every participant finishes the 3-minute timer and spectators/MCs must compare numerical scores to tell who won. Adding a **lives quota (default 3 lives)** alongside existing score penalties makes races intuitive and exciting at the booth: crashing too many times eliminates the runner (`ตาย / ตกรอบ`), survivors immediately stand out on the 16:9 TV Live Arena, and if everyone crashes out, the last person standing clearly wins without needing to compare points.

## 2. Goals, Non-Goals & Anti-Goals
- **Goals:**
  1. Introduce a configurable lives quota (`maxLives`, default `3`; Admin-selectable presets `3`, `5`, or `0` = unlimited/no-death) synchronized across `MatchRoomCore`, the TV Live Arena (`?mode=tv`), mobile clients, and solo practice (`default = 3`).
  2. Deduct `1` life (while keeping existing score deductions) on **front collisions** (`frontHit`, `-50` pts) and on **repeated side-stumbles** within `PLAYER.stumbleWindow` (`4.5s` in `bounce`, `-20` pts); single isolated side-bumps remain non-lethal stumbles (`-20` pts).
  3. Preserve Center `#4` (`Green Energy Shield`) hit absorption (blocks up to 2 hits without losing lives) and immunity/smash power-ups (`#1`, `#3`, `#9`), while keeping Center `#8` (`Med-Tech Recovery Drone`) strictly score/speed recovery (**no life healing**) so match length stays tight.
  4. End a `RUNNING` booth match immediately into `PODIUM` when **all participating human players** have been eliminated; if at least one human survives, continue running until time expires or the last human is eliminated.
  5. Rank winners clearly: **(a)** in rounds with human players, all human players rank above bots; **(b)** surviving players always rank above eliminated players; **(c)** eliminated players rank by **longer survival duration** (`survivedSec`), breaking simultaneous ties by score then distance; **(d)** surviving players rank by score then distance.
  6. Lock eliminated players out of re-entering/respawning into the same active `matchId` (routing them to `waitingQueue` for the next round), while showing **Option A** on mobile: `1.2s` 3D `die` animation followed immediately by the Result + 9-Center Wayfinding screen (`#s-over`) with live-updating rank.
  7. Display live hearts (`❤️❤️🖤 2/3`) on the mobile HUD and TV Top-10 Leaderboard, `💀 ตาย MM:SS` status on eliminated leaderboard rows, 3D `die` collapse + clean fade-out on TV ghost runners, and Admin life-preset buttons (`❤️ 3 ชีวิต`, `❤️ 5 ชีวิต`, `♾️ ไม่ตาย`) on the TV host panel.
- **Non-Goals:**
  - Simulating obstacle deaths for background demo bots (bots remain visual pacers and never take #1 away from humans).
  - Adding mid-round paid/ad revives or heart pickup items on the track.
- **Anti-Goals:**
  - Waiting for immortal bots to finish a 3-minute timer after all human players have died.
  - Letting a player who grabbed an early bonus and died at `0:30` outrank a player who survived until `2:15`.
  - Allowing an eliminated player to tap back to Lobby or refresh mid-race and respawn into the same `matchId` with fresh lives.

## 3. Constraints
- Must preserve existing backward compatibility for brand-new latecomers joining an active `RUNNING` round via QR scan (`immediate: true` when not in `eliminatedIds`), existing single-hit survival behavior in `tests/sim.test.ts`, and 4-channel (`CH 1..4`) isolation in `MultiChannelRoomRegistry`.
- Must work identically across WebSocket (`server/index.ts`), HTTP `/api/sync` polling fallback, and `BroadcastChannel` local multi-tab fallback (`src/net.ts`), as well as headless Vitest unit tests without WebGL/DOM errors.

## 4. Approaches Considered
1. **Selected (User Picked #1) — Client `Sim` Physics/Life Deduction + `MatchRoomCore` Elimination Lock, Early-Finish & Ranking Authority:**
   - `RoomSnapshot` distributes `maxLives` (`3 | 5 | 0`) to clients. `Sim` deducts lives at 120 Hz on the exact collision frame (respecting `invulnerableT`, `sinceStumble`, and Center `#4` shield charges), triggers `alive = false` + `die` animation on `0` lives, and publishes `lives` and `eliminated: true` to `MatchRoomCore`. `MatchRoomCore` stamps authoritative survival time, locks `eliminatedIds` for the current `matchId` against mid-round respawn, checks all-humans-eliminated early round termination, and sorts leaderboard rankings.
   - *Trade-off:* Zero visual/network lag between hitting a train and collapsing on mobile, works offline/in solo mode and over HTTP polling without duplicated logic, while trusting client collision detection in the same way `score` and `coins` are already client-reported.
2. **Room-Authoritative Hit Counter (`MatchRoomCore` deducts lives and sends kill snapshots back to mobile):**
   - Mobile `Sim` only reports hit counts and waits for a room snapshot to mark the runner dead.
   - *Trade-off:* Centralizes subtraction in `MatchRoomCore`, but introduces 100–400ms death delay on booth Wi-Fi/HTTP fallback (runner phases through a train before dying retroactively) and still requires separate death logic inside `Sim` for `soloRun`.

## 5. Decided Technical Design

### 5.1 Configuration (`src/config.ts`)
- Add `export const DEFAULT_MAX_LIVES = 3;` and `export const MAX_LIVES_OPTIONS = [3, 5, 0] as const;` (`0` = unlimited lives / classic score-only mode).
- *(Agent call)* Add `sanitizeMaxLives(raw?: number | null): number` returning `0`, `3`, or `5` for room presets (defaulting to `DEFAULT_MAX_LIVES`), while allowing `Sim.reset(...)` to accept any non-negative integer `maxLives >= 0` (`0` = unlimited) for unit-test flexibility.

### 5.2 Simulation & Collision Rules (`src/sim/types.ts`, `src/sim/sim.ts`)
- **State fields on `Sim` & `SimSnapshot`:**
  - `maxLives: number` (default `DEFAULT_MAX_LIVES = 3`; `0` means unlimited lives).
  - `lives: number` (initialized to `maxLives`; `0` when `maxLives === 0`).
  - `survivedSec: number` (active seconds survived on track since run start / mid-run sync; frozen when `alive` becomes `false` or `finished` becomes `true`).
  - *(Agent call)* Track `private runStartTime = 0` inside `Sim` (`0` on normal start; set to `safeElapsed` in `syncToElapsed(elapsed)`), so `survivedSec = Math.max(0, this.time - this.runStartTime)` measures actual survival duration even for mid-round joiners.
- **`Sim.reset(seed, tutorial = false, matchDuration = DEFAULT_MATCH_DURATION, maxLives = DEFAULT_MAX_LIVES)`:**
  - Resets `alive = true`, `maxLives`, `lives = maxLives`, `survivedSec = 0`, `runStartTime = 0`.
- **Collision life-loss rules:**
  - **Protected states (no life lost):** `activeCenter === 1` (Jet), `activeCenter === 9` (Rocket), `activeCenter === 3` (EV Train Armor smash), `invulnerableT > 0`, and `shieldHits > 0` (Center `#4` absorbs up to 2 hits and grants `0.8s` invulnerability before `frontHit`/`bounce` is reached).
  - **Center `#8` (`Med-Tech Recovery Drone`):** Clears `stumbleSlow`/`frontHitSlow` and awards `+500` pts + bonus coins + `2.5s` invulnerability as today; **does not modify `this.lives`**.
  - **Front collision (`frontHit(o)`):**
    - Deducts `PLAYER.frontHitPenalty` (`50`, clamped `>= 0`), increments `hitCount++`, resets `coinStreak = 0`.
    - If `this.maxLives > 0`, decrements `this.lives = Math.max(0, this.lives - 1)`.
  - **Side collision (`bounce(o)`):**
    - Check `const repeatedStumble = this.sinceStumble < PLAYER.stumbleWindow;` (`4.5s`) **before** resetting `this.sinceStumble = 0`.
    - Always bounces runner back to adjacent lane and deducts `PLAYER.sideHitPenalty` (`20`, clamped `>= 0`).
    - If `!repeatedStumble`: applies `0.6s` slowdown (`0.85x`) and `0.6s` invulnerability; **no life lost**.
    - If `repeatedStumble`: increments `this.hitCount++`, grants `PLAYER.frontHitInvulnDuration` (`1.5s`) invulnerability so the same obstacle cannot double-drain lives, and if `this.maxLives > 0`, decrements `this.lives = Math.max(0, this.lives - 1)`.
- **Elimination transition (`this.maxLives > 0 && this.lives <= 0`):**
  - Sets `this.alive = false`, `this.running = false`, `this.speed = 0`, `this.slideT = 0`, `this.stumbleSlow = 0`, `this.invulnerableT = 0`, `this.activeCenter = null`, `this.centerTimer = 0`, `this.survivedSec = Math.max(0, this.time - this.runStartTime)`.
  - Extend `SimEvent` (`src/sim/types.ts`):
    - Add `lostLife?: boolean`, `livesLeft?: number`, `maxLives?: number` to `hit` and `stumble` events.
    - Add `{ type: 'eliminated'; kind: ObKind; x: number; y: number; score: number; coins: number; distance: number; survivedSec: number; hitCount: number }`.
  - When `this.alive` becomes `false`, `Sim.update()` exits its step loop immediately (just like `this.finished`), ignoring subsequent lane/jump/slide inputs.

### 5.3 Room Authority, Anti-Respawn Lock & Winner Ranking (`src/net.ts`, `server/index.ts`)
- **Protocol & Types:**
  - `RoomSnapshot`: add `maxLives: number` and `eliminatedIds: string[]` *(Agent call: exposing `eliminatedIds` ensures a mid-round browser reload immediately recognizes that the local player is already eliminated in the active `matchId`)*.
  - `RunnerNetState`: add `lives?: number`, `maxLives?: number`, `eliminated?: boolean`, `survivedSec?: number`.
  - `HostCommand`: add `{ action: 'set_max_lives'; maxLives: number }`.
  - `NetMessage`: add optional `reason?: 'disconnect' | 'switch'` on `leave` (or `{ type: 'disconnect'; channel?: ChannelId; id: string }`) *(Agent call — see Disconnect Lifecycle below)*.
- **Admin `set_max_lives` command:**
  - Validates `cmd.maxLives` via `sanitizeMaxLives` (`3 | 5 | 0`) and stores `this.maxLives`.
  - *(Agent call)* In `LOBBY` / `COUNTDOWN`, updates all `activeMap` runners to `lives = this.maxLives, maxLives = this.maxLives, eliminated = false`. If toggled mid-race during `RUNNING`, updates `this.maxLives` on alive runners (if switched to `0`, sets `lives = 0, maxLives = 0` so alive runners cannot die; if switched between `3` and `5`, adjusts alive runners' `maxLives` and clamps remaining `lives = Math.max(1, Math.min(nextMax, r.lives || nextMax))`), while keeping already-eliminated runners eliminated for the remainder of that round.
- **Tracking, Anti-Respawn Lock & Remaining-Lives Persistence in `MatchRoomCore`:**
  - Maintain `private eliminatedIds = new Set<string>()`, `private roundLives = new Map<string, number>()`, `private joinedAtElapsed = new Map<string, number>()`, and `private silentSec = new Map<string, number>()`, plus `private disconnectedIds = new Set<string>()`, all cleared/reinitialized in `startRunningPhase()` and `enterLobby()`.
  - When a new runner joins mid-run (`this.phase === 'RUNNING'` and `!existing` and `!this.eliminatedIds.has(id)`), record `this.joinedAtElapsed.set(id, this.currentElapsed())`, `this.silentSec.set(id, 0)`, and initialize `lives` from `this.roundLives.get(id) ?? this.maxLives` (`maxLives: this.maxLives, eliminated: false, survivedSec: 0`). *(Agent call: persisting `roundLives` per `matchId` guarantees a player at `1/3` lives cannot refresh or re-join the same round to heal back to `3/3` lives; `startMatchRun` hydrates `sim.lives` from the room snapshot if `< maxLives`.)*
  - **Eliminated Re-Join Lock:** In `join(profile, options)`, if `(this.phase === 'RUNNING' || this.phase === 'COUNTDOWN') && this.eliminatedIds.has(cleanProfile.id)`:
    - Clear `this.disconnectedIds.delete(cleanProfile.id)` since the player reconnected/interacted.
    - Do **not** reset or revive their `activeMap` entry (only update display metadata `name`, `role`, `color`, `avatar` on the existing eliminated entry in `activeMap` so they remain on the current round's leaderboard/podium).
    - Add `cleanProfile` to `this.waitingMap` for the next round and return `{ queuedForNextRound: true }`.
  - **Elimination Stamping in `updateRunnerState(id, state)`:**
    - Reset `this.silentSec.set(id, 0)` and `this.disconnectedIds.delete(id)`.
    - If `r.eliminated` is already `true`: update display metadata (`name`, `role`, `color`, `avatar`) if present, and ignore all positional/score/life updates so late packets cannot move or revive an eliminated runner.
    - Track `if (state.lives !== undefined && this.maxLives > 0) this.roundLives.set(id, Math.max(0, Math.min(this.maxLives, state.lives)))`.
    - When `state.eliminated === true` (or `this.maxLives > 0 && state.lives !== undefined && state.lives <= 0`) on a non-bot runner:
      - Call internal helper `eliminateRunner(id, state.survivedSec)` which sets `r.eliminated = true`, `r.lives = 0`, `r.maxLives = this.maxLives`, `r.activeCenter = null`, `r.sliding = false`, `r.stumbling = false`, adds `id` to `this.eliminatedIds`, sets `this.roundLives.set(id, 0)`, and stamps `r.survivedSec` using the room's authoritative elapsed clock (`Math.max(0, roomElapsed - (this.joinedAtElapsed.get(id) ?? 0))`, falling back to `state.survivedSec ?? 0` if `this.phase !== 'RUNNING'`) so survival order across phones is immune to client clock drift.
  - Mark `msg.state.eliminated !== prev.eliminated` and `msg.state.lives !== prev.lives` as `urgent = true` in `MultiChannelRoomRegistry.applyMessage` for immediate WebSocket broadcast.
- **Disconnect & Inactivity Safeguards (`MatchRoomCore`, `server/index.ts`, `src/main.ts`):**
  - *(Agent call — Tab Disconnect vs. Channel Leave)*: Keep `room.leave(id)` as immediate removal (used when switching channels or clearing runners). Add `room.disconnect(id)` for `server/index.ts` WebSocket `close` and `src/main.ts` `pagehide`:
    - In `LOBBY` / `COUNTDOWN`: removes `id` immediately like `leave(id)`.
    - In `RUNNING` / `PODIUM`: adds `id` to `this.disconnectedIds`; if `this.phase === 'RUNNING'` and `this.maxLives > 0` and the runner is still alive, calls `eliminateRunner(id)` so a closed browser tab forfeits rather than staying immortal. Crucially, the runner's finalized `💀 ตาย MM:SS` entry **remains in `activeMap`** through `PODIUM` (so locking a phone while watching the TV never erases a player's score/rank from the TV), and `enterLobby()` prunes any `id` still in `this.disconnectedIds` (unless present in `waitingMap`) so closed tabs do not spawn as AFK runners in the next round.
  - *(Agent call — Backgrounded / Stalled Alive Phones)*:
    1. In `src/main.ts`, run a `250ms` `setInterval` background step whenever `document.hidden && !isTvMode && !soloRun && (state === 'play' || state === 'pause') && sim.alive`, advancing `sim.update(dt)` and publishing runner state so a backgrounded browser tab still collides and loses lives naturally.
    2. In `MatchRoomCore.tick(dt)`, during `RUNNING` when `this.maxLives > 0` and `dt <= 1.0` (real-time incremental ticks only, leaving large synthetic unit-test `room.tick(180)` jumps unaffected), increment `silentSec` for each alive human runner; if `silentSec > 10.0s`, call `eliminateRunner(id)` so a completely frozen/offline HTTP-polled phone cannot stall early `PODIUM` termination or claim Rank #1 while AFK.
- **All-Humans-Eliminated Early Termination in `MatchRoomCore.tick(dt)`:**
  - During `RUNNING`, after updating `elapsed`, inactivity checks, and bot positions:
    - Collect `const humans = Array.from(this.activeMap.values()).filter((r) => !r.isBot);`
    - If `this.maxLives > 0 && humans.length > 0 && humans.every((r) => r.eliminated)`, immediately transition to `this.enterPodium()` and `return`. (Bot-only demo rounds with `humans.length === 0` continue running for the full `matchDuration`.)
- **Winner Ranking & Pack Offset in `MatchRoomCore.getSnapshot()`:**
  - Let `hasHumans = runners.some((r) => !r.isBot);`
  - Sort `runners` by:
    1. If `hasHumans`: human runners before bots (`(a.isBot ? 1 : 0) - (b.isBot ? 1 : 0)`).
    2. Surviving runners before eliminated runners (`(a.eliminated ? 1 : 0) - (b.eliminated ? 1 : 0)`).
    3. If both `a.eliminated && b.eliminated`: higher `survivedSec` first (`(b.survivedSec ?? 0) - (a.survivedSec ?? 0)` when difference `> 0.05s`), then `b.score - a.score`, then `b.d - a.d`.
    4. Otherwise (both surviving): `b.score - a.score`, then `b.d - a.d`.
  - *(Agent call)* Compute `meanD` from **surviving** runners (`runners.filter((r) => !r.eliminated)`) so eliminated runners frozen early on the track do not skew `packOffsetZ` for active survivors.

### 5.4 3D Animations & TV Camera (`src/view/player.ts`, `src/view/world.ts`, `src/main.ts`)
- **Local Runner (`PlayerView.update`):**
  - On `eliminated` event (or `!sim.alive`), play `'die'` clip (`LoopOnce`, clamped at end), stop invulnerability blinking (`this.model.visible = true`), clear active 9-Center attachment visuals, and zero out lane lean.
- **TV & Multiplayer Ghost Runners (`World.syncGhostPack`):**
  - Track `eliminatedTimer: number` on each `GhostSlot` (reset to `0` when `!g.eliminated`).
  - *(Agent call)* When `g.eliminated` becomes `true`, trigger a red particle burst, play `'die'` clip (`LoopOnce`, clamped) at the ghost's current ground/support elevation while advancing `slot.eliminatedTimer += dt` and drifting backward with track motion; once `slot.eliminatedTimer > 1.4` (or in new slot assignment when already eliminated for `> 1.4s`), hide `slot.group.visible = false` so fallen bodies don't slide alongside surviving runners.
- **TV Camera Lead Runner (`src/main.ts`):**
  - *(Agent call)* Change `leadHuman` lookup in `tick()` from `latestRoom.activeRunners.find((r) => !r.isBot)` to `latestRoom.activeRunners.find((r) => !r.isBot && !r.eliminated)` so when the leading human crashes out, the TV camera smoothly hands off to the next surviving human (or `tv.d` clock if none remain).

### 5.5 Mobile HUD, Option-A Eliminated Result Screen & TV Live Arena UI (`src/ui.ts`, `src/main.ts`, `index.html`)
- **Mobile In-Game HUD (`#hud`):**
  - Add a hearts pill `#hud-lives` directly beneath `#score` inside `.hud-right`:
    - When `maxLives > 0`: renders filled/empty hearts (e.g. `❤️❤️🖤 2/3` or `❤️❤️❤️❤️🖤 4/5`) with subtle pulse animation on life loss.
    - When `maxLives === 0`: renders `♾️ ไม่จำกัดชีวิต` (compact pill).
  - Non-fatal life-loss toast: `💔 ชนสิ่งกีดขวาง! เหลือ ${livesLeft}/${maxLives} ชีวิต (-${penalty} แต้ม)`. Non-lethal single side-bump toast remains `⚠️ เฉี่ยวสิ่งกีดขวาง -${penalty} แต้ม`.
- **Option A — Mobile Eliminated Flow (`src/main.ts`, `src/ui.ts`):**
  - On `eliminated` event:
    1. Immediately publish `eliminated: true, lives: 0, survivedSec` to `net`, play crash sound, flash hit overlay, and show toast `💥 ชนครบ ${sim.maxLives} ครั้ง! สิ้นสุดการวิ่ง`.
    2. Keep `state = 'dying'` (or `play` with `!sim.alive` and `deathRevealTimer = 1.2s`) for `1.2s` so the player sees their 3D character perform the `die` fall animation on the track while controls are disabled.
    3. After `1.2s` (canceled cleanly if Admin resets to `LOBBY` first), open `#s-over` (`state = 'over'`) in **Eliminated mode**:
       - Title `#r-title`: `💥 ชนครบ ${maxLives} ครั้ง! สิ้นสุดการวิ่ง` (vs `🎉 พิชิตชั้น 10 สำเร็จ!` on full survival).
       - Subtitle `#r-rank-line`: shows survival time (`อยู่รอด ${MM:SS}`) and current rank (`อันดับปัจจุบัน #${rank} จาก ${total} คน`), **live-updated** inside `net.onSnapshot` while `state === 'over' && !soloRun` as remaining runners finish or crash!
       - Stats grid + 9-Center Wayfinding directory remain immediately browsable.
       - Primary CTA `#btn-again`:
         - In `soloRun`: `🔄 เริ่มวิ่งใหม่อีกครั้ง` (restarts immediately).
         - In booth multiplayer while `latestRoom.phase === 'RUNNING'` or `'PODIUM'`: `⏳ เข้าคิวรอรอบถัดไป` — clicking calls `net.join(savedProfile, { immediate: false })`, disables/updates button label to `✅ อยู่ในคิวรอรอบถัดไป (รอดูผลบนจอทีวี)`, and **never** starts a new local run until the room transitions to the next `LOBBY` / `COUNTDOWN`. (Also guard `#btn-home2` -> `#btn-join-sync` in `main.ts`: if `joinQueue` is pressed while `latestRoom.eliminatedIds` or `latestRoom.activeRunners` has this player marked eliminated in `RUNNING`, keep them in waiting state with a toast `⏳ คุณจบการวิ่งในรอบนี้แล้ว — เข้าคิวรอรอบถัดไปเรียบร้อย!` instead of calling `startMatchRun`!)
- **Live Multiplayer Pause & Mid-Race Exit Safeguard (`src/main.ts`, `src/ui.ts`):**
  - *(Agent call)* In `soloRun`, `#btn-pause` freezes `sim.update(dt)` and `#btn-restart` starts a fresh run as today. In synchronized booth multiplayer (`!soloRun`), opening `#s-pause` shows the pause overlay (`วิ่งต่อเลย` / `ออกจากการแข่งรอบนี้`) while **`sim.update(dt)` and network sync continue running live in the background** so no player can pause at `0:05` to avoid obstacles and win Rank #1. If an alive multiplayer runner taps `#btn-restart` or `#btn-home` during an active `RUNNING` round (when `maxLives > 0`), their current run forfeits (`eliminated: true, lives: 0` published immediately) and they return to the Lobby queued for the next round.
- **TV Live Arena (`#tv-layer`):**
  - **Top 10 Leaderboard (`#tv-lb-list`):**
    - Header `#tv-active-count` includes human survivor count when `maxLives > 0` and humans are present (e.g. `ผู้เล่นรอด 2/3 คน · บอท 4`).
    - Each row shows status badge before score:
      - Eliminated human: row gets `.eliminated` muted-red style, strikethrough name, and `💀 ตาย MM:SS` pill.
      - Surviving human (when `snap.maxLives > 0`): shows hearts (`❤️❤️🖤` for `<= 5` lives).
      - Bot: shows `🤖` tag (no hearts clutter).
  - **Admin Host Panel (`.tv-host-card`):**
    - Add a 3-button row directly below duration buttons:
      - `#tv-btn-lives3`: `❤️ 3 ชีวิต` (`{ action: 'set_max_lives', maxLives: 3 }`)
      - `#tv-btn-lives5`: `❤️ 5 ชีวิต` (`{ action: 'set_max_lives', maxLives: 5 }`)
      - `#tv-btn-lives0`: `♾️ ไม่ตาย` (`{ action: 'set_max_lives', maxLives: 0 }`)
    - Highlight the active `snap.maxLives` button (`.on`) on every `updateRoomSnapshot`.

## 6. Left to the Builder
- Exact CSS styling/colors for `.hud-lives`, `.tv-lb-row.eliminated`, and `.tv-btn.on` in `index.html` to match the existing neon-dark glassmorphic palette.
- Synthesizing or reusing WebAudio tones in `src/audio.ts` for fatal elimination vs. non-fatal stumble/hit.
- Comprehensive unit & integration tests in `tests/` covering 3-hit & repeated-stumble elimination, Center `#4` shield protection, Center `#8` non-healing, `maxLives = 0` unlimited mode, all-humans-dead early `PODIUM` transition, survival-time & human-first ranking, and mid-round anti-respawn locking.
