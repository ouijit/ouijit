/**
 * Chat in a real window, against recorded conversations: what only layout and
 * real frames show. Each test's agent replays `e2e/cassettes/<name>*.json` at
 * the pace it was recorded. Re-record with Claude Code signed in:
 *
 *   RECORD_E2E_CHAT=1 npx playwright test --config e2e/playwright.config.ts e2e/chat.test.ts
 *
 * A replayed agent's own commands don't run, so where the app has to see Chat
 * do something, the test calls the API as Chat.
 */
import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { createTestRepo, launchApp } from './fixtures';
import * as fs from 'node:fs';
import * as os from 'node:os';

const execFileAsync = promisify(execFile);
const recording = process.env.RECORD_E2E_CHAT === '1';
const TIMEOUT = recording ? 300_000 : 60_000;

type Fixtures = {
  electronApp: ElectronApplication;
  appPage: Page;
  testRepo: { repoPath: string; cleanup: () => void };
};

const test = base.extend<Fixtures>({
  testRepo: async ({}, use) => {
    const repo = createTestRepo();
    await use(repo);
    repo.cleanup();
  },
  electronApp: async ({}, use, info) => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-e2e-userdata-'));
    const name = `chat-${info.title.split(':')[0].trim().replace(/\W+/g, '-').toLowerCase()}`;
    const app = await launchApp(userData, {
      OUIJIT_E2E_CHAT: path.join(__dirname, 'cassettes', name),
      ...(recording && { OUIJIT_E2E_CHAT_RECORD: '1' }),
    });
    await use(app);
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  },
  appPage: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // The window itself, not an emulated viewport inside it, so layout and resize behave as they do for a person.
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 640));
    await page.waitForFunction(() => window.innerWidth === 1000 && window.innerHeight === 640);
    await use(page);
  },
});

const currentChat = (page: Page) => page.evaluate(async () => (await window.api.homeChat.list()).currentId);

async function chatIdle(page: Page, id: string, timeout = TIMEOUT): Promise<void> {
  await expect
    .poll(() => page.evaluate(async (cid) => (await window.api.chat.snapshot(cid))?.info.status, id), { timeout })
    .toBe('idle');
}

/**
 * Off by default; turned on from Settings, on the host so nothing needs nono,
 * and running without approvals. The sidebar only shows once there is a project.
 */
async function turnChatOn(page: Page, repo: string): Promise<string> {
  await page.evaluate(async (rp) => {
    await window.api.addProject(rp);
    (window as unknown as { __appStore: { getState: () => { setProjects: (p: unknown) => void } } }).__appStore
      .getState()
      .setProjects(await window.api.refreshProjects());
  }, repo);
  await page.evaluate(() => window.api.globalSettings.set('homeChat:sandbox', 'none'));
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  await expect(sidebar.locator('[data-group="home-chat"]')).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('switch', { name: /^Chat/ }).click();
  // Settings take the window, sidebar and all, until closed.
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(sidebar.locator('[data-group="home-chat"]')).toHaveCount(1);
  await sidebar.getByRole('button', { name: 'Chat', exact: true }).click();
  const id = await currentChat(page);
  await chatIdle(page, id);
  // Settings reach the main process: Chat came up where it was told to run.
  expect(await page.evaluate(async (cid) => (await window.api.chat.snapshot(cid))?.info.sandbox, id)).toBeNull();
  await page.evaluate((cid) => window.api.chat.setMode(cid, 'bypassPermissions'), id);
  return id;
}

async function send(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder('Send a message');
  await composer.fill(text);
  await composer.press('Enter');
}

interface Frame {
  said: number[];
  working: boolean;
  cards: number;
  overflow: boolean;
}

/**
 * Every frame until the turn is over and all of it is on screen, and how far
 * from the bottom the page was each time its content changed size. That is
 * read in a resize observer made after the view's own, so it runs after the
 * view has followed the bottom and sees what is painted; read in an
 * animation frame, it would catch the page between the text growing and the
 * view following it, a state never drawn.
 */
function sampleFrames(page: Page, id: string) {
  return page.evaluate(
    (cid) =>
      new Promise<{ frames: Frame[]; gaps: number[] }>((resolve) => {
        const frames: Frame[] = [];
        const gaps: number[] = [];
        const turns = document.querySelector('.chat-turns') as HTMLElement;
        const scroller = turns.closest('.overflow-y-auto') as HTMLElement;
        const observer = new ResizeObserver(() => {
          if (scroller.scrollHeight > scroller.clientHeight) {
            gaps.push(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight);
          }
        });
        observer.observe(turns.parentElement!);
        let settled = 0;
        const tick = async () => {
          frames.push({
            said: [...document.querySelectorAll('.chat-turns .chat-said-in')].map((e) => e.textContent?.length ?? 0),
            working: document.querySelector('[aria-label="Working"]') !== null,
            cards: document.querySelectorAll('[data-chat-decision]').length,
            overflow: scroller.scrollHeight > scroller.clientHeight,
          });
          const snapshot = await window.api.chat.snapshot(cid);
          const full = snapshot?.nodes
            .filter((n) => n.kind === 'assistant_message')
            .reduce((sum, n) => sum + ('text' in n ? n.text.length : 0), 0);
          const shown = frames.at(-1)!.said.reduce((a, b) => a + b, 0);
          settled = snapshot?.info.status === 'idle' && full && shown >= full * 0.98 ? settled + 1 : 0;
          if (settled > 20) {
            observer.disconnect();
            resolve({ frames, gaps });
          } else requestAnimationFrame(() => void tick());
        };
        requestAnimationFrame(() => void tick());
      }),
    id,
  );
}

