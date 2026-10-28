import QRCode from 'qrcode';
import { sanitizeChannelId } from './net';

declare const __LAN_IP__: string | undefined;

export interface LocationLike {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  search?: string;
}

export function getInjectedLanIp(): string | undefined {
  try {
    return __LAN_IP__ || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the URL that mobile players should open when scanning the TV Arena QR code.
 * If the TV browser was opened via `localhost` or `127.0.0.1`, substitutes `fallbackLanIp`
 * so phones on the same Wi-Fi connect to the host machine instead of their own loopback.
 * When `channel` is provided (or `?ch=` is present in `loc.search`), appends `?ch=<channel>`
 * so mobile scanners automatically join that TV's channel.
 */
export function resolveMobileJoinUrl(
  loc: LocationLike = window.location,
  fallbackLanIp: string | undefined = getInjectedLanIp(),
  channel?: string | number | null,
): string {
  const isLocalhost =
    loc.hostname === 'localhost' ||
    loc.hostname === '127.0.0.1' ||
    loc.hostname === '[::1]';
  const host = isLocalhost && fallbackLanIp ? fallbackLanIp : loc.hostname || 'localhost';
  const portPart = loc.port ? `:${loc.port}` : '';
  let pathPart = loc.pathname || '/';
  if (!pathPart.endsWith('/') && !pathPart.endsWith('.html')) {
    pathPart += '/';
  }
  const searchCh = loc.search ? new URLSearchParams(loc.search).get('ch') : null;
  const rawCh = channel ?? searchCh;
  const queryPart = rawCh !== undefined && rawCh !== null && String(rawCh).trim() !== ''
    ? `?ch=${sanitizeChannelId(rawCh)}`
    : '';
  return `${loc.protocol}//${host}${portPart}${pathPart}${queryPart}`;
}

/**
 * Generates a real, standards-compliant SVG QR code for `url` synchronously.
 */
export function buildJoinQrSvg(url: string): string {
  const qr = QRCode.create(url || 'http://localhost:5173/', {
    errorCorrectionLevel: 'M',
  });
  const size = qr.modules.size;
  const margin = 2;
  const total = size + margin * 2;
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.modules.get(r, c)) {
        path += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }
  return `<svg viewBox="0 0 ${total} ${total}" width="100%" height="100%" shape-rendering="crispEdges" role="img" aria-label="QR Code สำหรับสแกนเข้าร่วมวิ่ง: ${url}"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${path}" fill="#0f172a"/></svg>`;
}
