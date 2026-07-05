import { describe, test, expect, beforeEach } from 'vitest';
import { getScripts, saveScript, getProjectSettings, saveHook, _resetCacheForTesting } from '../db';

// The per-runnable "restart if already running" flag replaced the old
// project-global kill_existing_on_run setting. Pin its persistence for both
// carriers: ad-hoc scripts and the run hook.
describe('restartIfRunning persistence', () => {
  beforeEach(() => {
    _resetCacheForTesting();
  });

  test('a script round-trips its restartIfRunning flag (default off)', async () => {
    const project = '/test/restart-scripts';

    const off = await saveScript(project, {
      id: 'script-off',
      name: 'Test',
      command: 'npm test',
      sortOrder: 0,
      restartIfRunning: false,
    });
    expect(off.success).toBe(true);
    expect(off.script?.restartIfRunning).toBe(false);

    const on = await saveScript(project, {
      id: 'script-on',
      name: 'Dev',
      command: 'npm run dev',
      sortOrder: 1,
      restartIfRunning: true,
    });
    expect(on.script?.restartIfRunning).toBe(true);

    const scripts = await getScripts(project);
    expect(scripts.find((s) => s.id === 'script-off')?.restartIfRunning).toBe(false);
    expect(scripts.find((s) => s.id === 'script-on')?.restartIfRunning).toBe(true);
  });

  test('the run hook round-trips its restartIfRunning flag', async () => {
    const project = '/test/restart-hook';

    await saveHook(project, {
      id: 'hook-run',
      type: 'run',
      name: 'Dev',
      command: 'npm run dev',
      restartIfRunning: true,
    });

    const settings = await getProjectSettings(project);
    expect(settings.hooks?.run?.restartIfRunning).toBe(true);
  });

  test('a hook saved without the flag defaults to off', async () => {
    const project = '/test/restart-hook-default';

    await saveHook(project, { id: 'hook-run', type: 'run', name: 'Dev', command: 'npm run dev' });

    const settings = await getProjectSettings(project);
    expect(settings.hooks?.run?.restartIfRunning).toBe(false);
  });
});
