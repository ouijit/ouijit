import { describe, test, expect, vi } from 'vitest';
import { printJson } from '../../cli/output';

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
