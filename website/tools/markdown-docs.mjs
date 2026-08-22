/**
 * Astro integration that gives every docs page a Markdown twin.
 *
 * After the static build it converts each rendered docs page to Markdown at
 * /docs/<slug>.md and concatenates them into /llms-full.txt, so agents can
 * read the docs without parsing HTML. The "Copy page" action on each page
 * fetches its own .md twin, so this must stay in the build.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { DOC_PAGES } from '../src/docsNav';

const SITE = 'https://ouijit.com';

function buildTurndown() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  turndown.use(gfm);
  turndown.remove('nav');
  turndown.remove('script');
  // The page-action buttons are chrome, not content.
  turndown.addRule('drop-docs-actions', {
    filter: (node) => node.nodeType === 1 && /\bdocs-actions\b/.test(node.getAttribute?.('class') ?? ''),
    replacement: () => '',
  });
  return turndown;
}

function absoluteUrls(markdown) {
  return markdown.replace(/(\]\()\/(?!\/)/g, `$1${SITE}/`);
}

function extractContent(html) {
  const match = html.match(/<main class="docs-content">([\s\S]*?)<\/main>/);
  if (!match) throw new Error('No <main class="docs-content"> found');
  return match[1];
}

function pageMarkdown(turndown, page, distDir) {
  const dir = page.slug === 'getting-started' ? 'docs' : `docs/${page.slug}`;
  const html = fs.readFileSync(path.join(distDir, dir, 'index.html'), 'utf8');
  const body = absoluteUrls(turndown.turndown(extractContent(html)));
  return `${body}\n`;
}

export default function markdownDocs() {
  return {
    name: 'markdown-docs',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const distDir = fileURLToPath(dir);
        const turndown = buildTurndown();
        const full = [];

        for (const page of DOC_PAGES) {
          const markdown = pageMarkdown(turndown, page, distDir);
          const header = `<!-- ${SITE}${page.href} · rendered as Markdown for agents and LLMs -->\n\n`;
          fs.writeFileSync(path.join(distDir, 'docs', `${page.slug}.md`), header + markdown);
          full.push(markdown);
        }

        const preamble =
          `# Ouijit documentation\n\n` +
          `Every page below is also served on its own: ${SITE}/docs/<slug>.md ` +
          `(for example ${SITE}/docs/cli.md). Index with per-page summaries: ${SITE}/llms.txt\n\n`;
        fs.writeFileSync(path.join(distDir, 'llms-full.txt'), preamble + full.join('\n---\n\n'));

        console.log(`markdown-docs: wrote ${DOC_PAGES.length} .md pages and llms-full.txt`);
      },
    },
  };
}
