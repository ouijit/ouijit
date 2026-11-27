import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const realRoot = path.join(os.homedir(), 'Ouijit', 'worktrees');

function worktreeDirs(): Set<string> {
  const dirs = new Set<string>();
  for (const project of fs.existsSync(realRoot) ? fs.readdirSync(realRoot) : []) {
    const projectDir = path.join(realRoot, project);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    for (const task of fs.readdirSync(projectDir)) dirs.add(path.join(projectDir, task));
  }
  return dirs;
}

function gitdirOf(worktree: string): string | null {
  try {
    return fs
      .readFileSync(path.join(worktree, '.git'), 'utf8')
      .replace(/^gitdir:\s*/, '')
      .trim();
  } catch {
    return null;
  }
}

// The real app, or another checkout's e2e run, may be starting tasks at the
// same time, so only a worktree of one of this run's repos counts as a leak.
// Workers inherit OUIJIT_E2E_RUN_DIR, and createTestRepo makes repos under it.
export default function globalSetup(): () => void {
  const runDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-e2e-run-')));
  process.env.OUIJIT_E2E_RUN_DIR = runDir;
  const before = worktreeDirs();
  return () => {
    const leaked = [...worktreeDirs()].filter(
      (dir) => !before.has(dir) && gitdirOf(dir)?.startsWith(runDir + path.sep),
    );
    fs.rmSync(runDir, { recursive: true, force: true });
    if (leaked.length > 0) {
      throw new Error(`The e2e run left worktrees in ${realRoot}:\n${leaked.join('\n')}`);
    }
  };
}
