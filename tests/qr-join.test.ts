import { describe, expect, it } from 'vitest';
import { resolveMobileJoinUrl, buildJoinQrSvg } from '../src/qr';

describe('LAN Mobile Join URL & Real QR Code SVG', () => {
  it('replaces localhost/127.0.0.1 with fallback LAN IP so mobile phones can connect over Wi-Fi', () => {
    const url = resolveMobileJoinUrl(
      {
        protocol: 'http:',
        hostname: 'localhost',
        port: '5173',
        pathname: '/',
      },
      '192.168.3.5',
    );
    expect(url).toBe('http://192.168.3.5:5173/');

    const ipv4Loopback = resolveMobileJoinUrl(
      {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '5173',
        pathname: '/',
      },
      '192.168.3.5',
    );
    expect(ipv4Loopback).toBe('http://192.168.3.5:5173/');
  });

  it('preserves non-localhost hostname (LAN IP or public domain)', () => {
    const lanUrl = resolveMobileJoinUrl(
      {
        protocol: 'http:',
        hostname: '192.168.3.5',
        port: '5173',
        pathname: '/',
      },
      '10.0.0.1',
    );
    expect(lanUrl).toBe('http://192.168.3.5:5173/');

    const prodUrl = resolveMobileJoinUrl(
      {
        protocol: 'https:',
        hostname: 'techno-surfers.sut.ac.th',
        port: '',
        pathname: '/game/',
      },
      '192.168.3.5',
    );
    expect(prodUrl).toBe('https://techno-surfers.sut.ac.th/game/');

    const kmutnbSubpath = resolveMobileJoinUrl(
      {
        protocol: 'http:',
        hostname: 'it.technopark.kmutnb.ac.th',
        port: '',
        pathname: '/technosurfers',
      },
      '192.168.3.5',
    );
    expect(kmutnbSubpath).toBe('http://it.technopark.kmutnb.ac.th/technosurfers/');
  });

  it('generates a real, deterministic QR Code SVG whose matrix changes with the URL', () => {
    const svgA = buildJoinQrSvg('http://192.168.3.5:5173/');
    const svgB = buildJoinQrSvg('https://techno-surfers.sut.ac.th/');

    expect(svgA).toContain('<svg');
    expect(svgA).toContain('<path');
    expect(svgA).not.toBe(svgB);
  });
});
