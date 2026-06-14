import { describe, test, expect, beforeEach } from 'vitest';
import { addProject, setProjectIconColor, _resetCacheForTesting } from '../db';
import { getDatabase } from '../db/database';
import { ProjectRepo } from '../db/repos/projectRepo';

function iconColorOf(path: string): string | null {
  return new ProjectRepo(getDatabase()).getByPath(path)?.icon_color ?? null;
}

describe('setProjectIconColor', () => {
  beforeEach(() => {
    _resetCacheForTesting();
  });

  test('persists a custom color and null reverts to the generated one', async () => {
    await addProject('/projects/app');
    expect(iconColorOf('/projects/app')).toBeNull();

    await setProjectIconColor('/projects/app', '#FF6B6B');
    expect(iconColorOf('/projects/app')).toBe('#FF6B6B');

    await setProjectIconColor('/projects/app', null);
    expect(iconColorOf('/projects/app')).toBeNull();
  });
});
