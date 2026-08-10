import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Where the wrapper and helper scripts are installed.
 *
 * Its own module, small as it is, because two very different things need it:
 * `hookServer`, which writes the wrappers, and the health probe, which has to
 * know what to *ignore* on PATH — and a binary probe cannot import the hook
 * server without going round in a circle through the API router.
 */
export function getWrapperBinDir(): string {
  return path.join(os.homedir(), '.config', 'Ouijit', 'bin');
}
