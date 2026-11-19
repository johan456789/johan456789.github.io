import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import mockApi from './web/mock/plugin.mjs';

const root = fileURLToPath(new URL('./web', import.meta.url));
const outDir = fileURLToPath(new URL('./dist', import.meta.url));
const useMock = process.env.MOCK === '1';
const backend = `http://127.0.0.1:${process.env.EDITOR_PORT || 2531}`;

// In mock mode the API and the fake blog pages are served by the plugin itself.
const proxy = useMock
  ? undefined
  : {
      '/_editor/api': { target: backend, changeOrigin: false },
      // everything that is not the editor app goes to the blog (via the editor server)
      '^/(?!_editor/)': { target: backend, changeOrigin: false, ws: true },
    };

export default defineConfig({
  root,
  base: '/_editor/',
  publicDir: 'public',
  plugins: [preact(), ...(useMock ? [mockApi()] : [])],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    proxy,
  },
});
