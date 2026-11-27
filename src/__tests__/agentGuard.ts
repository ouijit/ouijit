import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const AGENT_BINARIES = ['claude', 'codex', 'pi', 'opencode'];

export function realAgentMessage(binary: string): string {
  return `test reached the real ${binary} CLI; use a fake`;
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-test-home-'));
const binDir = path.join(home, '.agent-guard-bin');
fs.mkdirSync(binDir);
for (const binary of AGENT_BINARIES) {
  fs.writeFileSync(path.join(binDir, binary), `#!/bin/sh\necho '${realAgentMessage(binary)}' >&2\nexit 1\n`, {
    mode: 0o755,
  });
}

process.env.PATH = [binDir, process.env.PATH ?? ''].join(path.delimiter);

// os.homedir() reads HOME, so this also moves Ouijit's own ~/.config/Ouijit and
// ~/Ouijit/worktrees. The rest are the agents' own overrides, which win over HOME.
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, '.config');
process.env.XDG_DATA_HOME = path.join(home, '.local', 'share');
process.env.XDG_STATE_HOME = path.join(home, '.local', 'state');
process.env.XDG_CACHE_HOME = path.join(home, '.cache');
for (const override of [
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'PI_CODING_AGENT_DIR',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_DIR',
]) {
  delete process.env[override];
}

// A run inside an Ouijit terminal inherits that app's userData and API.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('OUIJIT_')) delete process.env[name];
}
