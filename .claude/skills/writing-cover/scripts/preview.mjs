#!/usr/bin/env node
// Builds the website and screenshots a post's cover as the index card and as
// the hero, plus the sketch page when website/.cover-sketches.json exists.
//
//   node .claude/skills/writing-cover/scripts/preview.mjs <slug> [out-dir]
//
// Uses the repo's playwright-core and its downloaded Chromium. The GitHub
// token is only for the changelog page, which the build also renders.

import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
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

// Astro caches rendered Markdown by file digest, so an edit to a remark or
// shiki plugin does not reach a post until the cache goes.
rmSync(resolve(website, 'node_modules/.astro'), { recursive: true, force: true });

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
const written = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  if (existsSync(resolve(website, '.cover-sketches.json'))) {
    await page.goto(`${base}/writing/sketch/`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${out}/sketches.png`, fullPage: true });
    written.push(`${out}/sketches.png`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/writing/${slug}/`, { waitUntil: 'networkidle' });
  const hero = page.locator('.writing-hero');
  await hero.screenshot({ path: `${out}/${slug}-hero.png` });
  const box = await hero.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.15, { steps: 15 });
    await page.waitForTimeout(800);
    await hero.screenshot({ path: `${out}/${slug}-hero-live.png` });
    written.push(`${out}/${slug}-hero-live.png`);
    await page.mouse.move(0, 0);
  }
  await page.goto(`${base}/writing/`, { waitUntil: 'networkidle' });
  await page.locator(`.writing-card[href="/writing/${slug}/"]`).screenshot({ path: `${out}/${slug}-card.png` });
  written.push(`${out}/${slug}-hero.png`, `${out}/${slug}-card.png`);
  console.log(written.join('\n'));
} finally {
  await browser.close();
  server.kill();
}
