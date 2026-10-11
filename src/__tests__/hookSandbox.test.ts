import { describe, test, expect, beforeEach } from 'vitest';
import { getHooks, saveHook, _resetCacheForTesting } from '../db';
import type { ScriptHook } from '../types';

describe('a hook keeps the sandbox it runs in', () => {
  beforeEach(() => {
    _resetCacheForTesting();
  });

  test('round-trips a backend, and reads as host once saved without one or with anything else', async () => {
    const project = '/test/hook-sandbox';
    const start: ScriptHook = { id: 'h', type: 'start', name: 'Agent', command: 'claude' };

    await saveHook(project, { ...start, sandbox: 'custom' });
    await saveHook(project, { ...start, id: 'd', type: 'done', command: 'git push' });
    let hooks = await getHooks(project);
    expect(hooks.start?.sandbox).toBe('custom');
    expect(hooks.done?.sandbox).toBeUndefined();

    await saveHook(project, start);
    expect((await getHooks(project)).start?.sandbox).toBeUndefined();

    await saveHook(project, { ...start, sandbox: 'vm' as ScriptHook['sandbox'] });
    hooks = await getHooks(project);
    expect(hooks.start).toBeDefined();
    expect(hooks.start?.sandbox).toBeUndefined();
  });
});
