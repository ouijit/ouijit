import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as pty from 'node-pty';
import { installShellIntegration, resolveShellIntegration } from '../../shellIntegration';

function findOnPath(name: string): string | null {
  try {
    return execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

const fish = findOnPath('fish');
const SHELLS = [
  { shell: '/bin/zsh', installed: fs.existsSync('/bin/zsh') },
  { shell: '/bin/bash', installed: fs.existsSync('/bin/bash') },
  { shell: fish ?? 'fish', installed: fish != null },
];

let root: string;
let integrationDir: string;
let wrapperDir: string;
let home: string;
let probe: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-shell-startup-')));
  integrationDir = path.join(root, 'integration');
  installShellIntegration(integrationDir);

  wrapperDir = path.join(root, 'wrappers');
  fs.mkdirSync(wrapperDir);
  fs.writeFileSync(path.join(wrapperDir, 'ls'), '#!/bin/sh\necho WRAPPED\n', { mode: 0o755 });

  // Each rc pushes the system dirs ahead of the wrapper dir, as a user's own
  // PATH edits would, and replaces the prompt hooks it was handed.
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.config', 'fish'), { recursive: true });
  fs.writeFileSync(path.join(home, '.zshrc'), 'export PATH="/usr/bin:/bin:$PATH"\nprecmd_functions=()\n');
  fs.writeFileSync(
    path.join(home, '.bashrc'),
    'export PATH="/usr/bin:/bin:$PATH"\nPROMPT_COMMAND="history -a; $PROMPT_COMMAND"\n',
  );
  fs.writeFileSync(path.join(home, '.config', 'fish', 'config.fish'), 'set -gx PATH /usr/bin /bin $PATH\n');

  probe = path.join(root, 'probe.js');
  fs.writeFileSync(
    probe,
    [
      'console.log("started");',
      'require("readline").createInterface({ input: process.stdin }).on("line", (l) => console.log("got " + l));',
    ].join('\n'),
  );
});

function spawnShell(shell: string, command: string) {
  const launch = resolveShellIntegration(shell).launch({ shell, integrationDir, command });
  const term = pty.spawn(launch.file, launch.args, {
    cols: 120,
    rows: 30,
    cwd: root,
    env: {
      HOME: home,
      PATH: `${wrapperDir}:/usr/bin:/bin`,
      TERM: 'xterm-256color',
      OUIJIT_WRAPPER_DIR: wrapperDir,
      OUIJIT_SHELL_INTEGRATION_DIR: integrationDir,
      ...launch.env,
    },
  });

  let output = '';
  term.onData((data) => {
    output += data;
    // fish 4 waits on its terminal queries before reading input.
    if (data.includes('\x1b]11;?')) term.write('\x1b]11;rgb:0000/0000/0000\x1b\\');
    if (data.includes('\x1b[6n')) term.write('\x1b[1;1R');
    if (data.includes('\x1b[c') || data.includes('\x1b[0c')) term.write('\x1b[?62;22c');
  });

  let mark = 0;
  const waitFor = async (pattern: RegExp, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = pattern.exec(output.slice(mark));
      if (match) {
        mark += match.index + match[0].length;
        return match;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for ${pattern} in:\n${JSON.stringify(output.slice(mark))}`);
  };

  return { term, waitFor };
}

const exitCode = /\x1b\]133;D;(\d+)\x07/;

describe('startup command', () => {
  for (const { shell, installed } of SHELLS) {
    it.skipIf(!installed)(
      `runs as a job of the interactive ${path.basename(shell)}, so fg resumes it after Ctrl-Z`,
      async () => {
        const exiting = spawnShell(shell, 'ls; exit 3');
        try {
          await exiting.waitFor(/WRAPPED/);
          expect((await exiting.waitFor(exitCode))[1]).toBe('3');
          exiting.term.write('echo still-open\r');
          await exiting.waitFor(/[\r\n]still-open/);
        } finally {
          exiting.term.kill();
        }

        const interrupted = spawnShell(shell, `${process.execPath} ${probe}`);
        try {
          await interrupted.waitFor(/started/);
          interrupted.term.write('\x03');
          expect((await interrupted.waitFor(exitCode))[1]).toBe('130');
        } finally {
          interrupted.term.kill();
        }

        const { term, waitFor } = spawnShell(shell, `${process.execPath} ${probe}`);
        try {
          await waitFor(/started/);
          term.write('\x1a');
          await waitFor(exitCode);

          term.write('fg\r');
          await new Promise((resolve) => setTimeout(resolve, 500));
          term.write('resumed\r');
          await waitFor(/got resumed/);
          term.write('\x04');
          await waitFor(exitCode);

          term.write('printenv OUIJIT_STARTUP_COMMAND || echo cleared\r');
          await waitFor(/[\r\n]cleared/);
          await waitFor(exitCode);

          term.write('false\r');
          expect((await waitFor(exitCode))[1]).toBe('1');
        } finally {
          term.kill();
        }
      },
      30_000,
    );
  }
});
