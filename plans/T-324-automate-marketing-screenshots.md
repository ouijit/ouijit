# T-324 — Automate marketing screenshots via screencapture

## Outcome

One command — `npm run capture` — regenerates README + website imagery from a deterministic Ouijit state using macOS `screencapture`. Output lands in `website/assets/screenshots/*.png` and the README image references are updated to use them.

The app boots against a disposable SQLite DB + temp project dir seeded by a fixture, renders each scene at a fixed 1440×900 window size, and is captured by window id. Whole run completes in under ~60s and is idempotent.

## Starting point

Branch `automate-marketing-screenshots-via-screencapture-324` is at `main` (05c6ef0). No capture infra exists yet. Current assets:

- `website/assets/demo.mp4`, `demo.webm`, `demo-poster.jpg` — hero video, keep alongside new stills
- `README.md` line ~12 references `board.gif` (not in repo — broken link; replace with the new hero PNG)
- `scripts/` only has build/db/lima helpers — no capture dir

## Decisions on open questions

| Question | Decision | Reason |
|---|---|---|
| Retina scale | Capture at 2× default; no downscale | Marketing site wants hi-DPI; PNG size is not a blocker |
| Canvas scene content | Static seeded git diffs (committed fixture) | Determinism over realism; real diffs drift |
| Website video | Keep `demo.mp4` in hero; add stills below | Additive — no need to delete working asset |
| Kanban fork indicator | Verify existing rendering first; add minimal badge only if missing | Out-of-scope feature creep otherwise |

## Scenes

1. **kanban** — all 4 columns populated; ≥3 `in_progress` with terminal cards visible; thinking-status lights lit on ≥2; one parent task with a fork child
2. **settings** — Settings view open with populated hooks, scripts, and scan paths
3. **terminal-stack** — Project mode focused on one task with multiple stacked terminal cards
4. **canvas** — Canvas view open (experimental toggle enabled in fixture) with seeded diff nodes

## Architecture

### 1. Capture-mode flag

`OUIJIT_CAPTURE_MODE=1` gates behavior in `src/main.ts`:

- DB points at `process.env.OUIJIT_FIXTURE_DB` (temp file path passed by the driver) instead of `getDbPath()`
- `BrowserWindow` fixed to `width: 1440, height: 900`, `resizable: false`, `useContentSize: true`
- DevTools closed
- Auto-updater skipped (`initUpdater` no-op)
- After `mainWindow.webContents.once('did-finish-load')` + one frame → `process.stdout.write('__OUIJIT_READY__\n')`

**Files touched:**
- `src/main.ts` — branch on `OUIJIT_CAPTURE_MODE` in the three spots above
- `src/paths.ts` — allow `OUIJIT_FIXTURE_DB` override of `getDbPath()`
- `src/updater.ts` — early-return from `initUpdater` when capture mode is on

### 2. Seed fixture — `scripts/capture/fixture.ts`

Compiled via tsx (already transitively available) or a small standalone esbuild bundle. Exports `seedFixture(opts: { dbPath: string; projectDir: string }): Promise<void>`.

Steps inside `seedFixture`:

1. Create `projectDir` (temp dir under `os.tmpdir()/ouijit-capture-<pid>/project`), `git init`, seed a few text files, initial commit on `main`.
2. Open SQLite at `dbPath` via `initDatabase` — ensures migrations run against the temp DB.
3. Use `ProjectRepo` to insert one project pointing at `projectDir`.
4. Use `TaskRepo` to create ~12 tasks spread across `todo / in_progress / in_review / done` columns. Names cribbed from real-looking product work ("Add drag handle to kanban cards", "Wire settings sync", etc.). One `in_progress` task has `parentTaskId` on another for the fork relationship.
5. For each `in_progress` task, call `createTaskWorktree` so real worktrees exist on disk (kanban cards render `worktreePath`).
6. Use `HookRepo`/`SettingsRepo` (via a new `scanPathRepo` call if needed) to populate example hooks, scripts, and scan paths.
7. Synthesize thinking-status rows: new tiny helper `setHookStatusForPty(ptyId, 'thinking', 1)` exposed behind `OUIJIT_CAPTURE_MODE` in `src/hookServer.ts`. Driver calls this via the capture-only HTTP endpoint (see §3) after scenes load — avoids having to spawn real shells.

PTY spawns are **skipped** entirely. The UI renders terminal cards off task rows; the "thinking" light only needs a hook-status entry. If kanban cards require an active `ptyId` to show a light, we insert a synthetic one against the task in the DB and mock `isPtyActive` return via a `CAPTURE_FAKE_PTYS` set-based override in `ptyManager.ts` (cheap: one line checking the env + a Set populated from seed).

**Files touched:**
- `scripts/capture/fixture.ts` (new)
- `src/hookServer.ts` — add a capture-only `POST /api/capture/status` route, gated on `OUIJIT_CAPTURE_MODE === '1'`, that accepts `{ ptyId, status, thinkingCount }` and writes through `setHookStatus`. Stays off in production builds at runtime.
- `src/ptyManager.ts` — tiny override: if `OUIJIT_CAPTURE_MODE === '1'` and the ptyId is in `CAPTURE_FAKE_PTYS`, `isPtyActive` returns true

### 3. Capture driver — `scripts/capture/run.mjs`

Node ESM script, no deps beyond Node stdlib + `electron` (spawned).

Flow:

