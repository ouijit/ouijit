import { describe, test, expect, vi, beforeEach } from 'vitest';
import { formatLogEntry, createConsoleLogger, setLogger, getLogger } from '../logger';

describe('formatLogEntry', () => {
  test('produces valid JSON with ts, level, and msg fields', () => {
    const result = formatLogEntry(['hello world'], 'info');
    const parsed = JSON.parse(result);
    expect(parsed.ts).toBeDefined();
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello world');
    expect(parsed.mod).toBeUndefined();
  });

  test('includes mod field when scope is provided', () => {
    const result = formatLogEntry(['test message'], 'warn', 'worktree');
    const parsed = JSON.parse(result);
    expect(parsed.mod).toBe('worktree');
    expect(parsed.level).toBe('warn');
    expect(parsed.msg).toBe('test message');
  });

  test('spreads metadata from last plain object argument', () => {
    const result = formatLogEntry(['starting task', { taskNumber: 5, branch: 'feature-5' }], 'info', 'worktree');
    const parsed = JSON.parse(result);
    expect(parsed.msg).toBe('starting task');
    expect(parsed.taskNumber).toBe(5);
    expect(parsed.branch).toBe('feature-5');
    expect(parsed.mod).toBe('worktree');
  });

  test('does not spread arrays as metadata', () => {
    const result = formatLogEntry(['items', [1, 2, 3]], 'info');
    const parsed = JSON.parse(result);
    expect(parsed.msg).toBe('items [1,2,3]');
    expect(parsed[0]).toBeUndefined();
  });

  test('does not spread Error instances as metadata', () => {
    const err = new Error('boom');
    const result = formatLogEntry(['failed', err], 'error');
    const parsed = JSON.parse(result);
    expect(parsed.msg).toContain('failed');
    expect(parsed.msg).toContain('boom');
    expect(parsed.message).toBeUndefined();
  });

  test('concatenates multiple string arguments', () => {
    const result = formatLogEntry(['part1', 'part2', 'part3'], 'debug');
    const parsed = JSON.parse(result);
    expect(parsed.msg).toBe('part1 part2 part3');
  });

  test('handles empty data array', () => {
    const result = formatLogEntry([], 'info');
    const parsed = JSON.parse(result);
    expect(parsed.msg).toBe('');
  });
});

describe('createConsoleLogger', () => {
  test('logs to console with correct methods', () => {
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = createConsoleLogger();
    logger.info('hello');
    logger.warn('caution');
    logger.error('bad');

    expect(infoSpy).toHaveBeenCalledWith('hello');
    expect(warnSpy).toHaveBeenCalledWith('caution');
    expect(errorSpy).toHaveBeenCalledWith('bad');

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('scope prefixes messages', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createConsoleLogger();
    const scoped = logger.scope('worktree');
    scoped.info('started');
    expect(spy).toHaveBeenCalledWith('[worktree] started');
    spy.mockRestore();
  });

  test('scope chains produce nested prefixes', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createConsoleLogger();
    const nested = logger.scope('db').scope('query');
    nested.info('executed');
    expect(spy).toHaveBeenCalledWith('[db:query] executed');
    spy.mockRestore();
  });

  test('metadata is appended as JSON', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createConsoleLogger();
    logger.info('task created', { taskNumber: 1 });
    expect(spy).toHaveBeenCalledWith('task created {"taskNumber":1}');
    spy.mockRestore();
  });
});

describe('setLogger / getLogger', () => {
  beforeEach(() => {
    // Reset to default
    setLogger(createConsoleLogger());
  });

  test('setLogger overrides the global logger', () => {
    const calls: string[] = [];
    const custom: ReturnType<typeof createConsoleLogger> = {
      info: (msg) => calls.push(`info:${msg}`),
      warn: (msg) => calls.push(`warn:${msg}`),
      error: (msg) => calls.push(`error:${msg}`),
      scope: () => custom,
    };
    setLogger(custom);
    getLogger().info('test');
    expect(calls).toEqual(['info:test']);
  });
});
