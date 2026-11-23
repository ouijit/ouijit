import { promisify } from 'node:util';
import { vi } from 'vitest';

type Callback = (err: Error | null, stdout: string, stderr: string) => void;

/** git's argv as its caller wrote it, without the `-c` settings every host git call carries. */
export function gitArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c') i++;
    else out.push(args[i]);
  }
  return out;
}

/**
 * A stand-in for `child_process.execFile` that answers from `reply`, given
 * git's argv. Promisified the way the real one is, to `{ stdout, stderr }`, and
 * through the mock itself, so a test's `mockImplementation` still decides.
 */
export function fakeExecFile(reply: (args: string[]) => string | Error) {
  const fn = vi.fn((_file: string, args: readonly string[], _opts: unknown, cb: Callback) => {
    const out = reply(gitArgs(args ?? []));
    if (out instanceof Error) cb(out, '', '');
    else cb(null, out, '');
  });
  return Object.assign(fn, {
    [promisify.custom]: (file: string, args: readonly string[], opts: unknown) =>
      new Promise((resolve, reject) =>
        fn(file, args, opts, (err, stdout, stderr) =>
          err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr }),
        ),
      ),
  });
}
