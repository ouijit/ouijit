import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import markdownDocs from './tools/markdown-docs.mjs';
import remarkFigures from './tools/remark-figures.mjs';
import rehypeSidenotes from './tools/rehype-sidenotes.mjs';
import shikiTitle from './tools/shiki-title.mjs';

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
  markdown: {
    remarkPlugins: [remarkFigures],
    rehypePlugins: [rehypeSidenotes],
    shikiConfig: { themes: { dark: 'github-dark' }, defaultColor: false, transformers: [shikiTitle()] },
  },
  build: {
    format: 'directory',
  },
});
