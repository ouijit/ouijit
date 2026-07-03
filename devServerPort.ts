import { createHash } from 'node:crypto';

// Deterministic per-worktree renderer dev server port so parallel `npm start`
// runs don't collide, mirroring the repo-path hash that isolates dev userData
// in src/main.ts. Range 5174-6173: unprivileged, below the OS ephemeral
// range, and excludes Vite's default 5173.
export function deriveDevServerPort(repoPath: string): number {
  const hash = createHash('sha256').update(repoPath).digest('hex').slice(0, 8);
  return 5174 + (parseInt(hash, 16) % 1000);
}
