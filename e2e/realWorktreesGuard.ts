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

// The real app may be starting tasks while the suite runs, so only a worktree
// of a repo under the temp dir, where every test repo lives, counts as a leak.
function belongsToTestRepo(worktree: string): boolean {
  try {
    const gitdir = fs
      .readFileSync(path.join(worktree, '.git'), 'utf8')
      .replace(/^gitdir:\s*/, '')
      .trim();
    const tmp = fs.realpathSync(os.tmpdir());
    return gitdir.startsWith(tmp + path.sep) || gitdir.startsWith(os.tmpdir() + path.sep);
  } catch {
    return false;
  }
}

export default function globalSetup(): () => void {
  const before = worktreeDirs();
  return () => {
    const leaked = [...worktreeDirs()].filter((dir) => !before.has(dir) && belongsToTestRepo(dir));
    if (leaked.length > 0) {
      throw new Error(`The e2e run left worktrees in ${realRoot}:\n${leaked.join('\n')}`);
    }
  };
}