```js
1. mkdtemp under os.tmpdir() → { dbPath, projectDir, fixtureRoot }
2. Compile fixture once (tsx scripts/capture/fixture.ts --db=... --project=...) to seed DB + worktrees
3. spawn('npm', ['start'], { env: { ...process.env, OUIJIT_CAPTURE_MODE: '1', OUIJIT_FIXTURE_DB: dbPath, OUIJIT_USER_DATA: fixtureRoot } })
4. Wait on stdout for '__OUIJIT_READY__' (timeout 30s)
5. Resolve window id:
     osascript -e 'tell app "System Events" to tell process "Electron" to id of window 1'
   (In dev the app name is "Electron"; in packaged builds it would be "ouijit" — detect by parsing first returned line or try both.)
6. For each scene in [kanban, settings, terminal-stack, canvas]:
     a. POST http://localhost:<apiPort>/api/capture/navigate  { scene }
        — new capture-only route; acks once the view has mounted + one RAF has passed.
     b. If scene === 'kanban', POST /api/capture/status for the chosen thinking ptyIds.
     c. Sleep 250ms grace (fonts, animations settle)
     d. screencapture -x -o -t png -l <windowId> website/assets/screenshots/<scene>.png
7. Teardown: SIGTERM the Electron process, await exit, rm -rf fixtureRoot, rm -rf projectDir
```

Fail-hard on any step; print which scene failed and the last 20 lines of app stdout.

**Files touched:**
- `scripts/capture/run.mjs` (new)
- `scripts/capture/fixture.ts` (new — see §2)
- `src/api/router.ts` — add capture-only routes `/api/capture/navigate`, `/api/capture/status`, gated on env flag. Route handlers live in a new `src/api/captureRoutes.ts`.
- `src/renderer.tsx` or `src/App.tsx` — listen for an IPC message `capture:navigate` and imperatively switch to the requested view (home → project grid, project → kanban/terminal/canvas, settings open). Reuses existing routing functions. New file `src/capture/navigator.ts` wires this up behind `OUIJIT_CAPTURE_MODE`.
- `src/preload.ts` + `src/ipc/contract.ts` — expose the `capture:navigate` one-way event

### 4. Output wiring

After captures succeed:

1. `README.md` — replace the broken `board.gif` line with `![Ouijit Kanban](website/assets/screenshots/kanban.png)` and add a 2×2 small-grid section below linking the other three scenes.
2. `website/index.html` — add a "Screens" section with the four PNGs. Leave `<video>` block untouched.

Driver writes the PNGs only — README / HTML edits are done manually in this PR and left stable thereafter (no templating).

### 5. Package script

Add to `package.json` scripts:

```json
"capture": "node scripts/capture/run.mjs"
```

Pretest hooks not needed — it's a side-channel tool, not CI.

## Steps

1. **Capture-mode plumbing** — `src/main.ts`, `src/paths.ts`, `src/updater.ts` read `OUIJIT_CAPTURE_MODE`. Emit `__OUIJIT_READY__`. Verify by hand: `OUIJIT_CAPTURE_MODE=1 OUIJIT_FIXTURE_DB=/tmp/x.db npm start` boots to a fixed-size empty window and logs the sentinel.
2. **Capture-only API + navigator** — add `src/api/captureRoutes.ts`, register in `src/api/router.ts`, add IPC `capture:navigate` channel, add `src/capture/navigator.ts` renderer-side that switches views. Manually POST to each route and confirm the UI switches.
3. **Fixture seeder** — `scripts/capture/fixture.ts`. Run it standalone, open the seeded DB in the normal app (pointing at it via `OUIJIT_FIXTURE_DB`), confirm kanban/settings look right.
4. **Hook-status + fake-pty shim** — `/api/capture/status` route + `CAPTURE_FAKE_PTYS` override in `ptyManager.ts` + `setHookStatus` helper. Verify thinking light lights up.
5. **Driver** — `scripts/capture/run.mjs`. First with `screencapture` commented out to confirm navigation works for all scenes; then enable capture.
6. **Wire README + website** — update `README.md` image refs and add a "Screens" section to `website/index.html`.
7. **Add `npm run capture` to `package.json`**.
8. **Sanity** — run `npm run check` and `npm test`. Re-run `npm run capture` twice in a row to confirm idempotency.

## Test plan

- **Unit**: `fixture.test.ts` — seeding against an in-memory temp DB produces expected task/column counts and parent-child relationships.
- **Unit**: `captureRoutes.test.ts` — `/api/capture/*` routes return 404 when `OUIJIT_CAPTURE_MODE` is unset; 200 when set.
- **Manual**: `npm run capture` on macOS produces four non-empty PNGs of the expected dimensions (2880×1800 at 2×). Inspect visually.
- **No e2e**: capture is a host-only dev tool; not worth Playwright coverage.

## Risk / rollback

Self-contained behind one env flag. Production paths untouched. If it breaks, revert the branch and no user impact. The only runtime-shipped code is the capture-mode branches in `main.ts` / `router.ts` / `ptyManager.ts` / `hookServer.ts` — all early-exit when `OUIJIT_CAPTURE_MODE !== '1'`, so zero behavior change in released builds.

## Out of scope

- Cross-platform capture (Linux/Windows). macOS-only; the CLI name is `screencapture`.
- GIF generation. This task produces PNGs only; GIFs can be a follow-up using `ffmpeg` on recorded frames.
- Replacing `demo.mp4`. Additive only.
- Automated kanban fork-relationship visualization — verify it already exists during step 3; if missing, track as a separate follow-up task, do not expand scope here.
