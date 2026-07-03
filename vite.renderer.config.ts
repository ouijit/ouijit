import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { deriveDevServerPort } from './devServerPort';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    // Not strictPort: on a rare hash collision Vite auto-increments, and the
    // Forge plugin injects the actual bound port into
    // MAIN_WINDOW_VITE_DEV_SERVER_URL either way.
    port: deriveDevServerPort(process.cwd()),
  },
  define: {
    __DEV_WORKTREE_PATH__: command === 'serve' ? JSON.stringify(process.cwd()) : 'null',
  },
  build: {
    minify: false,
  },
  optimizeDeps: {
    exclude: ['xterm'],
  },
}));
