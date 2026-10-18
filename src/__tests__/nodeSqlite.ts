import { vi } from 'vitest';
import * as fs from 'node:fs';
import { sqliteBindingPath } from '../../scripts/sqlite-bindings.mjs';

/**
 * better-sqlite3 pointed at the Node build, leaving the package's own
 * build/Release to Electron.
 */
export async function nodeSqliteFactory() {
  const nativeBinding = sqliteBindingPath('node');
  if (!fs.existsSync(nativeBinding)) {
    throw new Error('No better-sqlite3 build for this Node; run `node scripts/sqlite-bindings.mjs node`');
  }
  const { default: Database } = await vi.importActual<typeof import('better-sqlite3')>('better-sqlite3');
  return {
    default: new Proxy(Database, {
      construct: (target, [filename, options]) => new target(filename, { ...options, nativeBinding }),
    }),
  };
}
