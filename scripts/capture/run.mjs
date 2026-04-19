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
const workRoot = path.join(tempRoot, 'work');
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(workRoot, { recursive: true });

const captureToken = randomBytes(32).toString('hex');

const PROJECT_NAME = 'Ouijit Demo';
const projectPath = path.join(workRoot, 'ouijit-demo');

const SCENES = [
  { scene: 'kanban', file: 'kanban.png', needsProject: true },
  { scene: 'terminal-stack', file: 'terminal-stack.png', needsProject: true, seeds: buildTerminalSeeds() },
  { scene: 'settings', file: 'settings.png', needsProject: true },
  { scene: 'home', file: 'home.png', needsProject: false },
];

function buildTerminalSeeds() {
  return [
    {
      ptyId: 'capture-pty-1',
      taskId: 1,
      label: 'claude',
      summary: '● Editing capture driver\u2026',
      summaryType: 'thinking',
      worktreeBranch: 'automate-marketing-screenshots-324',
    },
    {
      ptyId: 'capture-pty-2',
      taskId: 2,
      label: 'claude',
      summary: '● Wiring sandbox view worktree',
      summaryType: 'thinking',
      worktreeBranch: 'sandbox-dual-worktree-320',
    },
    {
      ptyId: 'capture-pty-3',
      taskId: 3,
      label: 'claude',
      summary: '✓ Handle hover polished',
      summaryType: 'ready',
      worktreeBranch: 'kanban-drag-handle-325',
    },
    {
      ptyId: 'capture-pty-4',
      taskId: 4,
      label: 'runner',
      summary: 'npm run dev',
      summaryType: 'ready',
      worktreeBranch: 'kanban-drag-handle-hover-326',
      sandboxed: true,
    },
  ];
}

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
    OUIJIT_CAPTURE_TEMP_ROOT: workRoot,
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
