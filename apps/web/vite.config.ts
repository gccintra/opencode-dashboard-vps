import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { readFileSync } from 'fs';

function readEnvFile(dir: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(resolve(dir, '.env'), 'utf-8')
        .split('\n')
        .flatMap((line) => {
          const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
          return m ? [[m[1], m[2].trim()]] : [];
        }),
    );
  } catch {
    return {};
  }
}

export default defineConfig(() => {
  // Read .env from repo root directly — avoids loadEnv merging process.env
  const env = readEnvFile(resolve(import.meta.dirname, '../..'));
  const serverPort = env.SERVER_PORT || '3001';
  const webPort = parseInt(env.WEB_PORT || '5173', 10);

  return {
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ALF code',
        short_name: 'ALF code',
        description: 'ALF code — manage multiple opencode CLI sessions',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0a0f',
        theme_color: '#0a0a0f',
        orientation: 'any',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        navigateFallback: null,
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-terminal': [
            '@xterm/xterm',
            '@xterm/addon-fit',
            '@xterm/addon-web-links',
            '@xterm/addon-webgl',
            '@xterm/addon-unicode11',
          ],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: webPort,
    proxy: {
      '/api': {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
      '/terminal': {
        target: `http://localhost:${serverPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  };
});
