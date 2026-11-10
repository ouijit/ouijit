import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import markdownDocs from './tools/markdown-docs.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://ouijit.com',
  integrations: [react(), markdownDocs()],
  vite: {
    plugins: [tailwindcss()],
  },
  redirects: {
    '/docs/kanban': '/docs/worktrees/#board',
    '/docs/resume': '/docs/terminals/#resume',
  },
  build: {
    format: 'directory',
  },
  // The default, 'jsx', drops the space where prose wraps before an inline tag.
  compressHTML: true,
});
