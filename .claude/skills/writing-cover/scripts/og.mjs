#!/usr/bin/env node
// Writes each post's link-preview image, its cover cropped to 1200×630, into
// website/public/assets/og/<slug>.png. The images are committed, so the site
// build never needs a browser; rerun this whenever a cover changes.
//
//   node .claude/skills/writing-cover/scripts/og.mjs

import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const website = resolve(root, 'website');
const out = resolve(website, 'public/assets/og');
mkdirSync(out, { recursive: true });

const slugs = readdirSync(resolve(website, 'src/content/writing'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => basename(f, '.md'));

const token = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }).stdout.trim();
const build = spawnSync('npm', ['run', 'build'], {
  cwd: website,
  stdio: 'inherit',
  env: { ...process.env, ...(token ? { GITHUB_TOKEN: token } : {}) },
});
if (build.status !== 0) process.exit(build.status ?? 1);

const port = 4399;
const server = spawn('npx', ['astro', 'preview', '--port', String(port)], { cwd: website, stdio: 'ignore' });
const base = `http://localhost:${port}`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${base}/`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const require = createRequire(resolve(root, 'node_modules/'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  for (const slug of slugs) {
    await page.goto(`${base}/writing/${slug}/`, { waitUntil: 'networkidle' });
    await page.mouse.move(0, 0);
    // The cover is 16:9 and a preview is 1.91:1, so it is drawn 1200 wide and
    // the overflow is split between top and bottom.
    const box = await page.evaluate(() => {
      const hero = document.querySelector('.writing-hero');
      hero.style.width = hero.style.maxWidth = '1200px';
      hero.querySelector('.writing-cover').style.borderRadius = '0';
      const r = hero.getBoundingClientRect();
      return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height };
    });
    await page.waitForTimeout(300);
    const path = `${out}/${slug}.png`;
    await page.screenshot({
      path,
      fullPage: true,
      clip: { x: box.x, y: box.y + (box.height - 630) / 2, width: 1200, height: 630 },
    });
    console.log(path);
  }
} finally {
  await browser.close();
  server.kill();
}
