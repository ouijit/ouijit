import { vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Sync paths.ts with the mocked Electron userData path
import { setUserDataPath } from '../../paths';

// Provide navigator for modules that reference it at import time (e.g. hotkeys.ts)
if (typeof globalThis.navigator === 'undefined') {
  (globalThis as any).navigator = { platform: 'MacIntel' };
}

// Each integration test run gets its own temp directory for Electron userData
// (taskMetadata stores JSON here). Tests manage their own git repos separately.
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-integration-'));

// `safeStorage` is the OS keychain, which no test has. The fake round-trips,
// which is the whole contract the credential store depends on.
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return testDataDir;
      return testDataDir;
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^encrypted:/, ''),
  },
}));

// Mock electron-log — stubs Electron-specific transports (file, IPC) but passes
// log calls through to console so test output remains visible for debugging.
function electronLogFactory() {
  const logger = Object.assign((...args: unknown[]) => console.log(...args), {
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
  });
  return { default: logger };
}
vi.mock('electron-log/main', electronLogFactory);
vi.mock('electron-log/renderer', electronLogFactory);
setUserDataPath(testDataDir);
