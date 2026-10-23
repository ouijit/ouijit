import { describe, test, expect, beforeEach } from 'vitest';
import { getHooks, saveHook, _resetCacheForTesting } from '../db';
import { hookSandbox } from '../services/hookRun';
import type { ScriptHook } from '../types';

describe('where a hook runs', () => {
  beforeEach(() => {
    _resetCacheForTesting();
  });

  test('a hook keeps a place it was given, Host included, and follows the project default without one', async () => {
    const project = '/test/hook-sandbox';
    const start: ScriptHook = { id: 'h', type: 'start', name: 'Agent', command: 'claude' };

    await saveHook(project, { ...start, sandbox: 'custom' });
    await saveHook(project, { ...start, id: 'd', type: 'done', command: 'git push', sandbox: 'none' });
    await saveHook(project, { ...start, id: 'r', type: 'review', command: 'claude -p review' });
    let hooks = await getHooks(project);
    expect(hookSandbox(undefined, hooks.start, 'nono')).toBe('custom');
    expect(hookSandbox(undefined, hooks.done, 'nono')).toBe('none');
    expect(hookSandbox(undefined, hooks.review, 'nono')).toBe('nono');
    expect(hookSandbox('none', hooks.start, 'nono')).toBe('none');

    await saveHook(project, { ...start, sandbox: 'vm' as ScriptHook['sandbox'] });
    hooks = await getHooks(project);
    expect(hooks.start).toBeDefined();
    expect(hookSandbox(undefined, hooks.start, 'nono')).toBe('nono');
  });
});
