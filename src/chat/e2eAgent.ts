import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { chatHost } from './host';
import { getDriver } from './drivers';
import { loadCassettes, recordingSpawn, replayingSpawn } from './cassette';

/**
 * For e2e runs: every agent a chat starts replays the recording at `spec` (a
 * folder and a name), at the pace it was recorded; or, with `record`, runs the
 * real Claude Code and writes that recording. Never set outside e2e.
 */
export async function useRecordedAgents(spec: string, record: boolean): Promise<void> {
  const dir = path.dirname(spec);
  const name = path.basename(spec);
  if (record) {
    const probe = await getDriver('claude').probe();
    chatHost._setOptionsForTesting({ spawnProcess: recordingSpawn(dir, name, 'claude', probe.version) });
    return;
  }
  const cassettes = loadCassettes(dir, name);
  if (cassettes.length === 0) throw new Error(`No recording at ${spec}; record it with RECORD_E2E_CHAT=1`);
  // The driver looks for its binary on PATH and checks its version even though
  // the process is replaced; this stands in for it, reporting the recorded one.
  // PATH is set here rather than by the test because startup rebuilds it from
  // the login shell.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-e2e-agent-'));
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "${cassettes[0].version ?? '99.0.0'}"\n`, {
    mode: 0o755,
  });
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-e2e-claude-'));
  chatHost._setOptionsForTesting({ spawnProcess: replayingSpawn(cassettes, { paced: true }) });
}
