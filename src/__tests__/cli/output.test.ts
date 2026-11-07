import { describe, test, expect, vi } from 'vitest';
import { forbiddenMessage, printJson } from '../../cli/output';

describe('printJson', () => {
  test('writes pretty JSON to stdout', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    printJson({ hello: 'world', num: 42 });
    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify({ hello: 'world', num: 42 }, null, 2) + '\n');
    writeSpy.mockRestore();
  });

  test('handles arrays', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    printJson([1, 2, 3]);
    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify([1, 2, 3], null, 2) + '\n');
    writeSpy.mockRestore();
  });
});

describe('forbiddenMessage', () => {
  test('gives the reason and the exact ask that would run the same command, except where an ask cannot', () => {
    expect(forbiddenMessage('Forbidden', ['task', 'set-description', '2', "it's the refresh"])).toBe(
      "Forbidden: this terminal's sandbox does not allow it at the project's Ouijit CLI access. " +
        `To ask the user to run it outside the sandbox: ouijit ask run -m "<why>" -- ouijit task set-description 2 'it'\\''s the refresh'`,
    );
    expect(
      forbiddenMessage('A sandboxed terminal runs the hook as configured, or none', ['task', 'start', '5']),
    ).toMatch(/^Forbidden: A sandboxed terminal runs the hook as configured, or none\. .* -- ouijit task start 5$/);
    expect(forbiddenMessage('Forbidden', ['ask', 'run', '--', 'make'])).not.toContain('ouijit ask run');
    expect(forbiddenMessage('Forbidden', ['pr', 'draft', 'add', '3', '--body', '-'])).not.toContain('ouijit ask run');
  });
});
