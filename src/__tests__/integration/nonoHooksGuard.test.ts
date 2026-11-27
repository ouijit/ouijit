import { test, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildNonoLaunch } from '../../sandbox/nono/argv';
import { ensureHooksGuardProfile } from '../../sandbox/nono/profile';

const NONO = path.resolve(__dirname, '../../../resources/bin/nono');

test.skipIf(process.platform !== 'darwin' || !fs.existsSync(NONO))(
  "a sandboxed terminal in a project's own checkout can't plant a git hook, and still adds, commits and branches",
  async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-hooks-guard-')));
    const repo = path.join(root, 'project');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const config = path.join(root, 'config');
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = config;
    let guard: string;
    try {
      guard = await ensureHooksGuardProfile(repo);
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }

    const script = [
      'echo "exit 1" > .git/hooks/pre-commit && echo planted',
      'echo change > file.txt',
      'git add file.txt',
      'git -c user.name=t -c user.email=t@t commit -q -m change && echo committed',
      'git branch side && echo branched',
    ].join('; ');
    const gitDir = path.join(repo, '.git');
    const launch = buildNonoLaunch(
      NONO,
      { file: '/bin/sh', args: ['-c', script], env: {} },
      {
        worktreePath: repo,
        git: { gitDir, writableDirs: [path.join(gitDir, 'objects')], writableFiles: [] },
        apiPort: 1,
        wrapperDir: root,
        profile: 'default',
        extends: [guard],
      },
    );
    // nono refuses to start with its state (~/.nono, $XDG_STATE_HOME/nono) inside a folder it
    // grants, and its macOS system group reads all of /private, where every temp dir is.
    const cache = path.resolve(__dirname, '../../../node_modules/.cache');
    fs.mkdirSync(cache, { recursive: true });
    const home = fs.mkdtempSync(path.join(cache, 'ouijit-nono-home-'));
    const run = spawnSync(launch.file, launch.args, {
      cwd: repo,
      encoding: 'utf8',
      // nono's default profile doesn't grant the user's git config, which git would otherwise refuse to start without.
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: config,
        XDG_STATE_HOME: path.join(home, '.local', 'state'),
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
    fs.rmSync(home, { recursive: true, force: true });
    const out = `${run.stdout}${run.stderr}`;

    expect(out).not.toContain('planted');
    expect(fs.existsSync(path.join(gitDir, 'hooks', 'pre-commit'))).toBe(false);
    expect(out).toContain('committed');
    expect(out).toContain('branched');
  },
  60_000,
);
