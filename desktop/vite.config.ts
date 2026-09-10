import { offlineHistoryPlugin } from '../tools/catalog/offline-plugin.mjs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss(), offlineHistoryPlugin()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: ['es2021', 'chrome105', 'safari13'] },
});
