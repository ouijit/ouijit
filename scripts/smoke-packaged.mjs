#!/usr/bin/env node
/**
 * Smoke test for the packaged app: what only a real build shows. The e2e suite
 * runs the dev bundle; this runs `out/`, signed and with its fuses set, so a
 * dependency that does not survive packaging (the Claude Agent SDK, native
 * modules) fails here.
 *
 *   npm run package && node scripts/smoke-packaged.mjs
 *
 * Needs Claude Code installed and signed in: Chat runs a real turn, in its
 * sandbox. Uses a scratch user-data folder, never your own.
 *
 * The packaged app has the Node inspector fuse off, so Playwright's Electron
 * launcher cannot attach; the window is driven over Chromium's debugging port.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const PORT = 9333;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function packagedBinary() {
  const out = path.join(root, 'out');
  const build = fs.existsSync(out) && fs.readdirSync(out).find((name) => name.startsWith('ouijit-'));
  if (!build) throw new Error('No packaged build in out/. Run `npm run package` first.');
  const dir = path.join(out, build);
  const mac = path.join(dir, 'ouijit.app', 'Contents', 'MacOS', 'ouijit');
  return fs.existsSync(mac) ? mac : path.join(dir, 'ouijit');
}

async function launch(binary, userData) {
  const app = spawn(binary, [`--remote-debugging-port=${PORT}`], {
    env: { ...process.env, OUIJIT_TEST_USER_DATA: userData },
    stdio: 'ignore',
  });
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!browser) throw new Error('The packaged app never opened its debugging port');
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith('file:'));
  if (!page) throw new Error('The packaged app opened no window');
  await page.waitForLoadState('domcontentloaded');
  const close = async () => {
    await browser.close().catch(() => {});
    app.kill();
    await new Promise((resolve) => app.once('exit', resolve));
  };
  return { page, close };
}

async function until(page, fn, arg, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function check(ok, what) {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok - ${what}`);
}

const binary = packagedBinary();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-smoke-'));
console.log(`# ${path.relative(root, binary)}, user data in ${userData}`);

try {
  // Chat is off by default: nothing of it shows, and its agent never starts.
  let app = await launch(binary, userData);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  check(
    (await app.page.locator('[data-group="home-chat"]').count()) === 0,
    'with chat off, the sidebar has no Chat group',
  );
  check(
    (await app.page.evaluate(() => window.api.chat.listLive())).length === 0,
    'with chat off, no chat session runs',
  );

  // Turned on and set to run sandboxed, Chat comes up there and answers a real turn.
  await app.page.evaluate(async () => {
    await window.api.globalSettings.set('chat:enabled', '1');
    await window.api.globalSettings.set('homeChat:sandbox', 'nono');
  });
  await app.close();
  app = await launch(binary, userData);
  await until(
    app.page,
    () => document.querySelector('[data-group="home-chat"]') !== null,
    null,
    15000,
    'the Chat group',
  );
  check(true, 'with chat on, the sidebar has the Chat group');
  const id = await until(
    app.page,
    async () => (await window.api.homeChat.list()).currentId,
    null,
    30000,
    "Chat's conversation",
  );
  const ready = await until(
    app.page,
    async (cid) => {
      const info = (await window.api.chat.snapshot(cid))?.info;
      if (info?.status === 'error') return { error: info.statusDetail ?? 'error' };
      return info?.status === 'idle' && info;
    },
    id,
    90000,
    "Chat's agent to start",
  );
  check(
    !ready.error,
    `Chat's agent starts${ready.error ? `: ${ready.error}` : ` (${ready.agent} ${ready.agentVersion})`}`,
  );
  check(ready.role === 'home' && ready.sandbox !== null, `Chat runs as Chat, in a sandbox (${ready.sandbox})`);
  await app.page.evaluate(
    (cid) => window.api.chat.prompt(cid, { text: 'Reply with only the word: packaged', typed: true }),
    id,
  );
  const reply = await until(
    app.page,
    async (cid) => {
      const s = await window.api.chat.snapshot(cid);
      return s.info.status === 'idle' && s.nodes.find((n) => n.kind === 'assistant_message')?.text;
    },
    id,
    120000,
    "Chat's reply",
  );
  check(/packaged/i.test(reply), `Chat answers a turn (${JSON.stringify(reply)})`);
  await app.close();
  console.log('# smoke passed');
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  fs.rmSync(userData, { recursive: true, force: true });
}
