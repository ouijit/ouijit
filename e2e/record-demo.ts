/**
 * Automated rrweb demo recording via Playwright.
 *
 * Launches the Electron app, injects rrweb, scripts a demo flow, and writes
 * the recording to website/assets/recording.json.
 *
 * Run: npm run record-demo
 * Iterate: edit the flow below, re-run, `npx serve website` to preview.
 */

import { test } from './fixtures';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page, Locator } from '@playwright/test';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Move mouse smoothly to element center, then click */
async function smoothClick(page: Page, locator: Locator, opts: { pause?: number } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element not visible for smoothClick');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
  await page.waitForTimeout(opts.pause ?? 100);
  await locator.click();
}

/** Move mouse smoothly to source, then drag to target */
async function smoothDrag(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error('Source not visible for smoothDrag');
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
    { steps: 15 },
  );
  await page.waitForTimeout(200);
  await source.dragTo(target);
}

test('record demo', async ({ electronApp, appPage, testRepo }) => {
  // Set window to a good demo size
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1200, 800);
    win.center();
  });
  await appPage.waitForTimeout(300);

  // Add test project
  await appPage.evaluate(async (repoPath) => {
    await window.api.addProject(repoPath);
    await (window as any).refreshProjects();
  }, testRepo.repoPath);
  await appPage.locator('.project-row').first().waitFor({ timeout: 15_000 });

  // --- Inject rrweb ---
  await appPage.evaluate(async () => {
    const res = await fetch('https://cdn.jsdelivr.net/npm/rrweb@2.0.0-alpha.20/dist/rrweb.umd.cjs');
    const code = await res.text();
    new Function(code).call(window);
  });

  // --- Start recording ---
  await appPage.evaluate(() => {
    (window as any).__rrwebEvents = [];
    (window as any).__rrwebStop = (window as any).rrweb.record({
      emit(event: any) { (window as any).__rrwebEvents.push(event); },
      recordCanvas: true,
      sampling: {
        canvas: 4,
        mousemove: 50,
        mouseInteraction: true,
      },
    });
  });
  await appPage.waitForTimeout(500); // let rrweb capture initial snapshot

  // ============================================
  // Scripted demo flow — edit below to customize
  // ============================================

  // Enter project mode
  await smoothClick(appPage, appPage.locator('.project-row').first());
  await appPage.locator('body.project-mode').waitFor({ timeout: 5_000 });
  await appPage.waitForTimeout(1500);

  // Kanban is visible by default — create tasks
  const input = appPage.locator('.kanban-add-input');
  await smoothClick(appPage, input);
  await appPage.waitForTimeout(300);

  await input.fill('Build authentication API');
  await input.press('Enter');
  await appPage.waitForTimeout(600);

  await input.fill('Design landing page');
  await input.press('Enter');
  await appPage.waitForTimeout(600);

  await input.fill('Set up CI pipeline');
  await input.press('Enter');
  await appPage.waitForTimeout(1000);

  // Drag first task to In Progress (creates worktree + terminal)
  const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
  const inProgressBody = appPage.locator('.kanban-column[data-status="in_progress"] .kanban-column-body');
  await smoothDrag(appPage, todoColumn.locator('.kanban-card').first(), inProgressBody);
  await appPage.waitForTimeout(2500); // wait for worktree creation

  // Hide kanban to show terminal
  await appPage.keyboard.press(`${modifier}+b`);
  await appPage.waitForTimeout(2500);

  // Show kanban again
  await appPage.keyboard.press(`${modifier}+b`);
  await appPage.waitForTimeout(1500);

  // Drag another task to In Progress
  await smoothDrag(appPage, todoColumn.locator('.kanban-card').first(), inProgressBody);
  await appPage.waitForTimeout(2000);

  // Final pause
  await appPage.waitForTimeout(1000);

  // ============================================
  // Stop recording and save
  // ============================================

  await appPage.evaluate(() => { (window as any).__rrwebStop?.(); });

  const events = await appPage.evaluate(() => (window as any).__rrwebEvents);

  const outPath = path.resolve(__dirname, '..', 'website', 'assets', 'recording.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(events));
  console.log(`\nWrote ${events.length} events to website/assets/recording.json`);
});