async function asChat(app: ElectronApplication, id: string, repo: string, args: string[]): Promise<unknown> {
  const { url, token } = await app.evaluate((_electron, ptyId) => {
    const api = (globalThis as { __ouijitE2EApi?: { url: string; tokenFor: (id: string) => string } }).__ouijitE2EApi!;
    return { url: api.url, token: api.tokenFor(ptyId) };
  }, id);
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.resolve(__dirname, '..', 'dist-cli', 'ouijit.js'), '--project', repo, ...args],
    {
      env: { ...process.env, OUIJIT_API_URL: url, OUIJIT_API_TOKEN: token, OUIJIT_SESSION_ID: id },
    },
  );
  return JSON.parse(stdout);
}

test('turn: one line while Chat works, then what it says in order, its work folded, and the page kept at the bottom', async ({
  appPage,
  testRepo,
}) => {
  test.setTimeout(TIMEOUT);
  const id = await turnChatOn(appPage, testRepo.repoPath);
  // The command menu floats above the composer; it never stretches it.
  const composerHeight = () =>
    appPage.getByLabel('Message').evaluate((e) => e.closest('.glass-bevel')!.getBoundingClientRect().height);
  const resting = await composerHeight();
  await appPage.getByLabel('Message').fill('/');
  await expect(appPage.getByRole('listbox', { name: 'Commands' })).toBeVisible();
  expect(await composerHeight()).toBe(resting);
  await appPage.getByLabel('Message').fill('');
  await send(
    appPage,
    'Write two paragraphs about sandboxes for coding agents as a message. Then run `ouijit project list`. Then, under a "## Review" heading, write three paragraphs about reviewing an agent\'s work.',
  );
  const { frames, gaps } = await sampleFrames(appPage, id);

  // Something is on screen from the start: the line saying what it is on, before a word of the reply.
  const firstSaid = frames.findIndex((f) => f.said.length > 0);
  expect(firstSaid).toBeGreaterThan(0);
  expect(frames.slice(0, firstSaid).some((f) => f.working)).toBe(true);

  // A later part never shows while an earlier one is still arriving, and no part ever shrinks:
  // one drawn whole and then started over would.
  const finals = frames.at(-1)!.said;
  expect(finals.length).toBeGreaterThanOrEqual(2);
  for (const [n, frame] of frames.entries()) {
    for (let i = 0; i < frame.said.length - 1; i++) expect(frame.said[i]).toBe(finals[i]);
    const before = frames[n - 1]?.said ?? [];
    frame.said.forEach((length, i) => expect(length).toBeGreaterThanOrEqual(before[i] ?? 0));
  }

  // It arrives over time, not in one frame.
  const growth = frames.map((f) => f.said.reduce((a, b) => a + b, 0)).filter((n, i, all) => i > 0 && n > all[i - 1]);
  expect(growth.length).toBeGreaterThan(20);

  // Once it outgrows the window, the page stays at the bottom every time it grows.
  expect(frames.some((f) => f.overflow)).toBe(true);
  expect(gaps.length).toBeGreaterThan(10);
  expect(gaps.filter((gap) => gap >= 2)).toEqual([]);

  // The command is a closed line; a heading reads as bold text at body size, not a change of size.
  await expect(appPage.getByRole('button', { name: /Ran \d+ commands?/ })).toHaveAttribute('aria-expanded', 'false');
  const sizes = await appPage.evaluate(() => {
    const heading = document.querySelector('.chat-turns h2');
    const paragraph = document.querySelector('.chat-turns .chat-said-in p');
    return heading && paragraph ? [getComputedStyle(heading).fontSize, getComputedStyle(paragraph).fontSize] : null;
  });
  expect(sizes).not.toBeNull();
  expect(sizes![0]).toBe(sizes![1]);
  await expect(appPage.locator('[aria-label="Working"]')).toHaveCount(0);
});

