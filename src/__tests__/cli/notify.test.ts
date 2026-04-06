import { describe, test, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getUserDataPath } from '../../paths';
import { notify } from '../../cli/notify';

describe('notify', () => {
  beforeEach(() => {
    const sentinelPath = path.join(getUserDataPath(), 'cli-notify.json');
    try {
      fs.unlinkSync(sentinelPath);
    } catch {
      // Doesn't exist yet
    }
  });

  test('writes sentinel file with correct payload', () => {
    const before = Date.now();
    notify('/test/project', 'task:create');
    const sentinelPath = path.join(getUserDataPath(), 'cli-notify.json');
    const content = JSON.parse(fs.readFileSync(sentinelPath, 'utf-8'));
    expect(content.project).toBe('/test/project');
    expect(content.action).toBe('task:create');
    expect(content.ts).toBeGreaterThanOrEqual(before);
    expect(content.ts).toBeLessThanOrEqual(Date.now());
  });
});
