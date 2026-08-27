# Lenses: production readiness

Remaining work for `feat(diffs): lenses` (T-560), landing on this branch.

Nothing has shipped, so there is no stored data to preserve and no contract to
keep compatible. The schema this PR introduces should be the one we want:
**one migration**, 015, amended in place.

Five stages. Identity first, because the later stages add columns and there is
no sense building them onto a shape that is about to change.

## What is stored, and how staleness is decided

One row per diff in `diff_lenses`, keyed `(project_path, subject_key)`, where
the key is `wt:<worktreePath>:<base>` or `pr:<number>`. The base is part of the
key, so `vs origin/main` and `Uncommitted changes` keep separate lenses of the
same worktree. One lens per subject; re-running overwrites.

Beside the groups sits a **pin**, which decides staleness:

| Base | Pin | Reads |
| --- | --- | --- |
| a ref (`origin/main`) | `merge-base(base, branch)..rev-parse(branch)` | committed revisions only |
| uncommitted (`HEAD`/null) | `shape:<sha of status:path:+adds:-dels per file>` | the working tree |

The panel displays `git diff --numstat --merge-base <base>` — merge-base through
to the working tree, uncommitted changes included.

`origin/main` advancing changes neither the diff nor the merge-base, so neither
the panel nor the pin moves. They part company on a rebase, where both move and
the mismatch is caught.

## Where the coverage gap is

There is no lens test against a real git repo. `readLens.test.ts` mocks `../db`
and hands `readLens` a fake `DiffSubject`, so `pinFor` has never run against
real refs — which is why Stage 2's bug survived. Every stage below says what it
owes the `integration` project.

Per the repo's test rules: no test for the migration itself; cover
migration-backed behaviour where it is used. Mock only at the spawned agent
boundary. `npm test` and `npm run test:e2e` rebuild better-sqlite3 for different
ABIs, so run them separately.

---

## Stage 1 — A lens is an id, not a name

A lens is keyed by the label the reader typed. Everything below exists only to
compensate for that, and goes with the change:

- the `lens:renamed` push and its contract entry
- `DiffLensRepo.rename` and `renameDiffLens`
- `previousName` threaded through `saveLens` and the IPC signature
- the rename handler in `useDiffLens.subscribe`
- the renamed-lens half of the picker's orphan handling

With an id, a rename is an ordinary edit and the displayed name is looked up
fresh, so it is right the moment it changes with nothing broadcast. It also
closes the race where renaming mid-run saves the finished grouping under the
old name.

- [x] `LensSummary` gains `id`. Lenses are a JSON array in `global_settings`
      under `github:lenses:<path>`, so there is no schema for the list —
      `parseLenses` backfills an id for any entry without one and writes back,
      which covers dev databases that already hold lenses.
- [x] `lens:save` takes a lens whose absent id means create; `lens:delete` takes
      an id. `resolveLensRun`, `writeLens` and `github:run-lens` follow.
- [x] `diff_lenses` stores both `lens_id` and `lens_name`. The id is the key;
      the name is a snapshot for display when the lens has since been deleted
      and there is nothing left to look up. The picker prefers the current name
      by id and falls back to the snapshot. Both stay nullable — a grouping
      posted by an agent through the CLI has neither.
- [x] `previousName` currently doubles as the create-vs-edit signal for
      `onCreated`. That becomes "did it arrive with an id".
- [x] Amend migration 015 in place: `lens_id` and `lens_name` here, the run
      columns when Stage 3 needs them. One migration either way.

**Tests**

- [x] integration — `saveLens` backfills ids for stored entries that lack one,
      and a rename keeps both the id and the lens's place in the list. Real
      database under a tmpdir, since this is `global_settings` round-tripping.
- [x] renderer — renaming a lens changes the name shown against a grouping it
      already wrote, with no push involved. This replaces `pullRequestLens`'s
      "renaming a lens carries the reading it has already done".
- [x] `lensBroadcasts.test.ts` loses its `lens:renamed` cases and keeps
      `lens:list-changed`, which still covers add and delete.

**Files** `lens/config.ts`, `lens/writeLens.ts`, `lens/readLens.ts`,
`db/repos/diffLensRepo.ts`, `db/migrations/015-diff-lenses.ts`, `db/database.ts`,
`ipc/contract.ts`, `ipc/handlers/diffPanel.ts`, `github/service.ts`, `preload.ts`,
`types.ts`, `LensPicker.tsx`, `LensList.tsx`, `useDiffLens.ts`, `useLensSession.ts`.

---

## Stage 2 — Freshness stops lying

Two bugs, one symptom: the badge reports fresh when it is not.

- [ ] **The pin ignores the working tree.** `pinFor`
      (`src/lens/worktreeSubject.ts:50`) returns committed revisions for a ref
      base, while the panel shows uncommitted changes. Combine them:
      `<revisions>+shape:<…>`, so both branches of the pin read the working tree.
- [ ] **Staleness is computed once per mount.** `useDiffLens` passes no
      `revision` to `useLensSession`. `filesFingerprint` already exists at
      `DiffPanel.tsx:76` and every other consumer keys off it — notes, analysis
      signals, the batched loader. The lens is the one holdout.

**Cost to weigh on the pin.** `readLens` calls `subject.pin()` on every read,
and a shape needs a full `getGitFileStatus` including `countUntracked`, which
reads every untracked file. Today the ref-base path is two cheap git calls. The
alternative is passing the panel's `filesFingerprint` down through
`DiffLensTarget` so main compares against what is on screen instead of
re-polling — cheaper and more correct, but the renderer truncates to
`MAX_DIFF_FILES` and main does not, so the two shapes must be made to agree or
the pin never matches. Take the simple version first.

