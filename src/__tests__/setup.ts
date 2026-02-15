import { vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Provide navigator for modules that reference it at import time (e.g. hotkeys.ts)
if (typeof globalThis.navigator === 'undefined') {
  (globalThis as any).navigator = { platform: 'MacIntel' };
}

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-test-'));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return testDataDir;
      return testDataDir;
    },
  },
}));
