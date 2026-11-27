#!/usr/bin/env node
// Usage: node scripts/smoke-packaged.mjs [build]
//   build: a .dmg, a .zip, a .app, or a directory holding a .app or an unpacked
//   Linux build. Defaults to `npm run package` output for this machine.

import { spawn, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const API_TIMEOUT_MS = 90_000;
const STEP_TIMEOUT_MS = 30_000;
const QUIT_TIMEOUT_MS = 20_000;
// The terminal echoes the command it runs, so the expected output must not
// appear in the command's own text.
const TERMINAL_COMMAND = `ouijit task current | grep -q '"taskNumber"' && echo ouijit-smoke-$((6*7))`;
const TERMINAL_OUTPUT = 'ouijit-smoke-42';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-smoke-')));
const dirs = {
  home: path.join(root, 'home'),
  userData: path.join(root, 'user-data'),
  repo: path.join(root, 'smoke-project'),
  unpacked: path.join(root, 'unpacked'),
  mount: path.join(root, 'mount'),
};
let mounted = false;
let app = null;
let appOutput = '';
let currentStep = 'locate the build';

function hasExited() {
  return app !== null && (app.exitCode !== null || app.signalCode !== null);
}

function step(name) {
  currentStep = name;
  console.log(`smoke: ${name}`);
}

class SmokeError extends Error {}

function fail(message) {
  throw new SmokeError(message);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function until(what, probe, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    if (hasExited()) fail(`the app exited (${app.exitCode ?? app.signalCode}) while waiting for ${what}`);
    try {
      const value = await probe();
      if (value) return value;
    } catch (err) {
      last = err;
    }
    await sleep(250);
  }
  fail(`timed out after ${timeoutMs / 1000}s waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

function defaultBuild() {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return path.resolve('out', `${pkg.productName}-${process.platform}-${process.arch}`);
}

/** Opens whatever was passed down to a directory that holds the app. */
function unpack(build) {
  if (!fs.existsSync(build)) fail(`no build at ${build}`);
  if (build.endsWith('.dmg')) {
    fs.mkdirSync(dirs.mount);
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', dirs.mount, build], {
      stdio: 'ignore',
    });
    mounted = true;
    return dirs.mount;
  }
  if (build.endsWith('.zip')) {
    fs.mkdirSync(dirs.unpacked);
    // ditto keeps the symlinks and signatures inside a .app bundle.
    if (process.platform === 'darwin') execFileSync('ditto', ['-x', '-k', build, dirs.unpacked]);
    else execFileSync('unzip', ['-q', build, '-d', dirs.unpacked]);
    return dirs.unpacked;
  }
  return build;
}

/** The app's executable and the CLI bundled inside it. */
function locateApp(dir, depth = 0) {
  if (dir.endsWith('.app')) {
    const macos = path.join(dir, 'Contents', 'MacOS');
    const [name] = fs.readdirSync(macos);
    return {
      executable: path.join(macos, name),
      cli: path.join(dir, 'Contents', 'Resources', 'app', 'cli', 'ouijit.js'),
    };
  }
  const cli = path.join(dir, 'resources', 'app', 'cli', 'ouijit.js');
  const executable = path.join(dir, 'ouijit');
  if (fs.existsSync(cli) && fs.existsSync(executable)) return { executable, cli };
  if (depth < 2) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const found = locateApp(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  }
  if (depth === 0) fail(`no Ouijit app found in ${dir}`);
  return null;
}

/** Everything but this machine's own Ouijit session, which would otherwise answer the CLI. */
function cleanEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('OUIJIT_') && key !== 'ELECTRON_RUN_AS_NODE'),
  );
}

function launch(executable) {
  for (const dir of [dirs.home, dirs.userData]) fs.mkdirSync(dir);
  // A HOME of its own keeps the user's shell config out of the terminal.
  const env = { ...cleanEnv(), HOME: dirs.home, OUIJIT_TEST_USER_DATA: dirs.userData, OUIJIT_E2E: '1' };
  // Chromium keeps its cookie key in the OS keyring, which a fresh HOME has
  // none of: macOS then blocks quitting on SecItemAdd. On Linux, unprivileged
  // user namespaces are off on Ubuntu runners and an unpacked build's
  // chrome-sandbox is not setuid root.
  const args = process.platform === 'darwin' ? ['--use-mock-keychain'] : ['--password-store=basic', '--no-sandbox'];
  app = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const capture = (chunk) => {
    appOutput += chunk.toString();
  };
  app.stdout.on('data', capture);
  app.stderr.on('data', capture);
}

function readApiCredentials() {
  const file = path.join(dirs.userData, 'e2e-api.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function makeCli(cliPath, api) {
  return (...args) => {
    try {
      const stdout = execFileSync(process.execPath, [cliPath, ...args], {
        cwd: root,
        env: { ...cleanEnv(), OUIJIT_API_URL: api.url, OUIJIT_API_TOKEN: api.token },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // until() cannot interrupt a synchronous call, and the CLI waits on
        // the app with no timeout of its own.
        timeout: STEP_TIMEOUT_MS,
      });
      return JSON.parse(stdout);
    } catch (err) {
      const detail = err.stderr?.trim() || err.message;
      throw new Error(`ouijit ${args.join(' ')}: ${detail}`);
    }
  };
}

function createRepo() {
  fs.mkdirSync(dirs.repo);
  const git = (...args) => execFileSync('git', args, { cwd: dirs.repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dirs.repo, 'README.md'), '# Smoke\n');
  git('add', '.');
  git('-c', 'user.name=Ouijit Smoke', '-c', 'user.email=smoke@ouijit.invalid', 'commit', '-q', '-m', 'init');
}

async function quit() {
  if (!app || hasExited()) return;
  const exited = new Promise((r) => app.once('exit', r));
  app.kill('SIGTERM');
  const timedOut = await Promise.race([exited.then(() => false), sleep(QUIT_TIMEOUT_MS).then(() => true)]);
  if (timedOut) {
    app.kill('SIGKILL');
    await exited;
    fail(`the app did not quit within ${QUIT_TIMEOUT_MS / 1000}s of SIGTERM`);
  }
}

function printLogs() {
  console.error('\n--- app log (tail) ---');
  console.error(appOutput.split('\n').slice(-200).join('\n') || '(nothing)');
}

function cleanup() {
  if (app && !hasExited()) app.kill('SIGKILL');
  if (mounted) {
    try {
      execFileSync('hdiutil', ['detach', dirs.mount, '-force'], { stdio: 'ignore' });
    } catch {
      console.error(`smoke: could not detach ${dirs.mount}`);
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

async function smoke(build) {
  const { executable, cli: cliPath } = locateApp(unpack(build));
  if (!fs.existsSync(cliPath)) fail(`the build has no bundled CLI at ${cliPath}`);
  console.log(`smoke: app ${executable}`);

  step('launch the app');
  launch(executable);

  step('wait for the API');
  const api = await until('the app to write its API credentials', readApiCredentials, API_TIMEOUT_MS);
  const cli = makeCli(cliPath, api);
  await until('the API to answer', () => Array.isArray(cli('project', 'list')));

  step('create a project and a task from a temp git repo');
  createRepo();
  const started = cli('task', 'create-and-start', 'Smoke', '--project', dirs.repo, '--hook-command', TERMINAL_COMMAND);
  if (!started.success) fail(`task create-and-start did not succeed: ${JSON.stringify(started)}`);
  const { taskNumber, worktreePath } = started.task;
  if (!worktreePath || !fs.existsSync(worktreePath)) fail(`the task's worktree was not created at ${worktreePath}`);
  const projects = cli('project', 'list');
  if (!projects.some((p) => p.path === dirs.repo))
    fail(`project list does not include ${dirs.repo}: ${JSON.stringify(projects)}`);

  step("find the task's terminal");
  const terminal = await until('a terminal on the task', () =>
    cli('terminal', 'list').find((t) => t.projectPath === dirs.repo && t.taskNumber === taskNumber),
  );

  step('read the command output back from the terminal');
  let screen = '';
  try {
    await until(`"${TERMINAL_OUTPUT}" in the terminal`, () => {
      screen = cli('terminal', 'read', terminal.ptyId).text;
      return screen.includes(TERMINAL_OUTPUT);
    });
  } catch (err) {
    fail(`${err.message}\n--- terminal screen ---\n${screen}`);
  }

  step('close the terminal');
  cli('terminal', 'close', terminal.ptyId);

  step('quit the app');
  await quit();
}

const build = path.resolve(process.argv[2] ?? defaultBuild());
let exitCode = 0;
try {
  await smoke(build);
  console.log(`smoke: passed (${build})`);
} catch (err) {
  exitCode = 1;
  console.error(`\nsmoke: FAILED at "${currentStep}": ${err instanceof SmokeError ? err.message : err.stack}`);
  printLogs();
} finally {
  cleanup();
}
process.exit(exitCode);