**Two traps in the `revision` change.** The effect at `useLensSession.ts:131`
does `setLens(null); setChosen(null)` before refreshing. Firing that on every
diff change would snap the reader back to the lens after they chose All files,
and would blank the grouping and redraw it on every keystroke-driven poll. The
reset belongs to `key` changes only; `revision` needs a second effect that
re-reads without clearing. It also wants throttling — every save moves the
fingerprint, and each re-read spawns `merge-base`, `rev-parse` and a status poll.

**Tests**

- [ ] integration, new file — real repo, real database. Write a lens against a
      ref base, then: edit a tracked file and read back stale; commit and read
      back stale; land an unrelated commit on the base and read back **fresh**.
      That last case is the one that pins `--merge-base` semantics, so a later
      change to how the diff is taken cannot silently break the model.
- [ ] renderer — a revision change re-reads without discarding an explicit
      All-files choice, and without blanking the grouping in between.
- [ ] `readLens.test.ts` keeps its job: the `whenStale` contract, `drop` versus
      `render`. It is no longer the only thing covering the pin.

**Files** `lens/worktreeSubject.ts`, `components/diff/useLensSession.ts`,
`useDiffLens.ts`, `DiffPanel.tsx`.

---

## Stage 3 — A run is never lost

Nothing is written until the agent returns, so a quit, a crash or a renderer
reload mid-run is indistinguishable from never having tried. The in-flight map
is renderer memory.

- [ ] Record the attempt before spawning, in `running_lens_id` /
      `running_since` — beside the groups, not over them,
      so an interrupted run does not destroy a good existing lens.
- [ ] Report in-flight runs from main, so `useLensSession` seeds its map from
      the truth rather than from renderer memory. A reload stops losing the
      spinner.
- [ ] Treat a row still marked running at startup as interrupted: a picker row
      that says so and offers to run it again.
- [ ] Kill the child on `will-quit` (`src/main.ts:385`) rather than orphan it.

**Tests**

- [ ] integration — `writeLens` marks the row running before the agent answers
      and clears it after, and a run that fails leaves the previous grouping
      intact. The agent is the one thing stubbed, at the spawn boundary.
- [ ] renderer — the interrupted row appears for a stored run marker and
      re-running clears it.

**Files** `db/repos/diffLensRepo.ts`, `lens/writeLens.ts`, `lens/runLens.ts`,
`ipc/handlers/diffPanel.ts`, `useLensSession.ts`, `LensPicker.tsx`, `main.ts`.

---

## Stage 4 — Say what happened

All of it lands on the picker row, which already says what is on screen and how
fresh it is.

- [ ] **Coverage.** `resolveLens` binds the stored groups to the diff whenever
      either moves, so the facts are free: hunks claimed, hunks claimed twice
      (breaking the show-once invariant), files claimed by nobody, ranges
      matching no hunk. Surface as `4 parts · 2 files not grouped`. Not a
      post-run verification stamp — that is true for one instant and then
      becomes the same class of bug as the pin.
- [ ] **Truncation.** `buildLensPrompt` computes `omitted` and tells the agent,
      not the reader. Store it with the lens and show it on the row, so a lens
      grouped from line spans instead of code says so.
- [ ] **Size before a run.** Estimated from the `additions`/`deletions` the
      status poll already returns — no git spawns. `~26k tk` in the row's
      tooltip, beside the instruction. Output is bounded by the schema and is
      not worth estimating. When the change will not fit the budget the row
      itself says so: that is the part that changes what the reader would do.
- [ ] **Push when a worktree lens lands.** `diff-lens:run` pushes nothing, and
      after Stage 1 `useDiffLens.subscribe` listens for nothing at all. A
      CLI-written lens or a post-reload landing is invisible until remount.
      Mirror `github:lens-changed`.

**Tests**

- [ ] unit — the coverage counts, including a hunk claimed by two groups and a
      range matching none. Pure function over resolved groups, so no fixtures.
- [ ] renderer — the tooltip carries the size, and the row says too-big when the
      estimate is over `LENS_PROMPT_BUDGET`.
- [ ] renderer — a lens landing from outside the pane appears without a remount.

**Files** `lens/lens.ts`, `LensPicker.tsx`, `DiffPanel.tsx`, `lens/lensPrompt.ts`,
`ipc/contract.ts`, `ipc/handlers/diffPanel.ts`, `useDiffLens.ts`.

---

## Stage 5 — Housekeeping

- [ ] **Collect rows.** `worktree:remove` (`src/ipc/handlers/worktree.ts:23`)
      should drop the `wt:<path>:*` rows. A reused worktree path otherwise
      inherits a grouping written for a different change, and worktree staleness
      renders rather than drops, so it will draw it.
- [ ] **Detached HEAD.** `getBranchDiffPin` runs `rev-parse <branch>` in the
      project checkout, so a detached worktree pins the main checkout's HEAD.
      Run it against the worktree with `HEAD`.

**Tests**

- [ ] integration — removing a worktree drops its lens rows and leaves other
      subjects alone; a detached worktree pins its own HEAD.

---

## Validating the parts tests cannot reach

Nothing on this branch has been seen in a real window. The renderer tests run
under jsdom, which has no layout engine, so the picker's ledge alignment, the
suggestion pills and the tooltip are unverified.

- [ ] e2e — seed a `diff_lenses` row in the fixture's userData database and
      assert the diff renders chaptered, with the rail and document agreeing.
      This covers the visual half without spawning an agent, which e2e cannot do.
- [ ] `createTestRepo` (`e2e/fixtures.ts:11`) makes a repo with a single commit
      on the default branch. A lens needs a second branch with divergence from a
      base, so the fixture needs extending before the above is possible.
