import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  // The main process is bundled to CommonJS, where `import.meta.url` is empty; ES
  // module dependencies (the Claude Agent SDK) resolve their own files from it.
  define: {
    'import.meta.url': 'require("node:url").pathToFileURL(__filename).href',
  },
  build: {
    rolldownOptions: {
      external: ['node-pty', 'koffi', 'better-sqlite3'],
    },
  },
});
