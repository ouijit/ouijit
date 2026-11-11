import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rolldownOptions: {
      external: ['node-pty', 'koffi', 'better-sqlite3'],
    },
  },
});
