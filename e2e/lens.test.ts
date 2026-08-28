import { test, expect, createTestRepo, enterProject } from './fixtures';
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { worktreeSubjectKey } from '../src/lens/subjectKeys';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * A lens in a real window. The renderer tests run under jsdom, which has no
 * layout engine, so the picker in the ledge and a chaptered rail beside a
 * chaptered document are unverified there. Writing a lens needs an agent, which
 * e2e cannot spawn, so the grouping is seeded into the running app's database.
 */

async function seedLens(
  userDataDir: string,
  row: { projectPath: string; subjectKey: string; lensId: string; lensName: string; groups: string },
): Promise<void> {
  // Straight into the database the running app reads, which is in WAL and takes
  // a second writer for one short insert. Through `node:sqlite` rather than the
  // app's own better-sqlite3, which is built for Electron's ABI and will not
  // load in this process.
  const db = new DatabaseSync(path.join(userDataDir, 'ouijit.db'));
  db.prepare(
    `INSERT INTO diff_lenses (project_path, subject_key, pin, groups, lens_id, lens_name, created_at)
     VALUES (?, ?, 'seeded', ?, ?, ?, datetime('now'))
     ON CONFLICT(project_path, subject_key) DO UPDATE SET
       pin = excluded.pin, groups = excluded.groups, lens_id = excluded.lens_id, lens_name = excluded.lens_name`,
  ).run(row.projectPath, row.subjectKey, row.groups, row.lensId, row.lensName);
  db.close();
}

/** Into the project, then into a terminal, which is where the diff panel lives. */
async function enterProjectTerminal(appPage: Page, repoPath: string): Promise<void> {
  await enterProject(appPage, repoPath);
  await appPage.keyboard.press(`${modifier}+t`);
  await expect(appPage.locator('.kanban-board')).toHaveCount(0, { timeout: 5_000 });
}

test('the diff panel reads a change through a lens', async ({ appPage, userDataDir }) => {
  test.slow();
  const repo = createTestRepo('lens-project');
  try {
    // Two files, so a lens has something to split and something to leave out.
    fs.writeFileSync(path.join(repo.repoPath, 'README.md'), '# Test Project\n\nnow with more words\n');
    fs.writeFileSync(path.join(repo.repoPath, 'store.ts'), 'export const rows = [];\n');

    await enterProjectTerminal(appPage, repo.repoPath);
    await appPage.keyboard.press(`${modifier}+i`);
    await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 10_000 });

    const lens = await appPage.evaluate(
      (rp: string) => window.api.lens.save(rp, { name: 'By layer', instruction: 'data model first' }),
      repo.repoPath,
    );
    const base = await appPage.evaluate(
      (rp: string) => window.api.getGitFileStatus(rp).then((status) => status?.base ?? ''),
      repo.repoPath,
    );
    expect(base).not.toBe('');

    await seedLens(userDataDir, {
      projectPath: repo.repoPath,
      subjectKey: worktreeSubjectKey(repo.repoPath, base),
      lensId: lens.id,
      lensName: lens.name,
      groups: JSON.stringify({
        groups: [
          { title: 'Where it is stored', summary: 'The table and the rows in it', slices: [{ path: 'store.ts' }] },
        ],
      }),
    });

    const diff = appPage.getByLabel('Diff');
    await expect(diff).toBeVisible({ timeout: 20_000 });
    await diff.click();

    // The rail and the document both chapter, and agree on the part's name.
    await expect(appPage.getByText('Where it is stored')).toHaveCount(2, { timeout: 15_000 });
    // README.md was claimed by no part and is still in the diff.
    await expect(appPage.getByText('Not in this lens').first()).toBeVisible();
    expect(await appPage.getByText('The table and the rows in it').count()).toBeGreaterThan(0);

    // The picker sits in the ledge above the file list.
    const picker = appPage.getByTitle(/Reading this change through “By layer”/);
    await expect(picker).toBeVisible();
    await picker.click();
    const row = appPage.getByRole('menuitem', { name: /^By layer/ });
    // Seeded against a pin nothing matches, which is what a lens written before
    // the last save looks like: still drawn, and offering to be written again.
    await expect(row).toContainText('1 part · out of date');
    // What asking for another would send, before anyone asks for one.
    expect(await row.getAttribute('title')).toMatch(/~\d+k? tk$/);
  } finally {
    repo.cleanup();
  }
});
