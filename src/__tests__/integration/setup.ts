import { vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Provide navigator for modules that reference it at import time (e.g. hotkeys.ts)
if (typeof globalThis.navigator === 'undefined') {
  (globalThis as any).navigator = { platform: 'MacIntel' };
}

// Each integration test run gets its own temp directory for Electron userData
// (taskMetadata stores JSON here). Tests manage their own git repos separately.
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-integration-'));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return testDataDir;
      return testDataDir;
    },
  },
}));

// Mock electron-log — stubs Electron-specific transports (file, IPC) but passes
// log calls through to console so test output remains visible for debugging.
function electronLogFactory() {
  const logger = Object.assign(
    (...args: unknown[]) => console.log(...args),
    {
      error: (...args: unknown[]) => console.error(...args),
      warn: (...args: unknown[]) => console.warn(...args),
      info: (...args: unknown[]) => console.info(...args),
      verbose: (...args: unknown[]) => console.debug(...args),
      debug: (...args: unknown[]) => console.debug(...args),
      silly: (...args: unknown[]) => console.debug(...args),
      log: (...args: unknown[]) => console.log(...args),
      scope: () => logger,
      transports: { file: { format: null, maxSize: 0, fileName: '' }, console: {} },
      errorHandler: { startCatching: () => {} },
      initialize: () => {},
    },
  );
  return { default: logger };
}
vi.mock('electron-log/main', electronLogFactory);
vi.mock('electron-log/renderer', electronLogFactory);
