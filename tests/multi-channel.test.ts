import { describe, expect, it } from 'vitest';
import {
  CHANNEL_LIST,
  MultiChannelRoomRegistry,
  sanitizeChannelId,
} from '../src/net';
import { buildJoinQrSvg, resolveMobileJoinUrl } from '../src/qr';

describe('Multi-Channel Booth Arena (CH 1 - CH 4)', () => {
  it('normalizes channel IDs to 1..4 with fallback to 1', () => {
    expect(CHANNEL_LIST).toEqual(['1', '2', '3', '4']);
    expect(sanitizeChannelId('1')).toBe('1');
    expect(sanitizeChannelId('2')).toBe('2');
    expect(sanitizeChannelId('3')).toBe('3');
    expect(sanitizeChannelId('4')).toBe('4');
    expect(sanitizeChannelId(3)).toBe('3');
    expect(sanitizeChannelId('99')).toBe('1');
    expect(sanitizeChannelId('')).toBe('1');
    expect(sanitizeChannelId(null)).toBe('1');
    expect(sanitizeChannelId(undefined)).toBe('1');
  });

  it('maintains completely independent rooms, bots, timers, and Hall of Fame per channel', () => {
    const registry = new MultiChannelRoomRegistry(4);

    // Channel 2 clears bots, adds a human runner, and starts a match
    const room1 = registry.getRoom('1');
    const room2 = registry.getRoom('2');

    room2.hostCommand({ action: 'clear_bots' });
    room2.join(
      {
        id: 'p-ch2',
        name: 'นนท์ CH2',
        role: 'senior',
        color: '#38bdf8',
        avatar: 'non',
      },
      { immediate: true },
    );
    room2.hostCommand({ action: 'start_now' });
    room2.tick(4.0); // enters RUNNING
    room2.updateRunnerState('p-ch2', { d: 450, score: 15000 });

    // Channel 1 must still be in LOBBY with its 4 initial bots and no p-ch2
    const snap1 = room1.getSnapshot();
    const snap2 = room2.getSnapshot();

    expect(snap1.channel).toBe('1');
    expect(snap2.channel).toBe('2');
    expect(snap1.phase).toBe('LOBBY');
    expect(snap1.activeRunners.length).toBe(4);
    expect(snap1.activeRunners.every((r) => r.isBot)).toBe(true);

    expect(snap2.phase).toBe('RUNNING');
    expect(snap2.activeRunners.map((r) => r.id)).toEqual(['p-ch2']);

    // Finish Channel 2 round so its Hall of Fame updates
    room2.tick(180);
    expect(room2.phase).toBe('PODIUM');
    expect(room2.getSnapshot().allDayBest[0].name).toBe('นนท์ CH2');
    expect(room1.getSnapshot().allDayBest[0].name).not.toBe('นนท์ CH2');
  });

  it('removes a player from the previous channel when switching channels via registry', () => {
    const registry = new MultiChannelRoomRegistry(0);

    registry.applyMessage(
      {
        type: 'join',
        channel: '1',
        profile: { id: 'p-switch', name: 'เมย์', role: 'junior', color: '#ec4899', avatar: 'may' },
        immediate: true,
      },
      '1',
    );
    expect(registry.getRoom('1').getSnapshot().activeRunners.some((r) => r.id === 'p-switch')).toBe(true);

    // Player switches from CH 1 to CH 3: leaves CH 1 and joins CH 3
    registry.applyMessage({ type: 'leave', channel: '1', id: 'p-switch' }, '1');
    registry.applyMessage(
      {
        type: 'join',
        channel: '3',
        profile: { id: 'p-switch', name: 'เมย์', role: 'junior', color: '#ec4899', avatar: 'may' },
        immediate: true,
      },
      '3',
    );

    expect(registry.getRoom('1').getSnapshot().activeRunners.some((r) => r.id === 'p-switch')).toBe(false);
    expect(registry.getRoom('3').getSnapshot().activeRunners.some((r) => r.id === 'p-switch')).toBe(true);
  });

  it('embeds ?ch=<channel> into QR mobile join URLs so scanning a TV joins its channel', () => {
    const urlCh3 = resolveMobileJoinUrl(
      {
        protocol: 'http:',
        hostname: 'it.technopark.kmutnb.ac.th',
        port: '',
        pathname: '/technosurfers/',
      },
      undefined,
      '3',
    );
    expect(urlCh3).toBe('http://it.technopark.kmutnb.ac.th/technosurfers/?ch=3');

    const svg = buildJoinQrSvg(urlCh3);
    expect(svg).toContain('?ch=3');
  });
});
