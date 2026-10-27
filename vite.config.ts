import { defineConfig } from 'vite';
import os from 'os';

function detectLanIp(): string {
  const nets = os.networkInterfaces();
  const preferred = ['en0', 'en1', 'wlan0', 'eth0'];
  for (const name of preferred) {
    for (const info of nets[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  for (const [name, list] of Object.entries(nets)) {
    if (name.startsWith('utun') || name.startsWith('tun')) continue;
    for (const info of list || []) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return 'localhost';
}

export default defineConfig({
  base: './',
  define: {
    __LAN_IP__: JSON.stringify(detectLanIp()),
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
    port: 5173,
  },
});
