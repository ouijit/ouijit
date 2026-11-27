import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createConsoleLogger, setLogger, getLogger } from '../logger';

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
