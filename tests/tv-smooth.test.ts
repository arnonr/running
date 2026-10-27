import { describe, it, expect } from 'vitest';
import { stepTvClock } from '../src/config';
import { nameBadgeTexture, NAME_BADGE_CACHE_LIMIT } from '../src/view/textures';
import { createCenterAttachments, updateCenterAttachments } from '../src/view/player';
import { MatchRoomCore } from '../src/net';

describe('TV Mode 60 FPS Smooth Clock & Badge Cache', () => {
  it('advances elapsed time and distance smoothly across 60 FPS frames even while 10Hz snapshot phaseTimeLeft is unchanged', () => {
    let elapsed = 10.0;
    const distances: number[] = [];
    // Simulate 5 frames at 60 FPS (dt = 1/60) while snapshot phaseTimeLeft stays frozen at 170.0s (targetElapsed = 10.0s)
    for (let f = 0; f < 5; f++) {
      const st = stepTvClock(elapsed, 1 / 60, 'RUNNING', 170.0, 180);
      expect(st.d).toBeGreaterThan(distances[distances.length - 1] ?? 0);
      elapsed = st.elapsed;
      distances.push(st.d);
    }
    expect(distances[4]).toBeGreaterThan(distances[0]);
  });

  it('snaps immediately on large time jumps (> 1.5s) and resets cleanly when not RUNNING', () => {
    const jumped = stepTvClock(2.0, 1 / 60, 'RUNNING', 150.0, 180);
    expect(jumped.elapsed).toBeCloseTo(30.0, 2);

    const lobby = stepTvClock(30.0, 1 / 60, 'LOBBY', 45.0, 180);
    expect(lobby.elapsed).toBe(0);
    expect(lobby.d).toBe(0);
    expect(lobby.speed).toBe(0);
  });

  it('caches nameBadgeTexture instances and bounds the cache at NAME_BADGE_CACHE_LIMIT (64)', () => {
    expect(NAME_BADGE_CACHE_LIMIT).toBe(64);
    const t1 = nameBadgeTexture('น้องเมย์', 1, '#f472b6');
    const t2 = nameBadgeTexture('น้องเมย์', 1, '#f472b6');
    expect(t1).toBe(t2);

    // Fill beyond 64 unique keys and verify oldest is evicted
    for (let i = 0; i < NAME_BADGE_CACHE_LIMIT + 2; i++) {
      nameBadgeTexture(`Runner-${i}`, (i % 10) + 1, '#38bdf8');
    }
    const t3 = nameBadgeTexture('น้องเมย์', 1, '#f472b6');
    expect(t3).not.toBe(t1);
  });

  it('creates 9-Center 3D attachments for TV ghost runners and propagates flying/stumbling/sliding states', () => {
    const attachments = createCenterAttachments();
    expect(Object.keys(attachments)).toHaveLength(9);

    updateCenterAttachments(attachments, 1, 1.5);
    expect(attachments[1].visible).toBe(true);
    expect(attachments[4].visible).toBe(false);

    updateCenterAttachments(attachments, 4, 2.0);
    expect(attachments[1].visible).toBe(false);
    expect(attachments[4].visible).toBe(true);

    const room = new MatchRoomCore();
    room.join({ id: 'p1', name: 'นนท์', role: 'senior', color: '#38bdf8' }, { immediate: true });
    room.hostCommand({ action: 'start_now' });
    room.tick(3.6);
    room.updateRunnerState('p1', { activeCenter: 1, y: 4.2, sliding: true, stumbling: true });
    const r = room.getSnapshot().activeRunners.find((x) => x.id === 'p1');
    expect(r?.activeCenter).toBe(1);
    expect(r?.y).toBeCloseTo(4.2, 1);
    expect(r?.sliding).toBe(true);
    expect(r?.stumbling).toBe(true);
  });
});
