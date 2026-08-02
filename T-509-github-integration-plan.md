# T-509: GitHub integration

> Task prompt: "we should provide a codex level integration with github. something like
> letting tasks be linked directly to github issues and PRs, then powering a much richer
> pr review ux so you never need to go to github."

## Locked decisions

| Question | Decision |
| --- | --- |
| Depth | Full review, including submitting reviews |
| Auth | Shell out to `gh` entirely; no token ever stored or handled |
| Flows | Task to PR, auto-detect existing PR, issue to task, PR to task |
| Audience | Mine plus teammates' PRs, so an inbox is needed |
| Inbox surface | Project panel, gated behind an experimental flag like canvas |
| Reviewing a teammate's PR | Ephemeral session, with a "check out as task" promotion |
| Agent role | Human-only for this task |
| Diff source | Local git after fetching the PR ref (reasoning below) |

## Reference point

The Codex desktop app is the quality bar to match: a clean `gh` CLI integration powering a
local PR experience with diffs and bidirectional commenting. Its approach is also what
validates the auth decision here. Routing everything through `gh` is a proven way to get a
full local PR UX without inventing token storage.

## Diff source: why local git

`line` + `side` are not diff offsets. They are plain file line numbers in the head blob
(`RIGHT`) or the base blob (`LEFT`). GitHub computes its PR diff as `base...head`, which is
exactly what `git diff <baseSha>...<headSha>` computes. So the line numbers `parseDiff()`
already emits on every `DiffLine` *are* the GitHub anchors, provided we pin to the base and
head SHAs from the API rather than to branch names. The apparent "map hunk lines to
line+side" cost is mostly illusory.

Ephemeral review does not force the API path either: `git fetch origin pull/N/head` followed
by `git diff A...B` needs no checkout and no worktree, it reads from the object database.

The API path has a hard failure mode by contrast. Files past a size threshold and PRs past
3000 files have no `patch` field at all, and context can never be expanded beyond the hunk.
For a feature whose pitch is "never go to GitHub", "this file is too large to display" is
exactly the moment you go to GitHub.

Two qualifications:

1. This is not "no API". We still need it for the file list with rename statuses, the
   timeline, threads, and checks. API for metadata, git for bytes.
2. Fetch into a namespaced ref (`refs/ouijit/pr/<n>`) so it stays prunable and never
   pollutes the user's branch list.

## What already exists (and what does not)

**Already there, reusable:**

- A full local diff stack: `getWorktreeDiff` / `getWorktreeFileDiff` (three-dot merge-base
  diffs), `parseDiff()` producing typed `DiffHunk`/`DiffLine`, a file tree, Shiki
  highlighting, intra-line word diff, batched loading with a 300-file cap.
- A panel/tab system that grants session restore and CLI control to any new panel kind.
- `DialogOverlay` as a single dialog shell, plus context menus shared between the kanban
  card and the terminal header via `taskMenu.ts`.
- A `cli-change` push that refreshes the UI for free on any mutating REST route.
- A dead-but-wired IPC surface (`worktree:ship`, `worktree:merge`, `git-checkout`) with no
  renderer callers.

**Missing entirely:**

- Remote awareness. The app never reads `git remote`, so it cannot currently tell that a
  repo is on GitHub.
- Any `git fetch` or `git push`. The app is purely local today.
- Any secret storage. No `safeStorage`, no keytar, no keychain anywhere.
- Any GitHub client beyond the unauthenticated release check in `src/updater.ts:39`.
- Any list virtualization library.

---

## Layer 0: repo identity and availability

New `src/github/repoIdentity.ts`. `getRemoteUrl()` added to `git.ts`, plus a parser handling
`git@github.com:o/r.git`, `https://github.com/o/r.git`, and GHES hosts, returning
`{host, owner, repo}`. Cached per project alongside the existing main-branch cache, this
time with working invalidation (`invalidateMainBranchCache` currently has zero callers).

`healthCheck.ts` gains `gh --version` and an auth check, next to the existing `claude` /
`codex` / `pi` probes. The panel stays hidden when `gh` is missing or unauthenticated, with
the reason surfaced rather than a blank screen.

Flag: add `github: boolean` to `ExperimentalFlags` (`src/experimentalFlags.ts:10`) plus a
`ToggleRow` in `ExperimentalFeaturesSection.tsx`. Panel and polling stay dark until it is on.

## Layer 1: the gh client

`src/github/client.ts` wraps `execFile('gh', ['api', ...])` in the same idiom as `git.ts`,
with one REST helper and one GraphQL helper. GraphQL is unavoidable: resolve/unresolve
threads and `statusCheckRollup` have no REST equivalent. Error mapping for 401/403/404 and
rate limits, plus a concurrency cap so a busy inbox does not fork twenty processes.

`src/github/poller.ts` copies the `updater.ts` shape exactly: module-scope `setInterval`,
`initGithubPoller(mainWindow)` / `cleanupGithubPoller()` wired into `main.ts` next to
`initUpdater`, pushing a new `github:changed` channel on `IpcPushContract`. Paused when the
window is hidden, like the existing git-status refresher. Since we inherit the user's `gh`
rate limit, the interval is conservative, with manual refresh and refresh-on-focus as the
fast paths.

Webhooks are not an option: they need a public HTTPS endpoint, which conflicts with the
local-first posture. Conditional polling is the supported path.

