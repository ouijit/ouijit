import { describe, test, expect } from 'vitest';
import { getProjectSettings, getHooks, getHook, saveHook, deleteHook, _resetCacheForTesting } from '../db';

describe('projectSettings', () => {
  test('full lifecycle: hooks, restartIfRunning', async () => {
    const project = '/test/settings-lifecycle';

    // 1. New project returns defaults
    const defaults = await getProjectSettings(project);
    expect(defaults.hooks).toEqual({});
    expect(defaults.customCommands).toEqual([]);

    // 2. Save a start hook
    const startHook = {
      id: 'hook-1',
      type: 'start' as const,
      name: 'Setup',
      command: 'npm install',
    };
    const result1 = await saveHook(project, startHook);
    expect(result1.success).toBe(true);

    // 3. Save a run hook
    const runHook = {
      id: 'hook-2',
      type: 'run' as const,
      name: 'Lint',
      command: 'npm run lint',
    };
    const result2 = await saveHook(project, runHook);
    expect(result2.success).toBe(true);

    // 4. Verify both hooks present
    const hooks = await getHooks(project);
    expect(hooks.start).toBeDefined();
    expect(hooks.start!.command).toBe('npm install');
    expect(hooks.run).toBeDefined();
    expect(hooks.run!.command).toBe('npm run lint');

    // 5. Get specific hook
    const startResult = await getHook(project, 'start');
    expect(startResult).toBeDefined();
    expect(startResult!.name).toBe('Setup');

    // 6. Delete the start hook
    const deleteResult = await deleteHook(project, 'start');
    expect(deleteResult.success).toBe(true);

    // 7. Verify only run hook remains
    const hooksAfterDelete = await getHooks(project);
    expect(hooksAfterDelete.start).toBeUndefined();
    expect(hooksAfterDelete.run).toBeDefined();

    // 8. Update the run hook to opt into restart-if-running (per-runnable flag)
    const restartResult = await saveHook(project, { ...runHook, restartIfRunning: true });
    expect(restartResult.success).toBe(true);

    // 9. Verify full settings — the flag round-trips on the run hook
    const finalSettings = await getProjectSettings(project);
    expect(finalSettings.hooks?.run?.command).toBe('npm run lint');
    expect(finalSettings.hooks?.run?.restartIfRunning).toBe(true);
  });

  test('cache reset provides isolation between tests', async () => {
    const project = '/test/settings-cache-isolation';

    // Save something
    await saveHook(project, {
      id: 'hook-x',
      type: 'done' as const,
      name: 'Done',
      command: 'rm -rf tmp',
    });

    const hookBefore = await getHook(project, 'done');
    expect(hookBefore).toBeDefined();
    expect(hookBefore!.command).toBe('rm -rf tmp');

    // Reset creates a fresh in-memory DB — data from prior state is gone
    _resetCacheForTesting();

    const hookAfter = await getHook(project, 'done');
    expect(hookAfter).toBeUndefined();
  });

  test('deleteHook succeeds even when no hooks exist', async () => {
    const result = await deleteHook('/test/settings-no-hooks', 'start');
    expect(result.success).toBe(true);
  });
});
