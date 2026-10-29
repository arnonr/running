// Start-up, Synchronized Booth Match Room + Solo Play, and 60 FPS frame loop.
import * as THREE from 'three';
import { Sim } from './sim/sim';
import { World } from './view/world';
import { parseGLB, fetchBuffer } from './view/assets';
import { Audio } from './audio';
import { bindInput, type Action } from './input';
import {
  UI,
  canResumeFromPause,
  shouldCancelDeathReveal,
  shouldEvictToLobbyOnSnapshot,
  shouldForfeitActiveRound,
  shouldStepSimInScreen,
  type Screen,
} from './ui';
import { load, save } from './storage';
import {
  SPEED, DEFAULT_MATCH_DURATION, DEFAULT_MAX_LIVES, VIEW_AHEAD, CENTERS,
  stepTvClock, laneX,
} from './config';
import {
  NetClient, AVATAR_COLORS, sanitizeChannelId,
  type PlayerProfile, type RoomSnapshot, type ChannelId,
} from './net';
import { sanitizeAvatarId, AVATARS } from './view/avatars';
import { AvatarPreviewStage, shouldRenderAvatarPreview } from './view/avatarPreview';
import type { SimEvent, CenterId } from './sim/types';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
let isTvMode = params.get('mode') === 'tv';
let currentChannel: ChannelId = sanitizeChannelId(params.get('ch'));

