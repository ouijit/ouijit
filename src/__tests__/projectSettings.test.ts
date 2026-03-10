import { describe, test, expect } from 'vitest';
import {
  getProjectSettings,
  getHooks,
  getHook,
  saveHook,
  deleteHook,
  getSandboxConfig,
  setSandboxConfig,
  setKillExistingOnRun,
  getProjectLayout,
  setProjectLayout,
  getProjectGridRatios,
  setProjectGridRatios,
  _resetCacheForTesting,
} from '../db';

describe('projectSettings', () => {

  test('full lifecycle: hooks, sandbox config, killExistingOnRun', async () => {
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

    // 8. Set sandbox config
    const sandboxResult = await setSandboxConfig(project, { memoryGiB: 8 });
    expect(sandboxResult.success).toBe(true);

    // 9. Get sandbox config — verify defaults merged with override
    const sandboxConfig = await getSandboxConfig(project);
    expect(sandboxConfig.memoryGiB).toBe(8);
    expect(sandboxConfig.diskGiB).toBe(10); // default

    // 10. Set killExistingOnRun
    const killResult = await setKillExistingOnRun(project, true);
    expect(killResult.success).toBe(true);

    // 11. Verify full settings
    const finalSettings = await getProjectSettings(project);
    expect(finalSettings.hooks?.run?.command).toBe('npm run lint');
    expect(finalSettings.sandbox?.memoryGiB).toBe(8);
    expect(finalSettings.killExistingOnRun).toBe(true);
  });

  test('cache reset provides isolation between tests', async () => {
    const project = '/test/settings-cache-isolation';

    // Save something
    await saveHook(project, {
      id: 'hook-x',
      type: 'cleanup' as const,
      name: 'Cleanup',
      command: 'rm -rf tmp',
    });

    // Verify it exists before reset
    const hookBefore = await getHook(project, 'cleanup');
    expect(hookBefore).toBeDefined();
    expect(hookBefore!.command).toBe('rm -rf tmp');

    // Reset creates a fresh in-memory DB — data from prior state is gone
    _resetCacheForTesting();

    // Should NOT find the hook (fresh database)
    const hookAfter = await getHook(project, 'cleanup');
    expect(hookAfter).toBeUndefined();
  });

  test('getSandboxConfig returns defaults for new project', async () => {
    const config = await getSandboxConfig('/test/settings-new-project');
    expect(config).toEqual({ memoryGiB: 4, diskGiB: 10 });
  });

  test('deleteHook succeeds even when no hooks exist', async () => {
    const result = await deleteHook('/test/settings-no-hooks', 'start');
    expect(result.success).toBe(true);
  });

  test('per-project layout: get returns null for new project', async () => {
    const layout = await getProjectLayout('/test/layout-new');
    expect(layout).toBeNull();
  });

  test('per-project layout: set and get round-trip', async () => {
    const project = '/test/layout-roundtrip';

    const setResult = await setProjectLayout(project, 'grid');
    expect(setResult.success).toBe(true);

    const layout = await getProjectLayout(project);
    expect(layout).toBe('grid');
  });

  test('per-project layout: overwrite existing value', async () => {
    const project = '/test/layout-overwrite';

    await setProjectLayout(project, 'grid');
    await setProjectLayout(project, 'focus');

    const layout = await getProjectLayout(project);
    expect(layout).toBe('focus');
  });

  test('per-project layout: different projects are independent', async () => {
    await setProjectLayout('/test/layout-a', 'grid');
    await setProjectLayout('/test/layout-b', 'focus');

    expect(await getProjectLayout('/test/layout-a')).toBe('grid');
    expect(await getProjectLayout('/test/layout-b')).toBe('focus');
  });

  test('per-project grid ratios: get returns null for new project', async () => {
    const ratios = await getProjectGridRatios('/test/ratios-new');
    expect(ratios).toBeNull();
  });

  test('per-project grid ratios: set and get round-trip', async () => {
    const project = '/test/ratios-roundtrip';
    const json = JSON.stringify({ cols: [1, 2, 1], rows: [1, 1] });

    const setResult = await setProjectGridRatios(project, json);
    expect(setResult.success).toBe(true);

    const ratios = await getProjectGridRatios(project);
    expect(ratios).toBe(json);

    // Verify JSON parses back correctly
    const parsed = JSON.parse(ratios!);
    expect(parsed.cols).toEqual([1, 2, 1]);
    expect(parsed.rows).toEqual([1, 1]);
  });

  test('layout and grid ratios coexist on same project', async () => {
    const project = '/test/layout-and-ratios';
    const json = JSON.stringify({ cols: [1, 1], rows: [1] });

    await setProjectLayout(project, 'grid');
    await setProjectGridRatios(project, json);

    expect(await getProjectLayout(project)).toBe('grid');
    expect(await getProjectGridRatios(project)).toBe(json);
  });
});
