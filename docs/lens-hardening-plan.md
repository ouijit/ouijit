# Lenses: production readiness

Remaining work for `feat(diffs): lenses` (T-560), landing on this branch.

The feature works. What follows is what stands between "works when you watch
it" and "works". Nothing here has shipped, so there is no stored data to
preserve and no contract to keep compatible: the schema this PR introduces
should be the one we want, and there is **one migration** — 015, amended in
place — rather than a stack of them.

Five stages. Identity comes first because the later ones add columns, and there
is no sense building them onto a shape that is about to change.

## What is stored, and how staleness is decided

One row per diff in `diff_lenses`, keyed `(project_path, subject_key)`, where
the key is `wt:<worktreePath>:<base>` or `pr:<number>`. The base is part of the
key, so `vs origin/main` and `Uncommitted changes` keep separate lenses of the
same worktree. One lens per subject; re-running overwrites.

Beside the groups sits a **pin**, which is the whole staleness model:

| Base | Pin | Reads |
| --- | --- | --- |
| a ref (`origin/main`) | `merge-base(base, branch)..rev-parse(branch)` | committed revisions only |
| uncommitted (`HEAD`/null) | `shape:<sha of status:path:+adds:-dels per file>` | the working tree |

What the panel displays is `git diff --numstat --merge-base <base>` — merge-base
through to the **working tree**, uncommitted changes included.

`origin/main` advancing is a non-event, and correctly so: three-dot semantics
mean unrelated commits change neither the diff nor the merge-base, so neither
the panel nor the pin moves. They part company on a rebase, where both move and
the mismatch is caught.

---

## Stage 1 — A lens is an id, not a name

A lens is currently keyed by the label the reader typed. Everything below
exists only to compensate for that, and all of it goes:

- the `lens:renamed` push and its contract entry
- `DiffLensRepo.rename` and `renameDiffLens`
- `previousName` threaded through `saveLens` and the IPC signature
- the rename handler in `useDiffLens.subscribe`
- half the picker's orphan handling, which is renamed-lens handling

With an id, a rename is an ordinary edit and the name on screen is looked up
fresh every time, so it is right the moment it changes with nothing broadcast.
It also closes the race where renaming a lens mid-run saves the finished
grouping under the name it used to have.

- [ ] `LensSummary` gains `id`. Lenses live as a JSON array in `global_settings`
      under `github:lenses:<path>`, so there is no schema for the list —
      `parseLenses` backfills an id for any entry without one and writes back,
      which covers the dev databases that already have lenses in them.
- [ ] `lens:save` takes a lens whose absent id means create; `lens:delete` takes
      an id. `resolveLensRun`, `writeLens` and `github:run-lens` follow.
- [ ] `diff_lenses` stores **both** `lens_id` and `lens_name`. Not two
      identities: the id is the key, the name is a snapshot for display when the
      lens has since been deleted and there is nothing left to look up. The
      picker prefers the current name by id and falls back to the snapshot.
- [ ] `previousName` currently doubles as the create-vs-edit signal for
      `onCreated`. That becomes "did it arrive with an id".
- [ ] Amend migration 015 in place: `lens_id`, `lens_name`, and the run columns
      from Stage 3. Do not add a 016.

**Files** `lens/config.ts`, `lens/writeLens.ts`, `lens/readLens.ts`,
`db/repos/diffLensRepo.ts`, `db/migrations/015-diff-lenses.ts`, `db/database.ts`,
`ipc/contract.ts`, `ipc/handlers/diffPanel.ts`, `github/service.ts`, `preload.ts`,
`types.ts`, `LensPicker.tsx`, `LensList.tsx`, `useDiffLens.ts`, `useLensSession.ts`.

**Tests** the rename test becomes a test that renaming changes the name on
screen and breaks nothing, with no push involved. `lens:list-changed` stays and
still covers add and delete.

---

## Stage 2 — Freshness stops lying

Two bugs, one symptom: the badge reports fresh when it is not.

- [ ] **The pin ignores the working tree.** `pinFor` (`src/lens/worktreeSubject.ts:50`)
      short-circuits to committed revisions for a ref base, while the panel shows
      uncommitted changes. Combine them: `<revisions>+shape:<…>`, so both branches
      of the pin read the working tree.
- [ ] **Staleness is computed once per mount.** `useDiffLens` passes no `revision`
      to `useLensSession`. `filesFingerprint` already exists at `DiffPanel.tsx:76`
      and every other consumer keys off it — notes, analysis signals, the batched
      loader. The lens is the one holdout.

**Cost to weigh on the pin.** `readLens` calls `subject.pin()` on every read, and
a shape needs a full `getGitFileStatus` including `countUntracked`, which reads
every untracked file. Today the ref-base path is two cheap git calls. The
alternative is passing the panel's `filesFingerprint` down through
`DiffLensTarget` so main compares against what is on screen rather than
re-polling — cheaper and strictly more correct, but the renderer truncates to
`MAX_DIFF_FILES` and main does not, so the two shapes have to be made to agree
or the pin never matches. Take the simple version first.

