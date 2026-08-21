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
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, composeDiagonalSlices } from './composite.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
// Write straight into the website's served/committed asset dir so a capture run
// actually updates the images the site (index.astro) and README reference. Astro
// serves `public/` at the site root, so these land at /assets/screenshots/*.png.
const OUT_DIR = path.join(REPO_ROOT, 'website', 'public', 'assets', 'screenshots');

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

// What the preview scene's webview shows — the onboarding stepper the seeded
// agent narrative is building, served by a throwaway local HTTP server.
const PREVIEW_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>horizon</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    background: #101014; color: #e8e8ec; min-height: 100vh;
    display: flex; flex-direction: column;
  }
  header {
    display: flex; align-items: center; gap: 10px;
    padding: 18px 28px; border-bottom: 1px solid #ffffff14;
  }
  .dot { width: 22px; height: 22px; border-radius: 7px; background: linear-gradient(135deg, #7c5cff, #4f9cff); }
  .brand { font-weight: 650; letter-spacing: 0.01em; }
  main { flex: 1; display: grid; place-items: center; padding: 32px; }
  .card {
    width: min(520px, 92vw); background: #17171d; border: 1px solid #ffffff14;
    border-radius: 16px; padding: 36px 40px 32px;
  }
  ol { display: flex; gap: 8px; list-style: none; padding: 0; margin: 0 0 30px; }
  li { flex: 1; text-align: center; font-size: 12px; color: #9a9aa5; padding-top: 10px; border-top: 3px solid #2c2c36; }
  li.active { color: #e8e8ec; border-top-color: #7c5cff; }
  h1 { font-size: 24px; margin-bottom: 10px; }
  p { color: #b6b6c0; line-height: 1.55; margin-bottom: 26px; }
  label { display: block; font-size: 12px; color: #9a9aa5; margin-bottom: 6px; }
  input {
    width: 100%; padding: 10px 12px; margin-bottom: 22px; border-radius: 9px;
    border: 1px solid #ffffff1f; background: #101014; color: #e8e8ec; font-size: 14px;
  }
  button {
    width: 100%; padding: 11px; border: none; border-radius: 9px;
    background: #7c5cff; color: #fff; font-size: 14px; font-weight: 600;
  }
</style>
</head>
<body>
  <header><div class="dot"></div><span class="brand">horizon</span></header>
  <main>
    <div class="card">
      <ol><li>Profile</li><li class="active">Workspace</li><li>Invite</li></ol>
      <h1>Name your workspace</h1>
      <p>Three quick steps and your workspace is ready to share. Close the tab any time — you'll pick up right here.</p>
      <label for="ws">Workspace name</label>
      <input id="ws" value="Horizon HQ">
      <button>Continue</button>
    </div>
  </main>
</body>
</html>
`;

function startPreviewServer(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PREVIEW_PAGE);
    });
    // The preferred port matches the seeded vite screen's printed URL; when
    // something real is already listening there, any free port still works.
    server.once('error', () => server.listen(0, '127.0.0.1', () => resolve(server)));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

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
      planPath: path.join(os.homedir(), 'Code', 'horizon', 'plans', 'rework-onboarding-flow.md'),
      planPanelOpen: true,
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

// Every scene pins its theme — an unpinned scene follows the capturing
// machine's OS appearance and the output would flip between runs.
const SCENES = [
  { scene: 'kanban', file: 'kanban.png', needsProject: true, seeds: buildTerminalSeeds(), theme: 'dark' },
  { scene: 'markdown', file: 'markdown.png', needsProject: true, theme: 'dark', settleMs: 1600 },
  { scene: 'preview', file: 'preview.png', needsProject: true, previewPtyId: 'capture-pty-1b', theme: 'dark', settleMs: 2500 },
  { scene: 'palette', file: 'palette.png', needsProject: true, theme: 'dark' },
  { scene: 'diff', file: 'diff.png', needsProject: true, diffPtyId: 'capture-pty-1a', theme: 'dark' },
  { scene: 'settings', file: 'settings.png', needsProject: true, theme: 'dark' },
  // The resume banner lists one row per snapshot terminal; three rows reads as
  // an example, the full seed list reads as clutter.
  {
    scene: 'resume',
    file: 'resume.png',
    needsProject: true,
    seeds: buildTerminalSeeds().slice(0, 3),
    theme: 'dark',
    settleMs: 2500,
  },
];

// One kanban shot per theme, joined into slanted bands — a single image that
// shows theming instead of a second full screenshot per theme.
const THEME_COMPOSITE = {
  file: 'themes.png',
  scene: 'kanban',
  themes: ['dark', 'custom:dracula', 'custom:sepia', 'light'],
};

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
  let previewServer = null;
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    previewServer?.close();
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

    previewServer = await startPreviewServer(5173);
    const previewUrl = `http://localhost:${previewServer.address().port}/`;

    let mode = process.env.OUIJIT_CAPTURE_MODE_HINT ?? 'native';
    const capture = async (payload, outPath, settleMs) => {
      try {
        const res = await postSnapshot(apiPort, payload, outPath, { mode, settleMs });
        console.log(`   wrote ${path.relative(REPO_ROOT, outPath)} (${res.data.bytes} bytes, mode=${res.data.mode})`);
      } catch (err) {
        if (mode !== 'native') throw err;
        console.warn(`   native capture failed (${err.message.split('\n')[0]}); falling back to content mode`);
        mode = 'content';
        const res = await postSnapshot(apiPort, payload, outPath, { mode, settleMs });
        console.log(`   wrote ${path.relative(REPO_ROOT, outPath)} (${res.data.bytes} bytes, mode=${res.data.mode})`);
      }
    };

    for (const scene of SCENES) {
      const payload = { scene: scene.scene };
      if (scene.needsProject) payload.projectPath = projectPath;
      if (scene.seeds) payload.terminalSeeds = scene.seeds;
      if (scene.theme) payload.theme = scene.theme;
      if (scene.diffPtyId) payload.diffPtyId = scene.diffPtyId;
      if (scene.previewPtyId) {
        payload.previewPtyId = scene.previewPtyId;
        payload.previewUrl = previewUrl;
      }

      console.log(`→ ${scene.file}`);
      await capture(payload, path.join(OUT_DIR, scene.file), scene.settleMs);
    }

    console.log(`→ ${THEME_COMPOSITE.file}`);
    const slicePaths = [];
    for (const [i, theme] of THEME_COMPOSITE.themes.entries()) {
      const slicePath = path.join(tempRoot, `theme-${i}.png`);
      // Re-seed: the resume scene cleared the terminals, and the board reads
      // better with agent chips on the cards.
      await capture(
        { scene: THEME_COMPOSITE.scene, projectPath, theme, terminalSeeds: buildTerminalSeeds() },
        slicePath,
        undefined,
      );
      slicePaths.push(slicePath);
    }
    const composed = composeDiagonalSlices(slicePaths.map((p) => decodePng(fs.readFileSync(p))));
    const compositePath = path.join(OUT_DIR, THEME_COMPOSITE.file);
    fs.writeFileSync(compositePath, encodePng(composed));
    console.log(`   wrote ${path.relative(REPO_ROOT, compositePath)} (${fs.statSync(compositePath).size} bytes)`);

    console.log('Done.');
  } catch (err) {
    console.error('capture failed:', err.message);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main();
