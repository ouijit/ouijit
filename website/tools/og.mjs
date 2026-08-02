/**
 * Generate the Open Graph / Twitter card images for the site.
 *
 * Each card is an HTML template rendered at 1200x630 and screenshotted with
 * Playwright, which resolves from the repo root's node_modules (same as
 * capture.mjs). The deploy workflow only runs `astro build` inside website/,
 * so the PNGs are committed to public/assets/ rather than built on deploy.
 *
 * Usage: node website/tools/og.mjs
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const websiteDir = resolve(__dirname, '..');
const repoDir = resolve(websiteDir, '..');

const WIDTH = 1200;
const HEIGHT = 630;

const dataUri = (path, mime) => `data:${mime};base64,${readFileSync(path).toString('base64')}`;

const font = (name) => dataUri(resolve(repoDir, `src/assets/fonts/${name}.woff2`), 'font/woff2');

const asset = (path, mime) => dataUri(resolve(websiteDir, 'public', path), mime);

const agent = (file, name) => ({ name, src: asset(`assets/agents/${file}`, 'image/svg+xml') });

const AGENTS = [
  agent('claude-code.svg', 'Claude Code'),
  agent('codex.svg', 'Codex'),
  agent('pi.svg', 'Pi'),
  agent('opencode.svg', 'OpenCode'),
];

const cards = [
  {
    file: 'og-image.png',
    url: 'ouijit.com',
    title: 'Command parallel coding agents, on your terms',
    subtitle: 'Run Claude, Codex, Pi, and OpenCode in parallel: by hand, with scripts, or through delegation.',
    chips: [
      'Per-task git worktrees',
      'Kanban with lifecycle hooks',
      'Terminal card stacks',
      'Sandboxed agent terminals',
    ],
    agents: AGENTS,
    footnote: 'Free and open source · macOS 13+ · Linux x64',
  },
  {
    file: 'og-docs.png',
    url: 'ouijit.com/docs',
    title: 'Documentation',
    subtitle:
      'Install Ouijit, isolate tasks in worktrees, wire lifecycle hooks, sandbox agent terminals, and drive the app from a shell.',
    chips: [
      'Getting Started',
      'Worktree Isolation',
      'Kanban Board',
      'Terminal Sessions',
      'Sandbox',
      'Hooks',
      'Harnesses',
      'CLI',
    ],
    footnote: 'Free and open source · macOS 13+ · Linux x64',
  },
  {
    file: 'og-faq.png',
    url: 'ouijit.com/faq',
    title: 'FAQ',
    subtitle: 'Common questions about Ouijit, gathered in one place.',
    chips: [
      'What is Ouijit?',
      'Is Ouijit free?',
      'Which CLI agents does Ouijit integrate with?',
      'How does Ouijit isolate work between tasks?',
      'What does the sandbox do?',
      'Where do I download Ouijit?',
    ],
    footnote: 'Free and open source · macOS 13+ · Linux x64',
  },
];

function render(card) {
  const logo = readFileSync(resolve(websiteDir, 'public/assets/ouijit-logo.svg'), 'utf8')
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<!DOCTYPE[^>]*>/, '')
    .replace('width="100%"', 'width="176"')
    .replace('height="100%"', 'height="37"');

  const chips = card.chips.map((c) => `<span class="chip">${c}</span>`).join('');
  const agents = card.agents
    ? `<span class="agents">${card.agents
        .map((a) => `<span class="agent"><img src="${a.src}" /> ${a.name}</span>`)
        .join('')}</span>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>
    @font-face {
      font-family: 'Iosevka Extended';
      src: url('${font('iosevka-extended-regular')}') format('woff2');
    }
    @font-face {
      font-family: 'Iosevka Term Extended';
      src: url('${font('iosevka-term-extended-regular')}') format('woff2');
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      background: #0a0a0c;
      color: #f5f5f7;
      font-family: 'Iosevka Term Extended', 'SF Mono', Monaco, Menlo, monospace;
      overflow: hidden;
    }
    /* The site's CRT treatment: scanlines, RGB phosphor grille, tube vignette. */
    .crt {
      position: absolute;
      inset: 0;
      background-image:
        repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0.4) 0 1px, transparent 1px 3px),
        repeating-linear-gradient(
          to right,
          rgba(255, 0, 0, 0.08) 0 1px,
          rgba(0, 255, 0, 0.08) 1px 2px,
          rgba(0, 0, 255, 0.08) 2px 3px
        ),
        radial-gradient(120% 120% at 50% 50%, transparent 45%, rgba(0, 0, 0, 0.55) 100%);
    }
    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 52px 64px 44px;
    }
    .top { display: flex; align-items: center; justify-content: space-between; }
    .url { font-size: 20px; color: rgba(245, 245, 247, 0.45); }
    .body { margin: auto 0; }
    h1 {
      font-family: 'Iosevka Extended', monospace;
      font-size: ${card.title.length > 20 ? 58 : 76}px;
      letter-spacing: -0.04em;
      line-height: 1.05;
      font-weight: 400;
      margin-bottom: 22px;
      max-width: 26ch;
    }
    .subtitle {
      font-family: system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
      font-size: 25px;
      line-height: 1.45;
      color: rgba(245, 245, 247, 0.7);
      max-width: 780px;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 32px; max-width: 1000px; }
    .chip {
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.03);
      border-radius: 999px;
      padding: 9px 18px;
      font-size: 19px;
      color: rgba(245, 245, 247, 0.75);
    }
    .bottom {
      display: flex;
      align-items: center;
      justify-content: ${card.agents ? 'space-between' : 'flex-start'};
      gap: 32px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 24px;
      font-size: 19px;
      color: rgba(245, 245, 247, 0.55);
    }
    .agents { display: flex; align-items: center; gap: 26px; }
    .agent { display: flex; align-items: center; gap: 9px; }
    .agent img { width: 24px; height: 24px; }
  </style></head><body>
    <div class="crt"></div>
    <div class="card">
      <div class="top">${logo}<span class="url">${card.url}</span></div>
      <div class="body">
        <h1>${card.title}</h1>
        <p class="subtitle">${card.subtitle}</p>
        <div class="chips">${chips}</div>
      </div>
      <div class="bottom">${agents}<span>${card.footnote}</span></div>
    </div>
  </body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
});

for (const card of cards) {
  await page.setContent(render(card), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: 'png' });
  const out = resolve(websiteDir, 'public/assets', card.file);
  writeFileSync(out, png);
  console.log(`wrote ${out}`);
}

await browser.close();
