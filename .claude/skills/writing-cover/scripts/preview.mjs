#!/usr/bin/env node
// Builds the website and screenshots a post's cover as it appears on the
// index card and as the hero on the post page.
//
//   node .claude/skills/writing-cover/scripts/preview.mjs <slug> [out-dir]
//
// Uses the repo's playwright-core and its downloaded Chromium. The GitHub
// token is only for the changelog page, which the build also renders.

import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const website = resolve(root, 'website');
const [slug, outArg] = process.argv.slice(2);
if (!slug) {
  console.error('usage: preview.mjs <slug> [out-dir]');
  process.exit(1);
}
const out = resolve(outArg ?? resolve(root, '.claude/skills/writing-cover/.preview'));
mkdirSync(out, { recursive: true });

const token = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }).stdout.trim();
const build = spawnSync('npm', ['run', 'build'], {
  cwd: website,
  stdio: 'inherit',
  env: { ...process.env, ...(token ? { GITHUB_TOKEN: token } : {}) },
});
if (build.status !== 0) process.exit(build.status ?? 1);

const port = 4398;
const server = spawn('npx', ['astro', 'preview', '--port', String(port)], { cwd: website, stdio: 'ignore' });
const base = `http://localhost:${port}`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${base}/writing/`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const require = createRequire(resolve(root, 'node_modules/'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}/writing/${slug}/`, { waitUntil: 'networkidle' });
  await page.locator('.writing-hero').screenshot({ path: `${out}/${slug}-hero.png` });
  await page.goto(`${base}/writing/`, { waitUntil: 'networkidle' });
  await page.locator(`.writing-card[href="/writing/${slug}/"]`).screenshot({ path: `${out}/${slug}-card.png` });
  console.log(`${out}/${slug}-hero.png\n${out}/${slug}-card.png`);
} finally {
  await browser.close();
  server.kill();
}
