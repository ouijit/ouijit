import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://ouijit.com',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@app': new URL('../src', import.meta.url).pathname,
      },
      // Without dedupe, files imported via @app/* resolve react from the
      // root node_modules while website-local files use website/node_modules,
      // pulling two React copies into the bundle and breaking context.
      dedupe: ['react', 'react-dom'],
    },
  },
  build: {
    format: 'directory',
  },
});