function syncUrlQueryParams() {
  try {
    const nextParams = new URLSearchParams(window.location.search);
    if (isTvMode) nextParams.set('mode', 'tv');
    else nextParams.delete('mode');
    nextParams.set('ch', currentChannel);
    const qs = nextParams.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
    window.history.replaceState(null, '', nextUrl);
  } catch {
    // ignore history errors
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function setLoaderProgress(p: number, text?: string) {
  const bar = document.getElementById('ld-bar');
  const txt = document.getElementById('ld-text');
  if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`;
  if (txt && text) txt.textContent = `${text} ${Math.floor(p * 100)}%`;
}

function removeLoader() {
  const el = document.getElementById('loader');
  if (!el) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), 380);
}

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxPR = Math.min(window.devicePixelRatio || 1, 2);
  const pixelRatio = mobile ? Math.min(maxPR, 1.5) : maxPR;
  renderer.setPixelRatio(pixelRatio);

  setLoaderProgress(0.25, 'กำลังโหลดโมเดล 3D...');
  const coreBuf = await fetchBuffer('assets/core.glb');
  setLoaderProgress(0.75, 'กำลังเตรียมฉาก 10 ชั้น...');
  await nextFrame();
  const core = await parseGLB(coreBuf);
  setLoaderProgress(0.92, 'พร้อมทะยานสู่ชั้น 10!');
  await nextFrame();

  const avatarPreview = new AvatarPreviewStage(core);
  const world = new World(core, { shadowSize: mobile ? 1024 : 2048 });
  const sim = new Sim(202610);
  const audio = new Audio();
  audio.setMuted(load('muted', false));

  const savedProfile = load<PlayerProfile>('profile', {
    id: 'p-' + Math.random().toString(36).slice(2, 9),
    name: 'นักวิ่ง Techno',
    role: 'senior',
    color: AVATAR_COLORS[0],
    avatar: 'non',
  });
  savedProfile.avatar = sanitizeAvatarId(savedProfile.avatar);
  world.player.setAvatar(savedProfile.avatar);
  world.player.setProfileBadge(savedProfile.name, 1, savedProfile.color);
  avatarPreview.setAvatar(savedProfile.avatar);
  avatarPreview.setAuraColor(savedProfile.color);

  const net = new NetClient(isTvMode, currentChannel);
  let latestRoom: RoomSnapshot = net.getSnapshot();
  let hasJoinedLobby = false;
  let joinedMatchId = -1;
  let eliminatedMatchId = -1;
  let soloRun = false;
  let state: Screen = 'start';
  let netPublishTimer = 0;
  let tvElapsed = 0;
  let deathRevealTimer: number | null = null;
  let lastResultEliminated = false;
  let lastSurvivedSec = 0;
  let queuedForNextRound = false;
  let confirmedInRoom = false;
  let joinPendingUntil = 0;
  let joinPendingMatchId = -1;
  const horned = new Set<number>();

  function clearDeathRevealTimer() {
    if (deathRevealTimer !== null) {
      window.clearTimeout(deathRevealTimer);
      deathRevealTimer = null;
    }
  }

  function persistRunProgress(finalScore: number) {
    const prevBest = load<number>('bestScore', 0);
    if (finalScore > prevBest) save('bestScore', finalScore);
    const savedCenters = new Set<CenterId>(load<CenterId[]>('collectedCenters', []));
    for (const c of sim.collectedCenters) savedCenters.add(c);
    save('collectedCenters', Array.from(savedCenters));
  }

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    world.resize(w, h);
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();

  const toggleMute = () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    save('muted', audio.muted);
    ui.setMuted(audio.muted);
  };

  const applyProfileUpdate = (prof: PlayerProfile) => {
    savedProfile.name = prof.name;
    savedProfile.role = prof.role;
    savedProfile.color = prof.color;
    savedProfile.avatar = sanitizeAvatarId(prof.avatar);
    save('profile', savedProfile);
    world.player.setAvatar(savedProfile.avatar);
    world.player.setProfileBadge(savedProfile.name, 1, savedProfile.color);
    avatarPreview.setAvatar(savedProfile.avatar);
    avatarPreview.setAuraColor(savedProfile.color);
  };

  const forfeitActiveRoundIfNeeded = () => {
    if (
      shouldForfeitActiveRound({
        soloRun,
        isTvMode,
        hasJoinedLobby,
        roomPhase: latestRoom.phase,
        simAlive: sim.alive,
        simFinished: sim.finished,
        simMaxLives: sim.maxLives,
      })
    ) {
      eliminatedMatchId = latestRoom.matchId;
      sim.setLives(0, sim.maxLives);
      sim.alive = false;
      sim.running = false;
      publishRunnerStateNow();
      net.join(savedProfile, { immediate: false });
      queuedForNextRound = true;
    }
  };

  const ui = new UI(
    document.getElementById('ui')!,
    {
      joinQueue: (prof) => {
        audio.unlock();
        audio.click();
        applyProfileUpdate(prof);
        ui.updatePlayerPill(savedProfile);
        const preSnap = net.getSnapshot();
        const alreadyEliminated =
          !isTvMode &&
          preSnap.phase === 'RUNNING' &&
          (eliminatedMatchId === preSnap.matchId ||
            preSnap.eliminatedIds.includes(savedProfile.id) ||
            preSnap.activeRunners.some((r) => r.id === savedProfile.id && r.eliminated));
        if (alreadyEliminated) {
          hasJoinedLobby = true;
          soloRun = false;
          queuedForNextRound = true;
          joinedMatchId = preSnap.matchId;
          confirmedInRoom = false;
          joinPendingUntil = performance.now() + 1500;
          joinPendingMatchId = preSnap.matchId;
          net.join(savedProfile, { immediate: false });
          ui.setLobbyReady(true);
          ui.toast('⏳ คุณจบการวิ่งในรอบนี้แล้ว — เข้าคิวรอรอบถัดไปเรียบร้อย!', 2600);
          return;
        }
        hasJoinedLobby = true;
        soloRun = false;
        confirmedInRoom = false;
        joinPendingUntil = performance.now() + 1500;
        joinPendingMatchId = preSnap.matchId;
        if (preSnap.phase === 'RUNNING') {
          joinedMatchId = preSnap.matchId;
        }
        net.join(savedProfile, { immediate: true });
        const snap = net.getSnapshot();
        if (
          !isTvMode &&
          snap.phase === 'RUNNING' &&
          (snap.eliminatedIds.includes(savedProfile.id) ||
            snap.activeRunners.some((r) => r.id === savedProfile.id && r.eliminated))
        ) {
          eliminatedMatchId = snap.matchId;
          queuedForNextRound = true;
          ui.setLobbyReady(true);
          ui.toast('⏳ คุณจบการวิ่งในรอบนี้แล้ว — เข้าคิวรอรอบถัดไปเรียบร้อย!', 2600);
          return;
        }
        if (snap.phase === 'RUNNING') {
          joinedMatchId = snap.matchId;
          const elapsed = Math.max(0, snap.matchDuration - snap.phaseTimeLeft);
          startMatchRun(snap.matchSeed, snap.matchDuration, elapsed, snap.maxLives);
          ui.toast(`🏁 "${savedProfile.name}" ลงสนาม CH ${currentChannel} ร่วมวิ่งกับจอทีวีแล้ว!`);
        } else if (snap.phase === 'COUNTDOWN') {
          state = 'countdown';
          ui.show('countdown');
          ui.setCountdown(snap.phaseTimeLeft);
          audio.countdownBeep(false);
        } else {
          ui.setLobbyReady(true);
          ui.toast(`✅ เข้าสู่ Lobby (CH ${currentChannel}) ในชื่อ "${savedProfile.name}" แล้ว! รอ Admin กดปล่อยตัวบนจอทีวี`, 2600);
        }
      },
      queueNextRound: () => {
        audio.unlock();
        audio.click();
        queuedForNextRound = true;
        hasJoinedLobby = true;
        if (!confirmedInRoom) {
          joinPendingUntil = performance.now() + 1500;
          joinPendingMatchId = latestRoom.matchId;
        }
        net.join(savedProfile, { immediate: false });
        const snap = net.getSnapshot();
        const myRunner = snap.activeRunners.find((r) => r.id === savedProfile.id);
        const rank = myRunner ? myRunner.rank : 1;
        const survivedSec =
          lastResultEliminated && myRunner?.eliminated && myRunner.survivedSec !== undefined
            ? myRunner.survivedSec
            : lastSurvivedSec;
        ui.updateResultRank({
          rank,
          totalRunners: snap.activeRunners.length || 1,
          eliminated: lastResultEliminated,
          survivedSec,
          queuedNextRound: true,
        });
      },
      selectChannel: (ch) => {
        const nextCh = sanitizeChannelId(ch);
        if (nextCh === currentChannel) return;
        audio.unlock();
        audio.click();
        clearDeathRevealTimer();
        currentChannel = nextCh;
        hasJoinedLobby = false;
        confirmedInRoom = false;
        joinPendingUntil = 0;
        joinPendingMatchId = -1;
        joinedMatchId = -1;
        eliminatedMatchId = -1;
        lastResultEliminated = false;
        lastSurvivedSec = 0;
        queuedForNextRound = false;
        tvElapsed = 0;
        ui.setLobbyReady(false);
        syncUrlQueryParams();
        ui.setChannel(currentChannel);
        net.setChannel(currentChannel);
        if (!isTvMode && state !== 'start') {
          toLobby(false);
        }
        ui.toast(`📡 สลับเป็นช่องสัญญาณ CH ${currentChannel} แล้ว!`, 1800);
      },
      profileChange: (prof) => {
        applyProfileUpdate(prof);
        if (hasJoinedLobby && !isTvMode) {
          net.join(savedProfile, { immediate: !queuedForNextRound });
        }
      },
      editProfile: () => {
        audio.unlock();
        audio.click();
      },
      controlAction: (act) => {
        audio.unlock();
        onAction(act);
      },
      playSoloNow: (prof) => {
        audio.unlock();
        audio.click();
        applyProfileUpdate(prof);
        ui.updatePlayerPill(savedProfile);
        soloRun = true;
        startMatchRun((Date.now() % 100000) + 1, DEFAULT_MATCH_DURATION, 0, DEFAULT_MAX_LIVES);
      },
      selectAvatar: (avatarId, prof) => {
        audio.unlock();
        audio.click();
        applyProfileUpdate({ ...prof, avatar: sanitizeAvatarId(avatarId) });
        ui.updatePlayerPill(savedProfile);
        world.player.warmUpAction('up');
        avatarPreview.triggerCelebratePose();
        const meta = AVATARS[sanitizeAvatarId(savedProfile.avatar)];
        ui.toast(`${meta.icon} เลือกตัวละคร: ${meta.nameTh} (${meta.genderLabelTh})`, 1400);
        if (hasJoinedLobby && !isTvMode) {
          net.join(savedProfile, { immediate: !queuedForNextRound });
        }
      },
      onPreviewRotate: (deltaRad) => {
        avatarPreview.rotateBy(deltaRad);
      },
      onPreviewTap: () => {
        audio.unlock();
        audio.jump(false);
        avatarPreview.triggerCelebratePose();
      },
      resume: () => {
        if (!canResumeFromPause(state, sim.alive, deathRevealTimer !== null)) return;
        audio.unlock();
        state = 'play';
        audio.startMusic();
        ui.show('play');
      },
      pause: () => {
        if (state === 'start') {
          ui.setLobbyReady(false);
          return;
        }
        if (state !== 'play' || !sim.alive || deathRevealTimer !== null) return;
        state = 'pause';
        audio.stopMusic();
        ui.setPauseMultiplayer(!soloRun);
        ui.show('pause');
      },
      restart: () => {
        if (soloRun) {
          startMatchRun((Date.now() % 100000) + 1, DEFAULT_MATCH_DURATION, 0, DEFAULT_MAX_LIVES);
        } else {
          forfeitActiveRoundIfNeeded();
          toLobby(true);
        }
      },
      home: () => {
        forfeitActiveRoundIfNeeded();
        toLobby(false);
      },
      toggleMute,
      hostCommand: (cmd) => {
        audio.unlock();
        audio.click();
        net.sendHostCommand(cmd);
      },
      toggleTvMode: () => {
        isTvMode = !isTvMode;
        if (isTvMode) {
          clearDeathRevealTimer();
          hasJoinedLobby = false;
          confirmedInRoom = false;
          joinPendingUntil = 0;
          joinPendingMatchId = -1;
          net.leave(savedProfile.id);
        }
        syncUrlQueryParams();
        net.setTvMode(isTvMode);
        ui.setTvMode(isTvMode);
        ui.setChannel(currentChannel);
        if (isTvMode && latestRoom.phase === 'RUNNING' && state !== 'play') {
          startMatchRun(latestRoom.matchSeed, latestRoom.matchDuration, 0, latestRoom.maxLives);
        }
      },
    },
    audio.muted,
    savedProfile,
    isTvMode,
    currentChannel,
  );

  // Do NOT auto-join on startup: wait until the user enters their name & presses "เข้าสู่ Lobby" (#btn-join-sync)!
  window.addEventListener('pagehide', () => {
    if (hasJoinedLobby) {
      net.disconnect(savedProfile.id);
    }
  });

  function toLobby(keepReady = false) {
    clearDeathRevealTimer();
    soloRun = false;
    if (latestRoom.phase === 'LOBBY' || latestRoom.phase === 'COUNTDOWN') {
      joinedMatchId = -1;
      eliminatedMatchId = -1;
      queuedForNextRound = false;
    } else {
      joinedMatchId = latestRoom.matchId;
    }
    lastResultEliminated = false;
    lastSurvivedSec = 0;
    sim.reset(latestRoom.matchSeed, false, latestRoom.matchDuration, latestRoom.maxLives);
    world.resetScenery();
    world.fx.clear();
    audio.stopMusic();
    state = 'start';
    ui.setPauseMultiplayer(false);
    ui.setLobbyReady(keepReady && hasJoinedLobby);
    ui.show('start');
  }

  function startMatchRun(
    seed: number,
    duration: number,
    initialElapsed = 0,
    maxLives = DEFAULT_MAX_LIVES,
  ) {
    clearDeathRevealTimer();
    lastResultEliminated = false;
    lastSurvivedSec = 0;
    queuedForNextRound = false;
    sim.reset(seed, false, duration, maxLives);
    if (!soloRun && !isTvMode) {
      const snap = net.getSnapshot();
      const myRunner =
        snap.activeRunners.find((r) => r.id === savedProfile.id) ??
        latestRoom.activeRunners.find((r) => r.id === savedProfile.id);
      if (
        myRunner &&
        myRunner.lives !== undefined &&
        maxLives > 0 &&
        myRunner.lives < maxLives &&
        !myRunner.eliminated
      ) {
        sim.setLives(myRunner.lives, maxLives);
      }
    }
    world.resetScenery();
    world.fx.clear();
    state = 'play';
    sim.start();
    if (initialElapsed > 0) {
      sim.syncToElapsed(initialElapsed);
    }
    ui.setPauseMultiplayer(!soloRun);
    audio.startMusic();
    ui.show('play');
  }

  net.onSnapshot((snap) => {
    const prevPhase = latestRoom.phase;
    latestRoom = snap;
    ui.updateRoomSnapshot(snap, savedProfile.id);

    if (soloRun) return;

    const hadDeathReveal = deathRevealTimer !== null;
    if (shouldCancelDeathReveal(prevPhase, snap.phase)) {
      clearDeathRevealTimer();
    }

    const myActiveRunner = snap.activeRunners.find((r) => r.id === savedProfile.id);
    const isQueuedInSnap = snap.waitingQueue.some((w) => w.id === savedProfile.id);
    const isEliminatedInSnap =
      eliminatedMatchId === snap.matchId ||
      snap.eliminatedIds.includes(savedProfile.id) ||
      Boolean(myActiveRunner?.eliminated);

    if (
      !isTvMode &&
      (state === 'play' || state === 'pause') &&
      sim.alive &&
      snap.maxLives !== sim.maxLives
    ) {
      sim.setLives(
        snap.maxLives === 0
          ? 0
          : Math.max(1, Math.min(snap.maxLives, sim.lives || snap.maxLives)),
        snap.maxLives,
      );
    } else if (
      !isTvMode &&
      (state === 'start' || state === 'countdown') &&
      snap.maxLives !== sim.maxLives
    ) {
      sim.setLives(snap.maxLives, snap.maxLives);
    }

    if (!isTvMode && state === 'over') {
      const rank = myActiveRunner ? myActiveRunner.rank : 1;
      const survivedSec =
        lastResultEliminated && myActiveRunner?.eliminated && myActiveRunner.survivedSec !== undefined
          ? myActiveRunner.survivedSec
          : lastSurvivedSec;
      ui.updateResultRank({
        rank,
        totalRunners: snap.activeRunners.length || 1,
        eliminated: lastResultEliminated,
        survivedSec,
        queuedNextRound: queuedForNextRound || isQueuedInSnap,
      });
    }

    const isParticipant =
      isTvMode || (hasJoinedLobby && (Boolean(myActiveRunner) || isQueuedInSnap));
    if (!isTvMode && hasJoinedLobby && (Boolean(myActiveRunner) || isQueuedInSnap)) {
      confirmedInRoom = true;
      joinPendingUntil = 0;
    }
    const awaitingJoinAck =
      hasJoinedLobby &&
      !confirmedInRoom &&
      !hadDeathReveal &&
      performance.now() < joinPendingUntil &&
      snap.matchId === joinPendingMatchId &&
      snap.phase !== 'LOBBY' &&
      snap.activeRunners.length > 0;
    if (!isParticipant) {
      if (
        shouldEvictToLobbyOnSnapshot({
          isParticipant,
          isTvMode,
          soloRun,
          hadDeathReveal,
          screen: state,
          awaitingJoinAck,
        })
      ) {
        hasJoinedLobby = false;
        confirmedInRoom = false;
        joinPendingUntil = 0;
        toLobby(false);
      }
      return;
    }

    const canRunCurrentRound =
      isTvMode || (hasJoinedLobby && Boolean(myActiveRunner) && !isEliminatedInSnap);

    if (snap.phase === 'COUNTDOWN' && state !== 'countdown' && canRunCurrentRound) {
      clearDeathRevealTimer();
      queuedForNextRound = false;
      state = 'countdown';
      ui.show('countdown');
      audio.countdownBeep(false);
    } else if (snap.phase === 'RUNNING' && joinedMatchId !== snap.matchId && canRunCurrentRound) {
      joinedMatchId = snap.matchId;
      audio.countdownBeep(true);
      startMatchRun(snap.matchSeed, snap.matchDuration, 0, snap.maxLives);
    } else if (
      !isTvMode &&
      snap.phase === 'RUNNING' &&
      joinedMatchId === snap.matchId &&
      (state === 'play' || state === 'pause') &&
      sim.alive &&
      deathRevealTimer === null &&
      (snap.eliminatedIds.includes(savedProfile.id) || Boolean(myActiveRunner?.eliminated))
    ) {
      eliminatedMatchId = snap.matchId;
      sim.setLives(0, sim.maxLives);
      sim.alive = false;
      sim.running = false;
      lastResultEliminated = true;
      lastSurvivedSec = myActiveRunner?.survivedSec ?? sim.survivedSec;
      queuedForNextRound = false;
      audio.eliminated();
      audio.stopMusic();
      persistRunProgress(Math.floor(sim.score));
      state = 'over';
      ui.result({
        score: Math.floor(sim.score),
        coins: sim.coins,
        distance: Math.floor(sim.d),
        rank: myActiveRunner?.rank ?? 1,
        totalRunners: snap.activeRunners.length || 1,
        collectedCenters: sim.collectedCenters,
        soloRun: false,
        eliminated: true,
        maxLives: sim.maxLives > 0 ? sim.maxLives : DEFAULT_MAX_LIVES,
        survivedSec: lastSurvivedSec,
        queuedNextRound: false,
      });
      ui.show('over');
    } else if (
      !isTvMode &&
      snap.phase === 'PODIUM' &&
      (state === 'play' || state === 'pause') &&
      sim.alive &&
      deathRevealTimer === null &&
      !lastResultEliminated
    ) {
      const serverElim =
        snap.eliminatedIds.includes(savedProfile.id) || Boolean(myActiveRunner?.eliminated);
      sim.running = false;
      if (serverElim) {
        eliminatedMatchId = snap.matchId;
        sim.setLives(0, sim.maxLives);
        sim.alive = false;
        lastResultEliminated = true;
        lastSurvivedSec = myActiveRunner?.survivedSec ?? sim.survivedSec;
        queuedForNextRound = false;
        audio.eliminated();
        audio.stopMusic();
      } else {
        sim.finished = true;
        lastResultEliminated = false;
        lastSurvivedSec = sim.survivedSec;
        queuedForNextRound = false;
        publishRunnerStateNow();
        audio.finishFanfare();
        audio.stopMusic();
      }
      persistRunProgress(Math.floor(sim.score));
      state = 'over';
      ui.result({
        score: Math.floor(sim.score),
        coins: sim.coins,
        distance: Math.floor(sim.d),
        rank: myActiveRunner?.rank ?? 1,
        totalRunners: snap.activeRunners.length || 1,
        collectedCenters: sim.collectedCenters,
        soloRun: false,
        eliminated: serverElim,
        maxLives: sim.maxLives > 0 ? sim.maxLives : DEFAULT_MAX_LIVES,
        survivedSec: lastSurvivedSec,
        queuedNextRound: false,
      });
      ui.show('over');
    } else if (snap.phase === 'LOBBY' && prevPhase !== 'LOBBY') {
      toLobby(!isTvMode);
      if (!isTvMode && (prevPhase === 'RUNNING' || prevPhase === 'COUNTDOWN')) {
        ui.toast('🛑 Admin รีเซ็ตรอบแล้ว — เตรียมพร้อมที่จุดปล่อยตัว!', 2200);
      }
    }

    if (state === 'countdown') {
      ui.setCountdown(snap.phaseTimeLeft);
    }
  });

  function publishRunnerStateNow() {
    if (soloRun || isTvMode || !hasJoinedLobby) return;
    netPublishTimer = 0;
    const jumpLiftY = !sim.grounded && sim.vy > 0 && sim.y < 0.3 ? 0.35 : sim.y;
    net.sendRunnerState(savedProfile.id, {
      name: savedProfile.name,
      role: savedProfile.role,
      color: savedProfile.color,
      avatar: savedProfile.avatar,
      lane: sim.lane,
      x: +laneX(sim.lane).toFixed(2),
      y: +jumpLiftY.toFixed(2),
      d: +sim.d.toFixed(1),
      score: Math.floor(sim.score),
      coins: sim.coins,
      floor: sim.floor,
      activeCenter: sim.activeCenter,
      collectedCount: sim.collectedCenters.size,
      sliding: sim.sliding,
      stumbling: sim.stumbleSlow > 0.1 || sim.sinceStumble < 1.4,
      lives: sim.lives,
      maxLives: sim.maxLives,
      eliminated: !sim.alive,
      survivedSec: +sim.survivedSec.toFixed(2),
    });
  }

  function onAction(a: Action) {
    if (a === 'mute') {
      toggleMute();
      return;
    }
    if (state === 'start') {
      // Interactive Warm-Up in the Waiting Lobby!
      if (a === 'left' || a === 'right' || a === 'up' || a === 'down') {
        audio.unlock();
        if (a === 'up') audio.jump(false);
        else if (a === 'down') audio.slide();
        else audio.lane();
        world.player.warmUpAction(a);
        if (a === 'left') sim.lane = Math.max(0, sim.lane - 1);
        else if (a === 'right') sim.lane = Math.min(2, sim.lane + 1);
        if (hasJoinedLobby) {
          net.sendRunnerState(savedProfile.id, {
            name: savedProfile.name,
            role: savedProfile.role,
            color: savedProfile.color,
            avatar: savedProfile.avatar,
            lane: sim.lane,
            x: laneX(sim.lane),
            y: a === 'up' ? 1.25 : 0,
          });
          if (a === 'up') {
            window.setTimeout(() => {
              if (state === 'start' && hasJoinedLobby) {
                net.sendRunnerState(savedProfile.id, { y: 0 });
              }
            }, 420);
          }
        }
      }
      return;
    }
    if (state === 'pause') {
      if (!canResumeFromPause(state, sim.alive, deathRevealTimer !== null)) return;
      if (a === 'pause' || a === 'confirm') {
        audio.unlock();
        state = 'play';
        audio.startMusic();
        ui.show('play');
      }
      return;
    }
    if (state !== 'play') return;
    audio.unlock();
    if (a === 'pause') {
      if (!sim.alive || deathRevealTimer !== null) return;
      state = 'pause';
      audio.stopMusic();
      ui.setPauseMultiplayer(!soloRun);
      ui.show('pause');
    } else if (a === 'left') {
      sim.left();
      publishRunnerStateNow();
    } else if (a === 'right') {
      sim.right();
      publishRunnerStateNow();
    } else if (a === 'up') {
      sim.jump();
      publishRunnerStateNow();
    } else if (a === 'down') {
      sim.down();
      publishRunnerStateNow();
    }
  }

  bindInput(document.getElementById('ui')!, onAction, () => state === 'play' || state === 'start');

  function handleSimEvent(ev: SimEvent) {
    world.event(ev);
    switch (ev.type) {
      case 'jump': audio.jump(ev.super); break;
      case 'slide': audio.slide(); break;
      case 'lane': audio.lane(); break;
      case 'bump': audio.bump(); break;
      case 'land': if (ev.fall > 0.5) audio.land(); break;
      case 'coin': audio.coin(ev.streak); break;
      case 'centerPower': {
        audio.centerPower(ev.centerId);
        ui.flash('power');
        ui.showCenterBanner(ev.centerId);
        break;
      }
      case 'centerPowerEnd': audio.powerEnd(); break;
      case 'shieldBlock': {
        audio.shieldBlock();
        ui.toast(`🛡️ เกราะพลังงานสะอาดป้องกันการชน! (เหลือ ${ev.remaining} ครั้ง)`);
        break;
      }
      case 'armorSmash': {
        audio.armorSmash();
        ui.toast(`🚄 ชนทะลุสิ่งกีดขวาง! +${ev.bonus} แต้ม`);
        break;
      }
      case 'floorChange': {
        audio.level();
        break;
      }
      case 'centerStageChange': {
        audio.level();
        const meta = CENTERS[ev.centerId];
        ui.toast(`🌟 ด่าน ${ev.stageIndex + 1}/9 · ${meta.icon} #${meta.id} ${meta.shortTh}`, 1500);
        break;
      }
      case 'stumble':
      case 'hit': {
        audio.stumble();
        ui.flash('hit');
        if (ev.lostLife && (ev.livesLeft ?? 0) > 0) {
          ui.toast(
            `💔 ชนสิ่งกีดขวาง! เหลือ ${ev.livesLeft}/${ev.maxLives} ชีวิต (-${ev.penalty} แต้ม)`,
            1500,
          );
        } else if (!ev.lostLife) {
          ui.toast(`⚠️ เฉี่ยวสิ่งกีดขวาง -${ev.penalty} แต้ม`, 1000);
        }
        break;
      }
      case 'eliminated': {
        lastResultEliminated = true;
        lastSurvivedSec = ev.survivedSec;
        queuedForNextRound = false;
        if (!soloRun) {
          eliminatedMatchId = latestRoom.matchId;
        }
        if (state === 'pause') {
          state = 'play';
          ui.show('play');
        }
        audio.eliminated();
        audio.stopMusic();
        ui.flash('hit');
        publishRunnerStateNow();
        const shownMaxLives = sim.maxLives > 0 ? sim.maxLives : DEFAULT_MAX_LIVES;
        ui.toast(`💥 ชนครบ ${shownMaxLives} ครั้ง! สิ้นสุดการวิ่ง`, 1800);
        persistRunProgress(ev.score);

        const elimScore = ev.score;
        const elimCoins = ev.coins;
        const elimDistance = ev.distance;
        const elimSurvivedSec = ev.survivedSec;
        const elimMaxLives = shownMaxLives;
        const elimCenters = new Set<CenterId>(sim.collectedCenters);
        const elimSolo = soloRun;

        clearDeathRevealTimer();
        deathRevealTimer = window.setTimeout(() => {
          deathRevealTimer = null;
          if (isTvMode) return;
          audio.stopMusic();
          const myRunner = latestRoom.activeRunners.find((r) => r.id === savedProfile.id);
          const rank = myRunner ? myRunner.rank : 1;
          const survivedSec =
            !elimSolo && myRunner?.eliminated && myRunner.survivedSec !== undefined
              ? myRunner.survivedSec
              : elimSurvivedSec;
          lastSurvivedSec = survivedSec;
          state = 'over';
          ui.result({
            score: elimScore,
            coins: elimCoins,
            distance: elimDistance,
            rank,
            totalRunners: latestRoom.activeRunners.length || 1,
            collectedCenters: elimCenters,
            soloRun: elimSolo,
            eliminated: true,
            maxLives: elimMaxLives,
            survivedSec,
            queuedNextRound: queuedForNextRound,
          });
          ui.show('over');
        }, 1200);
        break;
      }
      case 'finish': {
        clearDeathRevealTimer();
        lastResultEliminated = false;
        lastSurvivedSec = sim.survivedSec;
        queuedForNextRound = false;
        publishRunnerStateNow();
        audio.finishFanfare();
        audio.stopMusic();
        persistRunProgress(ev.score);

        const myRunner = latestRoom.activeRunners.find((r) => r.id === savedProfile.id);
        const rank = myRunner ? myRunner.rank : 1;
        state = 'over';
        ui.result({
          score: ev.score,
          coins: ev.coins,
          distance: ev.distance,
          rank,
          totalRunners: latestRoom.activeRunners.length || 1,
          collectedCenters: sim.collectedCenters,
          soloRun,
          eliminated: false,
          maxLives: sim.maxLives > 0 ? sim.maxLives : DEFAULT_MAX_LIVES,
          survivedSec: sim.survivedSec,
          queuedNextRound: false,
        });
        ui.show('over');
        break;
      }
      case 'hint': {
        const hintMap = {
          jump: 'ปัดขึ้น / กด Space เพื่อกระโดดข้าม!',
          slide: 'ปัดลง / กด S เพื่อกลิ้งลอดแผงกั้น!',
          lane: 'ปัดซ้าย-ขวา เพื่อหลบขบวนรถไฟ!',
          ramp: 'วิ่งขึ้นทางลาดเพื่อไต่หลังคารถไฟ!',
        };
        ui.hint(hintMap[ev.hint], 2200);
        break;
      }
    }
  }

  function tick(dt: number, draw = true) {
    if (isTvMode) {
      // TV Live Arena: smoothly advance camera & track at 60 FPS with drift correction toward room snapshot
      sim.invincible = true;
      const tv = stepTvClock(
        tvElapsed,
        dt,
        latestRoom.phase,
        latestRoom.phaseTimeLeft,
        latestRoom.matchDuration,
      );
      tvElapsed = tv.elapsed;
      if (latestRoom.phase === 'RUNNING') {
        sim.matchDuration = latestRoom.matchDuration;
        sim.time = tv.elapsed;
        sim.floor = tv.floor;
        sim.stageIndex = tv.stageIndex;
        sim.stageCenter = tv.stageCenter;
        const leadHuman = latestRoom.activeRunners.find((r) => !r.isBot && !r.eliminated);
        if (leadHuman && leadHuman.d > 0) {
          let speedMul = 1;
          if (leadHuman.stumbling) speedMul = 0.7;
          else if (leadHuman.activeCenter === 1 || leadHuman.activeCenter === 9) speedMul = 1.35;
          else if (leadHuman.activeCenter === 3) speedMul = 1.2;
          sim.speed = tv.speed * speedMul;
          const nextD = sim.d + sim.speed * dt;
          const diffD = leadHuman.d - nextD;
          if (Math.abs(diffD) > 25 || sim.d <= 0) {
            sim.d = leadHuman.d;
          } else {
            sim.d = Math.max(sim.d, nextD + diffD * Math.min(1, dt * 10));
          }
        } else {
          sim.d = tv.d;
          sim.speed = tv.speed;
        }
        sim.updateMovers();
        sim.track.ensure(sim.d + VIEW_AHEAD);
        sim.recycle();
      } else {
        sim.d = 0;
        sim.speed = 0;
      }
      sim.drainEvents();
    } else if (shouldStepSimInScreen(state, soloRun)) {
      sim.invincible = false;
      sim.update(dt);
      netPublishTimer += dt;
    }

    const events = isTvMode ? [] : sim.drainEvents();
    let hasUrgentSimEvent = false;
    for (const ev of events) {
      handleSimEvent(ev);
      if (
        ev.type === 'lane' ||
        ev.type === 'jump' ||
        ev.type === 'land' ||
        ev.type === 'slide' ||
        ev.type === 'centerPower' ||
        ev.type === 'centerPowerEnd' ||
        ev.type === 'stumble' ||
        ev.type === 'hit'
      ) {
        hasUrgentSimEvent = true;
      }
    }
    if (
      shouldStepSimInScreen(state, soloRun) &&
      !soloRun &&
      sim.alive &&
      (hasUrgentSimEvent || netPublishTimer >= 0.05)
    ) {
      publishRunnerStateNow();
    }

    const viewDt = state === 'pause' && soloRun ? 0 : dt;
    const inMenu = isTvMode ? false : state === 'start';
    if (!inMenu && !isTvMode) {
      world.player.update(sim, viewDt, events);
    }
    const visibleGhosts =
      !soloRun && (isTvMode || latestRoom.phase === 'RUNNING') ? latestRoom.activeRunners : [];
    world.sync(sim, viewDt, inMenu, visibleGhosts, savedProfile.id, isTvMode);

    audio.tempo = 112 + (sim.speed - SPEED.start) * 1.5;

    let rumble = 0;
    if (state === 'play') {
      for (const o of sim.obs) {
        if (o.kind !== 'mtrain' || o.d1 < sim.d) continue;
        const gap = Math.max(0, o.d0 - sim.d);
        if (gap < 130) rumble = Math.max(rumble, 1 - gap / 130);
        if (gap < 90 && !horned.has(o.id)) {
          horned.add(o.id);
          audio.horn();
        }
      }
      if (horned.size > 50) horned.clear();
    }
    audio.rumble(rumble);

    if (!isTvMode) {
      const myRunner = latestRoom.activeRunners.find((r) => r.id === savedProfile.id);
      const myRank = myRunner ? myRunner.rank : 1;
      const badgeColor = sim.activeCenter ? CENTERS[sim.activeCenter].color : savedProfile.color;
      world.player.setProfileBadge(savedProfile.name, myRank, badgeColor);
      const stageMeta = CENTERS[sim.stageCenter];
      const isLobbyWaiting = state === 'start';
      ui.hud({
        score: Math.floor(sim.score),
        coins: sim.coins,
        mult: sim.mult,
        lives: sim.lives,
        maxLives: sim.maxLives,
        floor: sim.floor,
        zoneNameTh: isLobbyWaiting
          ? '🟢 ประจำจุดปล่อยตัวแล้ว · รอ Admin กดเริ่มบนจอทีวี!'
          : `${stageMeta.icon} ด่าน ${sim.stageIndex + 1}/9 · ${stageMeta.shortTh}`,
        timeLeft: sim.timeLeft,
        progress01: sim.progress01,
        activeCenter: sim.activeCenter,
        centerTimer: sim.centerTimer,
        shieldHits: sim.shieldHits,
        collectedCenters: sim.collectedCenters,
        rank: myRank,
        totalRunners: latestRoom.activeRunners.length || 1,
        soloRun,
      });
    }

    if (draw) {
      if (
        shouldRenderAvatarPreview({
          isTvMode,
          screen: state,
          lobbyReady: ui.isLobbyReady(),
        })
      ) {
        avatarPreview.renderToCanvas(renderer, ui.getAvatarPreviewCanvas(), dt);
      }
      renderer.render(world.scene, world.camera);
    }
  }

  world.sync(sim, 0, true, latestRoom.activeRunners, savedProfile.id, isTvMode);
  world.warm(renderer);
  ui.setAvatarPortraits(avatarPreview.capturePortraits(renderer));
  renderer.render(world.scene, world.camera);
  setLoaderProgress(1, 'พร้อมลุย!');
  ui.show(isTvMode ? 'play' : 'start');
  removeLoader();

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    requestAnimationFrame(loop);
  };
  if (!TEST) {
    window.setInterval(() => {
      if (
        document.hidden &&
        !isTvMode &&
        !soloRun &&
        (state === 'play' || state === 'pause') &&
        sim.alive
      ) {
        last = performance.now();
        tick(0.25, false);
      }
    }, 250);
    requestAnimationFrame(loop);
  } else {
    renderer.render(world.scene, world.camera);
  }
}

main().catch((e) => console.error(e));
