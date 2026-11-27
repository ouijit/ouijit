import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';

import { AGENT_BINARIES, realAgentMessage } from './agentGuard';

describe('tests are kept away from real agents', () => {
  test('every agent on PATH is a fake that fails loudly, and home is not the real one', () => {
    for (const binary of AGENT_BINARIES) {
      const result = spawnSync(binary, ['--version'], { encoding: 'utf8' });
      expect(result.status, binary).not.toBe(0);
      expect(result.stderr, binary).toContain(realAgentMessage(binary));
    }

    expect(os.homedir()).not.toBe(os.userInfo().homedir);
    expect(os.homedir()).toContain(os.tmpdir());
  });
});