## Layer 2: data model

Migration `014-add-task-github-link.ts` adds nullable `github_pr_number` and
`github_issue_number` to `tasks`. Threading a new task field is a known eight-file walk:

1. `TaskRow` (`src/db/repos/taskRepo.ts:5`)
2. `rowToTask` (`src/db/index.ts:91`), using `!= null` guards; the conditional-spread style
   there would silently drop a `0`
3. `TaskMetadata` (`src/db/index.ts:27`)
4. `TaskWithWorkspace` (`src/types.ts:329`)
5. + 6. Both hand-written mappers in `taskLifecycle.ts:281` and `:302`; missing one silently
   drops the field from either `getAll` or `getByNumber`
7. `scripts/dev-db.mjs:177` (hardcoded column list, already stale re: `sandboxed`)
8. `website/src/ouijit-ui/types.ts:22` (drifted copy)

Draft review comments get their own table. They must survive a restart or written work is
lost, and local drafts are preferable to creating a server-side PENDING review per keystroke.
On submit they go up as a single `POST /pulls/{n}/reviews` carrying the whole `comments[]`
array plus the event, which is atomic and sidesteps the secondary rate limiting GitHub warns
about for rapid comment writes.

## Layer 3: process boundary

`github:*` channels on `IpcInvokeContract`, handlers in `src/ipc/handlers/github.ts` via
`typedHandle`, registration in `register.ts`, a `github` namespace in `preload.ts`, and
matching additions to the renderer test `mockApi` (omitting that last one makes renderer
tests throw). REST routes marked `mutating` get a `cli-change` push for free. A small
`ouijit pr` command set (`list`, `view`, `link`) follows the `markdown.ts` template.

## Layer 4: UI

**The highest-leverage move here is a refactor, not new code.** `DiffPanel.tsx` is 683 lines
containing the file tree, sticky file headers, hunk and line renderers, and the token /
word-diff splicing. The PR files-changed view should extract and share those, not fork them,
or the two diff renderers drift within a release. Extraction into `src/components/diff/`
primitives is a prerequisite step, and the existing uncommitted/worktree diff view should be
switched onto the extracted pieces in the same pass so both paths stay exercised.

Then:

- `PullRequestsPanel` as a third `projectStore.activePanel` value, mounted in
  `ProjectViewReact.tsx` the same way `ProjectSettingsPanel` is.
- PR detail: overview and timeline, files changed, threads with reply and resolve, a review
  composer batching drafts into approve / request changes / comment, the check rollup, and
  merge with blockers surfaced before the button rather than after it.
- A PR badge slot on `KanbanCardView.tsx:278` styled after `KanbanBadgeView`. Add the field
  to the card memo fingerprint at `KanbanBoard.tsx:138` or cards will not re-render.
- Entry points via `taskMenu.ts` (appears on both card and terminal header at once) and the
  command palette.

No virtualization library exists in the project. Carry over `DiffPanel`'s existing batching
and 300-file cap rather than introducing one; revisit only if large PRs actually feel bad.

## Layer 5: the write paths

`git.ts` gains fetch and push, which it has never had.

- **Task to PR:** push plus `gh pr create`, hung off the existing `shipWorktree` seam
  (`worktree.ts:956`). Going through `gh pr create` rather than the raw API means PR
  templates and closing keywords (`Fixes #123`) apply as they should.
- **Auto-detect:** `gh pr list --head <branch>` when a task loads.
- **Issue to task:** create a task carrying the issue body into the description.
- **PR to task promotion:** create the task and worktree at the PR head with `mergeTarget`
  set to the PR base. Worth noting because today's `mergeTarget` means "whatever branch HEAD
  was on at task start", which is often not the PR base you want.
- **Merge:** `gh pr merge` with method selection and blockers surfaced up front.

---

## Risks, in the order to retire them

1. **Anchoring.** GitHub's reviews endpoint still documents `position` as required inside
   `comments[]` while also accepting `line`/`side`. Spike this against a throwaway PR before
   building the composer. It is the one thing that could invalidate the diff-source decision.
2. **Outdated threads.** When the head moves, existing comments carry `original_line` /
   `original_commit_id`. Decide early whether to render them as outdated in place or collapse.
3. **`gh` as a hard dependency**, including a version floor and the shared rate limit (5,000
   REST requests/hour, shared with every other tool using that user's token).
4. **Sandbox policy.** `GITHUB_TOKEN` is deliberately stripped from sandbox env
   (`src/lima/manager.ts:55`) and a test asserts it. Working assumption: all `gh` calls run
   on the host from the main process, and that policy is left untouched.
5. **Shallow and partial clones**, where fetching a PR ref is more expensive than expected.

## Explicitly out of scope

Agent participation of any kind. Webhooks. Cross-repo or org-wide inbox. Stacked PRs.

## Build sequence

1. Flag, repo identity, health check
2. `gh` client and the anchoring spike
3. `DiffPanel` extraction (and move the existing diff view onto it)
4. Read-only PR list and detail
5. Task linking and card badges
6. Write paths: create, comment, submit, merge
7. Issue to task, and PR to task promotion

## Gate

`npm run check` (tsc, eslint, prettier) plus `npm test`. Circular imports are a hard eslint
error, which constrains where new modules can live.