test('decision: a card waits for the words before it, and Chat hears how you decided', async ({
  appPage,
  electronApp,
  testRepo,
}) => {
  test.setTimeout(TIMEOUT);
  const id = await turnChatOn(appPage, testRepo.repoPath);
  await send(
    appPage,
    'Write three paragraphs on why some commands should only run with the user watching, as one message. Do not run any commands. Then end your turn.',
  );

  // While its words are still arriving, Chat asks to run a command on your computer.
  await expect
    .poll(() => appPage.locator('.chat-turns .chat-said-in').count(), { timeout: TIMEOUT })
    .toBeGreaterThan(0);
  expect(await asChat(electronApp, id, testRepo.repoPath, ['ask', 'run', '--', 'echo', 'hi'])).toMatchObject({
    status: 'pending',
  });
  const { frames } = await sampleFrames(appPage, id);
  const revealed = frames.findIndex((f) => f.said.length > 0 && f.said[0] === frames.at(-1)!.said[0]);
  expect(frames.slice(0, revealed).every((f) => f.cards === 0)).toBe(true);
  const card = appPage.locator('[data-chat-decision]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('echo hi');

  // Declined, Chat is told, in a line that says what you did.
  await card.getByRole('button', { name: 'Decline' }).click();
  await expect(card).toHaveCount(0);
  const line = appPage.getByRole('button', { name: /Run echo hi.*Declined/ });
  await expect(line).toBeVisible({ timeout: TIMEOUT });
  await line.click();
  await expect(appPage.locator('.chat-turns pre', { hasText: 'echo hi' })).toBeVisible();
  await chatIdle(appPage, id);
});

test('switching: going to another conversation and back shows the first one whole, without streaming it again, and what it had open beside it', async ({
  appPage,
  electronApp,
  testRepo,
}) => {
  test.setTimeout(TIMEOUT);
  const first = await turnChatOn(appPage, testRepo.repoPath);
  await send(appPage, 'Reply with three sentences about git worktrees.');
  const { frames } = await sampleFrames(appPage, first);
  const shown = frames.at(-1)!.said.reduce((a, b) => a + b, 0);
  expect(shown).toBeGreaterThan(100);

  // What the conversation opens with the CLI sits beside it in a card of its
  // own, under a tab naming it; hidden, the title bar keeps its icon, a way back to it.
  const folder = await appPage.evaluate(async (cid) => (await window.api.chat.snapshot(cid))!.info.cwd, first);
  fs.writeFileSync(path.join(folder, 'calendar.md'), '# Content calendar\n\nWeek one: the sandbox post.\n');
  expect(
    await asChat(electronApp, first, testRepo.repoPath, [
      'panel',
      'open',
      'markdown',
      path.join(folder, 'calendar.md'),
    ]),
  ).toMatchObject({
    panels: [{ kind: 'markdown', label: 'calendar.md', active: true }],
  });
  const tab = appPage.getByRole('tab', { name: 'calendar.md' });
  await expect(tab).toBeVisible();
  await expect(appPage.getByRole('heading', { name: 'Content calendar' })).toBeVisible();
  await expect(appPage.getByPlaceholder('Send a message')).toBeVisible();
  await appPage.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(tab).toHaveCount(0);
  await appPage.getByRole('button', { name: 'calendar.md' }).click();
  await expect(tab).toBeVisible();

  // A new tab becomes what is typed into it: here a file in the conversation's folder.
  fs.writeFileSync(path.join(folder, 'notes.md'), '# Notes\n');
  await appPage.getByRole('button', { name: 'New tab', exact: true }).click();
  const newTab = appPage.getByLabel('Open a shell or a file, or enter a URL');
  await expect(newTab).toBeFocused();
  await newTab.fill('notes');
  await expect(appPage.getByRole('option', { name: /notes\.md/ })).toBeVisible();
  await newTab.press('Enter');
  await expect(appPage.getByRole('tab', { name: 'notes.md' })).toBeVisible();
  await expect(appPage.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(newTab).toHaveCount(0);
  await expect(tab).toBeVisible();

  const sidebar = appPage.getByRole('complementary', { name: 'Sidebar' });
  await sidebar.getByRole('button', { name: 'New chat' }).click({ force: true });
  await expect.poll(() => currentChat(appPage)).not.toBe(first);
  await chatIdle(appPage, await currentChat(appPage));
  // A new conversation has nothing open beside it.
  await expect(appPage.getByRole('tab', { name: 'calendar.md' })).toHaveCount(0);

  await sidebar.getByRole('button', { name: /^Reply with three sentences/ }).click();
  await expect.poll(() => currentChat(appPage)).toBe(first);
  const lengths = await appPage.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        const tick = () => {
          out.push(
            [...document.querySelectorAll('.chat-turns .chat-said-in')].reduce(
              (n, e) => n + (e.textContent?.length ?? 0),
              0,
            ),
          );
          if (out.length < 60) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(lengths.filter((n) => n > 0).every((n) => n === shown)).toBe(true);
  expect(lengths.at(-1)).toBe(shown);

  // Its panel came back with it, and comes back with the window too.
  await expect(appPage.getByRole('tab', { name: 'calendar.md' })).toBeVisible();
  await appPage.reload();
  await appPage
    .getByRole('complementary', { name: 'Sidebar' })
    .getByRole('button', { name: /^Reply with three sentences/ })
    .click();
  await expect(appPage.getByRole('tab', { name: 'calendar.md' })).toBeVisible();
});
