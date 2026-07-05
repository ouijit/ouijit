import { describe, it, expect } from 'vitest';
import { deriveDevServerPort } from '../../devServerPort';

describe('deriveDevServerPort', () => {
  it('is deterministic for the same repo path', () => {
    const path = '/Users/dev/Ouijit/worktrees/ouijit/T-479';
    expect(deriveDevServerPort(path)).toBe(deriveDevServerPort(path));
  });

  it('generally yields distinct ports for distinct worktrees', () => {
    const ports = new Set(
      Array.from({ length: 20 }, (_, i) => deriveDevServerPort(`/Users/dev/Ouijit/worktrees/ouijit/T-${i}`)),
    );
    // 20 draws from 1000 slots: collisions are possible but near-total
    // uniqueness is expected; guards against a degenerate hash mapping.
    expect(ports.size).toBeGreaterThan(15);
  });

  it('always maps into the 5174-6173 range', () => {
    for (let i = 0; i < 200; i++) {
      const port = deriveDevServerPort(`/some/repo/path-${i}`);
      expect(port).toBeGreaterThanOrEqual(5174);
      expect(port).toBeLessThanOrEqual(6173);
    }
  });
});
