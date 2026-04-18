# T-320 — Sandbox isolation via dual-worktree architecture

## Outcome

Replace the in-guest bind-mount overlay (PR #126) with a host-side **dual-worktree** design:

- **User worktree** (unchanged): `~/Ouijit/worktrees/<project>/T-N/` on branch `T-N`, with real `.env` + `node_modules/` etc.
- **Sandbox view** (new): `~/Ouijit/sandbox-views/<project>/T-N/` on child branch `T-N-sandbox`, created via `git worktree add -b T-N-sandbox <path> T-N`. Tracked files only — by construction no gitignored content ever materializes here.

Lima mounts **only** the sandbox-view into the guest. Nothing to mask, so the overlay machinery and sudo narrowing go away — guest gets stock `NOPASSWD: ALL`, `apt-get`, `npm i -g` etc. all work.

Host↔guest boundary becomes the real VM frontier.

## Starting point

Branch `sandbox-isolation-via-dual-worktree-architecture-320` is at `main` (4263c29, no diff). PR #126 lives on `harden-lima-sandbox-against-escape-vectors-318` — will be cherry-picked selectively (see step 1).

## Steps

### 1. Cherry-pick the boundary fixes from PR #126

These are independent of the overlay and worth keeping as the first commits on this branch. Cherry-pick the pieces of each commit that touch only these files:

- `src/apiAuth.ts` (new) — bearer-token auth with `host` vs `sandbox` scopes.
- `src/api/router.ts` + `src/hookServer.ts` — enforce scopes on every route; default = `host`-only.
- `src/ptyManager.ts` — wire per-PTY token into session state.
- `src/cli/api.ts` — CLI sends its `host`-scoped token.
- `src/lima/spawn.ts` — `buildLimactlHostEnv` env allowlist for `limactl shell` (retain only this helper; the rest of spawn.ts is rewritten in step 4).
- `src/utils/pathSafety.ts` + `src/ipc/handlers/plan.ts` — realpath-based symlink escape guard used by `plan:check-files-exist`.
- Tests: `apiAuth.test.ts`, `apiRouterAuth.test.ts`, updated `hookServer.test.ts`, `limactlHostEnv.test.ts`, `pathSafety.test.ts`.

Strategy: `git cherry-pick -n <sha>` each PR #126 commit, then `git reset HEAD <excluded paths>` and `git checkout -- <excluded paths>` to drop overlay/configStore changes. Commit as **"Add scoped API auth, env allowlist, and symlink escape guard (from #126)"**.

Do **not** carry over: `src/lima/overlay.ts`, `src/lima/configStore.ts` sudoers narrowing / `NOPASSWD:ALL` strip / overlay helper install, `src/__tests__/configStore.test.ts` (re-add only the parts unrelated to overlay), the sandbox-specific sections of `src/__tests__/sandboxedTask.test.ts` that assert overlay behavior.

### 2. Add sandbox-view worktree lifecycle

New module **`src/lima/sandboxSync.ts`** (keeps `src/worktree.ts` focused on user-facing worktrees):

```ts
export function getSandboxViewBaseDir(projectName: string): string   // ~/Ouijit/sandbox-views/<projectName>
export async function startSandboxView(projectPath: string, taskNumber: number, userWorktreeBranch: string): Promise<{ path: string; branch: string }>
export async function stopSandboxView(projectPath: string, taskNumber: number): Promise<void>
export function watchSandboxRef(projectPath: string, taskNumber: number, onUpdate: () => void): () => void  // returns dispose
export async function ffMergeSandboxToUser(projectPath: string, taskNumber: number): Promise<{ ok: true } | { ok: false; reason: 'non-ff' | 'other'; error?: string }>
```

Implementation notes:

- `startSandboxView`: `execFileAsync('git', ['worktree', 'add', '-b', \`T-${n}-sandbox\`, viewPath, userBranch], { cwd: projectPath })`. Handle resume (directory already present, branch already exists) the same way `startTask` does.
- `stopSandboxView`: `git worktree remove --force <path>` then `git branch -D T-<n>-sandbox` (best-effort, mirroring `removeTaskWorktree`). Also clean up any `sandbox-views` parent dir if empty.
- `watchSandboxRef`: `fs.watch(path.join(projectPath, '.git/refs/heads', \`T-${n}-sandbox\`))`. On `rename`/`change`, debounce ~100ms then call `onUpdate`. On `ENOENT` (loose ref packed away), fall back to `fs.watch('.git/packed-refs')` and compare via `git rev-parse`. Return a dispose fn that closes both watchers.
- `ffMergeSandboxToUser`: `execFileAsync('git', ['merge', '--ff-only', \`T-${n}-sandbox\`], { cwd: userWorktreePath })`. Classify failures: `'non-ff'` if stderr contains `Not possible to fast-forward`, otherwise `'other'`.

Unit tests in `src/__tests__/sandboxSync.test.ts` (mirror `worktreeTask.test.ts` pattern — `mkdtemp` + `git init` + commits, then drive the functions directly):
- start → stop roundtrip leaves no branches/worktrees.
- Commit in sandbox-view → `ffMergeSandboxToUser` fast-forwards user-wt.
- Commit in both → returns `{ ok: false, reason: 'non-ff' }` and user-wt is untouched.
- `watchSandboxRef` fires on commit inside the sandbox-view.
- `git reset --hard` moves the ref backward → ff-merge returns `non-ff`, user-wt untouched.

### 3. Rewrite Lima mount config for sandboxed tasks

Edit `src/lima/config.ts`:

- `buildProjectMounts(projectPath)` stays as-is for **unsandboxed** case.
- Add `buildSandboxProjectMounts(projectPath, sandboxViewPath)`: returns **only** the sandbox-view as a writable mount. No project root, no `worktreeBaseDir`. Guest has no path by which to see host `.env`.
- Caller (Lima startup) picks between the two based on whether any sandboxed task is starting. (If the manager starts one VM per project shared across tasks, reconcile: either accept that starting a sandboxed task adds the sandbox-view mount to the existing VM — requires `limactl stop`/`start` or a `limactl edit` — or switch to one VM per sandboxed task. Investigate current behavior in `src/lima/manager.ts` before committing to a choice; this is a known fork point.)

Add test `src/__tests__/limaConfig.test.ts` (or extend existing) asserting that `buildSandboxProjectMounts` returns exactly one mount pointing at the sandbox-view path and never at the project root or base worktree dir.

### 4. Rewrite `src/lima/spawn.ts` for the dual-worktree model

Gut the overlay machinery:
- Delete imports of `listMaskedPaths`, `buildOverlayBindMountSetup`, `buildSandboxNoMatchesBanner`.
- Delete the ~50 lines that enumerate masks and build `overlaySetup`.
- Drop `src/lima/overlay.ts` entirely.

Add sandbox-view plumbing:
- Before `ensureRunning`: call `startSandboxView(projectPath, taskId, userBranch)` (need `userBranch` — thread it through `PtySpawnOptions` or look it up from the task record by `taskId`).
- Set `guestCwd = sandboxViewPath` (not `options.cwd`) so the shell opens in the sandbox-view.
- After `pty.spawn`, call `watchSandboxRef(projectPath, taskId, () => ffMergeSandboxToUser(projectPath, taskId).then(emitResult))`. Store the dispose fn on `ManagedSandboxPty` so `killSandboxPty` / `cleanupSandboxPtys` can call it.
- Keep `buildLimactlHostEnv` from step 1 — still needed.

### 5. Revert provisioning + drop overlay references

- `src/lima/configStore.ts` `PROVISION_SCRIPT`: drop sudoers narrowing, drop `OVERLAY_HELPER_SCRIPT` install, drop `/etc/profile.d/ouijit-npm.sh`. Remove any `iptables` / `FIREWALL_SCRIPT` / `FIREWALL_UNIT` leftovers if still present. Target: near-stock Ubuntu + the apt deps we already need (node/python/build-essential).
- `src/worktree.ts`: remove the `import { buildOverlayCleanup } from './lima/overlay'` and the `runInVm(...)` overlay-cleanup block in `removeTaskWorktree` (lines ~487–498). Replace with a call to `stopSandboxView(projectPath, taskNumber)` guarded by `task?.sandboxed`.
- Delete `src/lima/overlay.ts` and any surviving overlay tests.

### 6. UI: surface divergence

When `ffMergeSandboxToUser` returns `{ ok: false, reason: 'non-ff' }`:
- Emit an IPC event (e.g., `sandbox:diverged` with `{ taskNumber, userBranch, sandboxBranch }`).
- Renderer shows a toast / inline action on the terminal card: **"Agent commits diverged from your branch — open merge"**. Wire click to existing merge UI if it covers branch-vs-branch; otherwise a minimal `git mergetool` hand-off is fine for v1.

Keep this intentionally small — the common case is silent fast-forward; we just need *something* when it doesn't ff.

### 7. Validation checklist

Before opening the PR, manually verify on a real project:

- [ ] Create a sandboxed task. Confirm `~/Ouijit/sandbox-views/<project>/T-N/` exists on branch `T-N-sandbox`.
- [ ] Inside the VM, confirm the host `.env` / `node_modules/` are **not** visible under any path.
- [ ] Inside the VM, `sudo apt-get install -y cowsay` succeeds (proves stock sudo restored).
- [ ] Inside the VM, `npm i -g prettier` succeeds.
- [ ] Agent commits inside the VM → commits appear on user's `T-N` branch within ~1s (fast-forward watcher fires).
- [ ] Commit on both sides → UI surfaces the diverged state; user-wt content is untouched.
- [ ] `sudo curl host.lima.internal:<port>/api/tasks` with a sandbox token returns 403 on host-only routes (scoped auth still holds).
- [ ] Task delete tears down both the user worktree **and** the sandbox-view worktree + branch. `git worktree list` is clean.
- [ ] `npm run check` and `npm test` both green.

## Risks & mitigations

- **Mount topology churn** (step 3). If a single VM per project is shared across tasks and the sandbox-view mount must be added mid-lifetime, we may need VM restart on first sandboxed-task start. Investigate `src/lima/manager.ts` before writing the mount code — don't assume.
- **Ref watcher misses a commit** (packed-refs edge case). Fallback path described in step 2. Worst case: a user commit on the user side at the exact same moment means a later ff-merge fails with `non-ff` instead of silent sync — which surfaces the existing UI affordance, not a correctness bug.
- **Branch leakage on crash**: sandbox-view branches (`T-N-sandbox`) could accumulate if cleanup is skipped. Mitigation: `stopSandboxView` is best-effort idempotent; also add a startup-time sweep that removes `T-*-sandbox` branches with no matching active task.

## Out of scope (explicit)

- Per-task secret injection (e.g., sandbox-specific `.env`). Future follow-up.
- Guest egress firewall / network policy. Host↔guest *is* the boundary.
- Non-sandboxed task flow. `copyGitIgnoredFiles` keeps running for those.

## Rollback

Every commit is self-contained: boundary fixes (step 1), new sandboxSync module (step 2), mount-config rework (step 3), spawn rewrite (step 4), provision revert (step 5), UI wiring (step 6). Revert in reverse order if something regresses; the auth/env/symlink commits stand on their own and can ship independently.
