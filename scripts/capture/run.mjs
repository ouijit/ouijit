#!/usr/bin/env node
/**
 * Marketing screenshot driver.
 *
 * Boots the app in capture mode against a temp userData dir, waits for the
 * ready sentinel, then navigates + screencaptures each scene. macOS only —
 * uses `screencapture -l <windowId>`.
 *
 * Env:
 *   OUIJIT_CAPTURE_KEEP=1  leave the temp dir + app running for inspection
 *   OUIJIT_CAPTURE_SKIP_SCREENCAPTURE=1  dry-run navigate-only
 *
 * Usage: npm run capture
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'website', 'assets', 'screenshots');

if (process.platform !== 'darwin') {
  console.error('npm run capture is macOS only (uses screencapture).');
  process.exit(1);
}

const KEEP = process.env.OUIJIT_CAPTURE_KEEP === '1';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-capture-'));
const userDataDir = path.join(tempRoot, 'userData');
fs.mkdirSync(userDataDir, { recursive: true });

const captureToken = randomBytes(32).toString('hex');

const PROJECT_NAME = 'horizon';
const CODE_DIR = path.join(os.homedir(), 'Code');
const projectPath = path.join(CODE_DIR, PROJECT_NAME);
const worktreesPath = path.join(CODE_DIR, `${PROJECT_NAME}-worktrees`);
if (fs.existsSync(projectPath)) {
  console.error(
    `Refusing to overwrite existing ${projectPath}. Move or delete it, ` +
      `or set OUIJIT_CAPTURE_PROJECT_NAME to a different name.`,
  );
  process.exit(1);
}
fs.mkdirSync(CODE_DIR, { recursive: true });

const CLAUDE_SCREEN = [
  '\x1b[38;5;245m> \x1b[0m\x1b[38;5;252mSplit the onboarding wizard into a stepper with saved progress, and move\r\n',
  '  the welcome copy into a reusable intro component so the marketing site\r\n',
  '  can embed it too.\x1b[0m\r\n\r\n',
  '\x1b[38;5;245m⏺\x1b[0m \x1b[1mEdit(src/onboarding/Stepper.tsx)\x1b[0m\r\n',
  '\x1b[38;5;244m  ⎿\x1b[0m  Added step-level progress persistence and a back affordance between\r\n',
  '      each pair of screens.\r\n\r\n',
  '\x1b[38;5;245m⏺\x1b[0m \x1b[1mBash(npm test onboarding)\x1b[0m\r\n',
  '\x1b[38;5;244m  ⎿\x1b[0m  \x1b[38;5;108m✓\x1b[0m 14 passed, 0 failed\r\n\r\n',
  '\x1b[38;5;212m✦\x1b[0m \x1b[2mThinking…\x1b[0m\r\n',
].join('');

const VITE_SCREEN = [
  '\r\n',
  '  \x1b[1mVITE v6.4.2\x1b[0m  ready in \x1b[1m412\x1b[0m ms\r\n\r\n',
  '  \x1b[38;5;108m➜\x1b[0m  \x1b[1mLocal\x1b[0m:   \x1b[38;5;75mhttp://localhost:5173/\x1b[0m\r\n',
  '  \x1b[38;5;108m➜\x1b[0m  \x1b[1mNetwork\x1b[0m: use --host to expose\r\n',
  '  \x1b[38;5;108m➜\x1b[0m  press \x1b[1mh + enter\x1b[0m to show help\r\n\r\n',
  '\x1b[38;5;244m11:52:18 AM\x1b[0m [vite] hmr update \x1b[38;5;108m/src/onboarding/Stepper.tsx\x1b[0m\r\n',
  '\x1b[38;5;244m11:52:19 AM\x1b[0m [vite] page reload \x1b[38;5;108msrc/routes/dashboard.tsx\x1b[0m\r\n',
].join('');

const SANDBOX_SCREEN = [
  '\x1b[38;5;75m╭─ horizon\x1b[0m \x1b[2m(sandbox)\x1b[0m \x1b[38;5;75m──────────────────────────────╮\x1b[0m\r\n',
  '\x1b[38;5;75m│\x1b[0m sandbox:~/horizon$ npm run check\r\n',
  '\x1b[38;5;75m│\x1b[0m \x1b[38;5;108m✓\x1b[0m tsc --noEmit\r\n',
  '\x1b[38;5;75m│\x1b[0m \x1b[38;5;108m✓\x1b[0m eslint src/\r\n',
  '\x1b[38;5;75m│\x1b[0m \x1b[38;5;108m✓\x1b[0m prettier --check src/\r\n',
  '\x1b[38;5;75m│\x1b[0m sandbox:~/horizon$ \x1b[5m▋\x1b[0m\r\n',
  '\x1b[38;5;75m╰──────────────────────────────────────────────╯\x1b[0m\r\n',
].join('');

function buildTerminalSeeds() {
  return [
    {
      ptyId: 'capture-pty-1a',
      taskId: 1,
      label: 'claude',
      summary: 'Editing onboarding stepper\u2026',
      summaryType: 'thinking',
      worktreeBranch: 'rework-onboarding-flow-124',
      content: CLAUDE_SCREEN,
    },
    {
      ptyId: 'capture-pty-1b',
      taskId: 1,
      label: 'npm run dev',
      summary: 'Vite dev server',
      summaryType: 'ready',
      worktreeBranch: 'rework-onboarding-flow-124',
      content: VITE_SCREEN,
    },
    {
      ptyId: 'capture-pty-2',
      taskId: 2,
      label: 'claude',
      summary: 'Wiring the activity feed stream',
      summaryType: 'thinking',
      worktreeBranch: 'dashboard-activity-feed-120',
      content: CLAUDE_SCREEN,
    },
    {
      ptyId: 'capture-pty-3',
      taskId: 3,
      label: 'claude',
      summary: 'Invite email copy tightened',
      summaryType: 'ready',
      worktreeBranch: 'invite-email-polish-119',
      content: CLAUDE_SCREEN,
    },
    {
      ptyId: 'capture-pty-4',
      taskId: 4,
      label: 'claude',
      summary: 'Aligning hover states with design tokens',
      summaryType: 'thinking',
      worktreeBranch: 'cta-hover-states-121',
      sandboxed: true,
      content: SANDBOX_SCREEN,
    },
  ];
}

const SCENES = [
  { scene: 'kanban', file: 'kanban.png', needsProject: true, seeds: buildTerminalSeeds() },
  { scene: 'terminal-stack', file: 'terminal-stack.png', needsProject: true },
  { scene: 'settings', file: 'settings.png', needsProject: true },
];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForReady(userData, timeoutMs = 90_000) {
  const infoPath = path.join(userData, 'capture-info.json');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(infoPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        if (parsed.port && parsed.pid && parsed.cgWindowId) return parsed;
      } catch {
        // file is being written, retry
      }
    }
    await sleep(200);
  }
  throw new Error(`capture-info.json never appeared under ${userData} within ${timeoutMs}ms`);
}

async function postSnapshot(apiPort, payload, outPath, { mode = 'native', settleMs = 900 } = {}) {
  const res = await fetch(`http://127.0.0.1:${apiPort}/api/capture/snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${captureToken}`,
    },
    body: JSON.stringify({ payload, outPath, settleMs, mode }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`snapshot ${payload.scene} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('tempRoot:', tempRoot);

  const env = {
    ...process.env,
    OUIJIT_CAPTURE_MODE: '1',
    OUIJIT_CAPTURE_TOKEN: captureToken,
    OUIJIT_CAPTURE_PROJECT_PATH: projectPath,
    OUIJIT_CAPTURE_PROJECT_NAME: PROJECT_NAME,
    OUIJIT_TEST_USER_DATA: userDataDir,
    ELECTRON_DISABLE_SANDBOX: '1',
  };

  // electron-forge detaches the real Electron child, so npm exits immediately
  // and its stdout never carries Electron's output. We let it run, poll for
  // capture-info.json, and later kill Electron directly by its pid.
  const child = spawn('npm', ['start'], {
    cwd: REPO_ROOT,
    env,
    stdio: 'inherit',
  });

  let electronPid = null;
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (KEEP) {
      console.log('OUIJIT_CAPTURE_KEEP=1 — leaving app + temp dir in place.');
      console.log('temp dir:', tempRoot);
      return;
    }
    for (const pid of [electronPid, child.pid].filter(Boolean)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
    await sleep(600);
    for (const pid of [electronPid, child.pid].filter(Boolean)) {
      if (pid && pidAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(projectPath, { recursive: true, force: true });
      fs.rmSync(worktreesPath, { recursive: true, force: true });
    } catch {}
  };
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });

  try {
    console.log('Waiting for app to boot\u2026');
    const info = await waitForReady(userDataDir);
    electronPid = info.pid;
    const apiPort = info.port;
    console.log(
      'apiPort:',
      apiPort,
      'electronPid:',
      info.pid,
      'cgWindowId:',
      info.cgWindowId,
      'bounds:',
      info.bounds,
    );
    // Let the renderer settle before the first navigate
    await sleep(1500);

    let mode = process.env.OUIJIT_CAPTURE_MODE_HINT ?? 'native';
    for (const scene of SCENES) {
      const payload = { scene: scene.scene };
      if (scene.needsProject) payload.projectPath = projectPath;
      if (scene.seeds) payload.terminalSeeds = scene.seeds;

      console.log(`→ ${scene.scene}`);
      const outPath = path.join(OUT_DIR, scene.file);
      try {
        const res = await postSnapshot(apiPort, payload, outPath, { mode });
        console.log(`   wrote ${path.relative(REPO_ROOT, outPath)} (${res.data.bytes} bytes, mode=${res.data.mode})`);
      } catch (err) {
        if (mode === 'native') {
          console.warn(`   native capture failed (${err.message.split('\n')[0]}); falling back to content mode`);
          mode = 'content';
          const res = await postSnapshot(apiPort, payload, outPath, { mode });
          console.log(`   wrote ${path.relative(REPO_ROOT, outPath)} (${res.data.bytes} bytes, mode=${res.data.mode})`);
        } else {
          throw err;
        }
      }
    }

    console.log('Done.');
  } catch (err) {
    console.error('capture failed:', err.message);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main();
