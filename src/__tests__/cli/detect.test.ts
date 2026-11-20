import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { requireProject } from '../../cli/detect';

describe('requireProject outside an Ouijit terminal', () => {
  let tempDir: string;
  const home = process.cwd();

  beforeEach(() => {
    vi.stubEnv('OUIJIT_API_TOKEN', '');
    // Resolve symlinks (macOS /var → /private/var) so paths match git output
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-detect-')));
  });

  afterEach(() => {
    process.chdir(home);
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("takes the main repo of the shell's checkout, from a worktree too", async () => {
    const mainRepo = path.join(tempDir, 'main-repo');
    fs.mkdirSync(mainRepo);
    execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: mainRepo });
    const wtPath = path.join(tempDir, 'wt-1');
    execSync(`git worktree add -q -b test-branch "${wtPath}"`, { cwd: mainRepo });

    process.chdir(wtPath);
    expect(await requireProject()).toBe(mainRepo);
    process.chdir(mainRepo);
    expect(await requireProject()).toBe(mainRepo);
  });
});
