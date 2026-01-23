import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    minify: false
  },
  optimizeDeps: {
    exclude: ['xterm']
  }
});
