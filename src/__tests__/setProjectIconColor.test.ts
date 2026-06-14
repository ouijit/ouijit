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

  test('a freshly added project has no custom color', async () => {
    await addProject('/projects/app');
    expect(iconColorOf('/projects/app')).toBeNull();
  });

  test('persists a custom color and reads it back', async () => {
    await addProject('/projects/app');

    const result = await setProjectIconColor('/projects/app', '#FF6B6B');

    expect(result.success).toBe(true);
    expect(iconColorOf('/projects/app')).toBe('#FF6B6B');
  });

  test('passing null reverts to the generated color', async () => {
    await addProject('/projects/app');
    await setProjectIconColor('/projects/app', '#FF6B6B');

    await setProjectIconColor('/projects/app', null);

    expect(iconColorOf('/projects/app')).toBeNull();
  });

  test('only affects the targeted project', async () => {
    await addProject('/projects/a');
    await addProject('/projects/b');

    await setProjectIconColor('/projects/a', '#00CED1');

    expect(iconColorOf('/projects/a')).toBe('#00CED1');
    expect(iconColorOf('/projects/b')).toBeNull();
  });
});
