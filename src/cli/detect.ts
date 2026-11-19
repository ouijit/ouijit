import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { get } from './api';
import { printError } from './output';

/**
 * Resolve the main git repo root from a path.
 * If inside a worktree, follows .git file to find the main repo.
 */
function resolveGitRoot(cwd: string): string | null {
  try {
    const toplevel = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    // Check if .git is a file (worktree) rather than a directory
    const gitPath = path.join(toplevel, '.git');
    try {
      const stat = fs.statSync(gitPath);
      if (stat.isFile()) {
        // .git file contains: gitdir: /path/to/main/.git/worktrees/T-N
        const content = fs.readFileSync(gitPath, 'utf-8').trim();
        const match = content.match(/^gitdir:\s*(.+)$/);
        if (match) {
          // Resolve: /path/to/main/.git/worktrees/T-N → /path/to/main
          const gitdir = path.resolve(toplevel, match[1]);
          // Walk up from .git/worktrees/T-N to .git, then to the repo root
          const mainGitDir = path.resolve(gitdir, '..', '..');
          const mainRoot = path.dirname(mainGitDir);
          // Verify it's actually a git repo root
          if (fs.existsSync(path.join(mainRoot, '.git'))) {
            return mainRoot;
          }
        }
      }
    } catch {
      // .git is a directory (normal repo), use toplevel as-is
    }

    return toplevel;
  } catch {
    return null;
  }
}

export async function requireProject(explicitPath?: string): Promise<string> {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) return printError(`No project at ${resolved}`);
    return resolved;
  }
  if (process.env['OUIJIT_PTY_ID']) return (await get<{ projectPath: string }>('/api/projects/current')).projectPath;
  return (
    resolveGitRoot(process.cwd()) ??
    printError('Could not detect project. Use --project <path> or run from within a git repo.')
  );
}
