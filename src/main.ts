// Start-up, Synchronized Booth Match Room + Solo Play, and 60 FPS frame loop.
import * as THREE from 'three';
import { Sim } from './sim/sim';
import { World } from './view/world';
import { parseGLB, fetchBuffer } from './view/assets';
import { Audio } from './audio';
import { bindInput, type Action } from './input';
import { UI, type Screen } from './ui';
import { load, save } from './storage';
import {
  SPEED, DEFAULT_MATCH_DURATION, VIEW_AHEAD, CENTERS,
  stepTvClock, laneX,
} from './config';
import { NetClient, AVATAR_COLORS, type PlayerProfile, type RoomSnapshot } from './net';
import { sanitizeAvatarId, AVATARS } from './view/avatars';
import type { SimEvent, CenterId } from './sim/types';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
let isTvMode = params.get('mode') === 'tv';

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

  const net = new NetClient(isTvMode);
  let latestRoom: RoomSnapshot = net.getSnapshot();
  let joinedMatchId = -1;
  let soloRun = false;
  let state: Screen = 'start';
  let netPublishTimer = 0;
  let tvElapsed = 0;
  const horned = new Set<number>();

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

  const ui = new UI(
    document.getElementById('ui')!,
    {
      joinQueue: (prof) => {
        audio.unlock();
        audio.click();
        savedProfile.name = prof.name;
        savedProfile.role = prof.role;
        savedProfile.color = prof.color;
        savedProfile.avatar = sanitizeAvatarId(prof.avatar);
        save('profile', savedProfile);
        world.player.setAvatar(savedProfile.avatar);
        soloRun = false;
        net.join(savedProfile, { immediate: true });
        const snap = net.getSnapshot();
        if (snap.phase === 'RUNNING') {
          joinedMatchId = snap.matchId;
          const elapsed = Math.max(0, snap.matchDuration - snap.phaseTimeLeft);
          startMatchRun(snap.matchSeed, snap.matchDuration, elapsed);
          ui.toast('🏁 ลงสนามร่วมวิ่งกับจอทีวีแล้ว! กดปุ่ม ซ้าย/กระโดด/กลิ้ง/ขวา ด้านล่างได้เลย!');
        } else if (snap.phase === 'COUNTDOWN') {
          state = 'countdown';
          ui.show('countdown');
          ui.setCountdown(snap.phaseTimeLeft);
          audio.countdownBeep(false);
        } else {
          ui.setLobbyReady(true);
          ui.toast('✅ ประจำจุดปล่อยตัวแล้ว! ลองกดปุ่มซ้อมมือรอก่อนได้ — รอ Admin กดปล่อยตัวบนจอทีวี', 2600);
        }
      },
      controlAction: (act) => {
        audio.unlock();
        onAction(act);
      },
      playSoloNow: (prof) => {
        audio.unlock();
        audio.click();
        savedProfile.name = prof.name;
        savedProfile.role = prof.role;
        savedProfile.color = prof.color;
        savedProfile.avatar = sanitizeAvatarId(prof.avatar);
        save('profile', savedProfile);
        world.player.setAvatar(savedProfile.avatar);
        soloRun = true;
        startMatchRun((Date.now() % 100000) + 1, DEFAULT_MATCH_DURATION);
      },
      selectAvatar: (avatarId) => {
        audio.unlock();
        audio.click();
        savedProfile.avatar = sanitizeAvatarId(avatarId);
        save('profile', savedProfile);
        world.player.setAvatar(savedProfile.avatar);
        world.player.warmUpAction('up');
        const meta = AVATARS[savedProfile.avatar];
        ui.toast(`${meta.icon} เลือกตัวละคร: ${meta.nameTh} (${meta.genderLabelTh})`, 1400);
        if (!isTvMode) {
          net.join(savedProfile);
        }
      },
      resume: () => {
        if (state !== 'pause') return;
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
        if (state !== 'play') return;
        state = 'pause';
        audio.stopMusic();
        ui.show('pause');
      },
      restart: () => {
        if (soloRun) {
          startMatchRun((Date.now() % 100000) + 1, DEFAULT_MATCH_DURATION);
        } else {
          toLobby(true);
        }
      },
      home: () => toLobby(false),
      toggleMute,
      hostCommand: (cmd) => {
        audio.unlock();
        audio.click();
        net.sendHostCommand(cmd);
      },
      toggleTvMode: () => {
        isTvMode = !isTvMode;
        net.setTvMode(isTvMode);
        ui.setTvMode(isTvMode);
        if (isTvMode && latestRoom.phase === 'RUNNING' && state !== 'play') {
          startMatchRun(latestRoom.matchSeed, latestRoom.matchDuration);
        }
      },
    },
    audio.muted,
    savedProfile,
    isTvMode,
  );

  // Join automatically on startup so the player is visible in the Lobby
  if (!isTvMode) {
    net.join(savedProfile);
  }

  function toLobby(keepReady = false) {
    soloRun = false;
    joinedMatchId = -1;
    sim.reset(latestRoom.matchSeed, false, latestRoom.matchDuration);
    world.resetScenery();
    world.fx.clear();
    audio.stopMusic();
    state = 'start';
    ui.setLobbyReady(keepReady);
    ui.show('start');
  }

  function startMatchRun(seed: number, duration: number, initialElapsed = 0) {
    sim.reset(seed, false, duration);
    world.resetScenery();
    world.fx.clear();
    state = 'play';
    sim.start();
    if (initialElapsed > 0) {
      sim.syncToElapsed(initialElapsed);
    }
    audio.startMusic();
    ui.show('play');
  }

  net.onSnapshot((snap) => {
    const prevPhase = latestRoom.phase;
    latestRoom = snap;
    ui.updateRoomSnapshot(snap, savedProfile.id);

    if (soloRun) return;

    const isParticipant = isTvMode || snap.activeRunners.some((r) => r.id === savedProfile.id);
    if (!isParticipant) return;

    if (snap.phase === 'COUNTDOWN' && state !== 'countdown') {
      state = 'countdown';
      ui.show('countdown');
      audio.countdownBeep(false);
    } else if (snap.phase === 'RUNNING' && joinedMatchId !== snap.matchId) {
      joinedMatchId = snap.matchId;
      audio.countdownBeep(true);
      startMatchRun(snap.matchSeed, snap.matchDuration);
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
    if (soloRun || isTvMode) return;
    netPublishTimer = 0;
    const jumpLiftY = !sim.grounded && sim.vy > 0 && sim.y < 0.3 ? 0.35 : sim.y;
    net.sendRunnerState(savedProfile.id, {
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
      stumbling: sim.stumbleSlow > 0.1 || sim.sinceStumble < 0.65,
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
        net.sendRunnerState(savedProfile.id, {
          lane: sim.lane,
          x: laneX(sim.lane),
          y: a === 'up' ? 1.25 : 0,
        });
        if (a === 'up') {
          window.setTimeout(() => {
            if (state === 'start') {
              net.sendRunnerState(savedProfile.id, { y: 0 });
            }
          }, 420);
        }
      }
      return;
    }
    if (state === 'pause') {
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
      state = 'pause';
      audio.stopMusic();
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
        ui.toast(`🌟 ด่าน ${ev.stageIndex + 1}/9: เข้าสู่ ${meta.icon} ศูนย์ที่ #${meta.id} ${meta.shortTh}!`, 2400);
        break;
      }
      case 'stumble':
      case 'hit': {
        audio.stumble();
        ui.flash('hit');
        ui.toast(`⚠️ สะดุดสิ่งกีดขวาง -${ev.penalty} แต้ม (วิ่งต่อได้!)`, 1300);
        break;
      }
      case 'finish': {
        audio.finishFanfare();
        audio.stopMusic();
        const prevBest = load<number>('bestScore', 0);
        if (ev.score > prevBest) save('bestScore', ev.score);
        const savedCenters = new Set<CenterId>(load<CenterId[]>('collectedCenters', []));
        for (const c of sim.collectedCenters) savedCenters.add(c);
        save('collectedCenters', Array.from(savedCenters));

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
        sim.d = tv.d;
        sim.speed = tv.speed;
        sim.track.ensure(sim.d + VIEW_AHEAD);
        sim.recycle();
      } else {
        sim.speed = 0;
      }
      sim.drainEvents();
    } else if (state === 'play') {
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
    if (state === 'play' && !soloRun && (hasUrgentSimEvent || netPublishTimer >= 0.05)) {
      publishRunnerStateNow();
    }

    const inMenu = isTvMode ? false : state === 'start';
    if (!inMenu && !isTvMode) {
      world.player.update(sim, state === 'pause' ? 0 : dt, events);
    }
    const visibleGhosts =
      !soloRun && (isTvMode || latestRoom.phase === 'RUNNING') ? latestRoom.activeRunners : [];
    world.sync(sim, state === 'pause' ? 0 : dt, inMenu, visibleGhosts, savedProfile.id, isTvMode);

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

    const myRunner = latestRoom.activeRunners.find((r) => r.id === savedProfile.id);
    const stageMeta = CENTERS[sim.stageCenter];
    ui.hud({
      score: Math.floor(sim.score),
      coins: sim.coins,
      mult: sim.mult,
      floor: sim.floor,
      zoneNameTh: `${stageMeta.icon} ด่าน ${sim.stageIndex + 1}/9 · ${stageMeta.shortTh}`,
      timeLeft: sim.timeLeft,
      progress01: sim.progress01,
      activeCenter: sim.activeCenter,
      centerTimer: sim.centerTimer,
      shieldHits: sim.shieldHits,
      collectedCenters: sim.collectedCenters,
      rank: myRunner ? myRunner.rank : 1,
      totalRunners: latestRoom.activeRunners.length || 1,
      soloRun,
    });

    if (draw) renderer.render(world.scene, world.camera);
  }

  world.sync(sim, 0, true, latestRoom.activeRunners, savedProfile.id, isTvMode);
  world.warm(renderer);
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
  if (!TEST) requestAnimationFrame(loop);
  else renderer.render(world.scene, world.camera);
}

main().catch((e) => console.error(e));