**Two traps in the `revision` one-liner.** The effect at `useLensSession.ts:131`
does `setLens(null); setChosen(null)` before refreshing. Firing that on every
diff change would snap the reader back to the lens after they chose All files,
and would blank the grouping and redraw it on every keystroke-triggered poll.
The reset belongs to `key` changes only; `revision` needs a second effect that
re-reads without clearing. It also wants throttling — every save moves the
fingerprint, and each re-read spawns `merge-base`, `rev-parse` and a status poll.

**Files** `lens/worktreeSubject.ts`, `components/diff/useLensSession.ts`,
`useDiffLens.ts`, `DiffPanel.tsx`.

**Tests** integration against a real repo: write a lens, edit a file, assert the
read comes back stale. Renderer: a diff change re-reads without discarding an
explicit All-files choice.

---

## Stage 3 — A run is never lost

Nothing is written until the agent returns, so a quit, a crash or a renderer
reload mid-run is indistinguishable from never having tried. The in-flight map
is renderer memory.

- [ ] Record the attempt before spawning, in the `running_lens_id` /
      `running_since` columns added in Stage 1 — beside the groups, not over
      them, so an interrupted run does not destroy a good existing lens.
- [ ] Report in-flight runs from main, so `useLensSession` seeds its map from
      the truth rather than from renderer memory. A reload stops losing the
      spinner.
- [ ] Treat any row still marked running at startup as interrupted: a picker
      row that says so and offers to run it again.
- [ ] Kill the child on `will-quit` (`src/main.ts:385`) rather than orphan it.

**Files** `db/repos/diffLensRepo.ts`, `lens/writeLens.ts`, `lens/runLens.ts`,
`ipc/handlers/diffPanel.ts`, `useLensSession.ts`, `LensPicker.tsx`, `main.ts`.

**Tests** unit on the repo — a run marker does not clobber the stored grouping.
Renderer — the interrupted row appears and re-runs.

---

## Stage 4 — Say what happened

All of it lands on the picker row, which is already the one control that says
what is on screen and how fresh it is.

- [ ] **Coverage, computed at render.** `resolveLens` re-binds the stored groups
      to the current diff on every render, so the facts are free and continuous:
      hunks claimed, hunks claimed twice (breaking the show-once invariant),
      files claimed by nobody, ranges matching no hunk. Surface as
      `4 parts · 2 files not grouped`. Deliberately not a post-run verification
      stamp — that is true for one instant and then becomes the same class of
      bug as the pin.
- [ ] **Truncation.** `buildLensPrompt` already computes `omitted`; it tells the
      agent and not the reader. Store it with the lens and show it on the row. A
      lens grouped from line spans instead of code should say so rather than
      merely seeming mediocre.
- [ ] **Size before a run.** Estimated from the `additions`/`deletions` the
      status poll already returns — no git spawns. Shown as `~26k tk` in the
      row's tooltip, beside the instruction, rather than taking width on the row.
      Output is bounded by the schema to a few hundred tokens and is not worth
      estimating. When the change will not fit the budget, the row itself says
      so: that is the part that changes what the reader would do.
- [ ] **Push when a worktree lens lands.** `diff-lens:run` pushes nothing and
      `useDiffLens.subscribe` listens only for renames — and after Stage 1 it
      listens for nothing at all. A CLI-written lens or a post-reload landing is
      invisible until remount. Mirror `github:lens-changed`.

**Files** `lens/lens.ts`, `LensPicker.tsx`, `DiffPanel.tsx`, `lens/lensPrompt.ts`,
`ipc/contract.ts`, `ipc/handlers/diffPanel.ts`, `useDiffLens.ts`.

---

## Stage 5 — Housekeeping

- [ ] **Collect rows.** `worktree:remove` (`src/ipc/handlers/worktree.ts:23`)
      should drop the `wt:<path>:*` rows. Not merely tidiness: a reused worktree
      path inherits a grouping written for a different change, and worktree
      staleness renders rather than drops, so it will draw it.
- [ ] **Detached HEAD.** `getBranchDiffPin` runs `rev-parse <branch>` in the
      project checkout, so a detached worktree pins the main checkout's HEAD.
      Run it against the worktree with `HEAD`.

---

## Not covered here

None of the visual work on this branch has been seen in a real window; the
renderer tests run under jsdom, which has no layout engine. Driving e2e to the
Lenses dialog needs a project with a PR or a worktree diff, and the e2e fixtures
create a bare repo. Stage 4 adds the most to the picker, so the scaffolding
belongs there if it is wanted.
