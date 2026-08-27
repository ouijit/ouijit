# Lenses: production readiness

Follow-up work for `feat(diffs): lenses` (T-560), landing on this branch.

The feature works. What follows is what stands between "works when you watch
it" and "works". Four stages, each independently shippable and testable,
ordered so the correctness bugs land before the reporting built on top of them
— a coverage figure computed over a lying freshness flag is worse than no
figure at all.

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

## Stage 1 — Freshness stops lying

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

## Stage 2 — A run is never lost

Nothing is written until the agent returns, so a quit, a crash or a renderer
reload mid-run is indistinguishable from never having tried. The in-flight map
is renderer memory.

- [ ] Record the attempt before spawning — as `running_lens` / `running_since`
      columns beside the groups (migration 016), not by overwriting the row,
      which would destroy a good existing lens.
- [ ] Report in-flight runs from main, so `useLensSession` seeds its map from
      the truth rather than from renderer memory. A reload stops losing the
      spinner.
- [ ] Treat any row still marked running at startup as interrupted: a picker
      row that says so and offers to run it again.
- [ ] Kill the child on `will-quit` (`src/main.ts:385`) rather than orphan it.

**Files** new migration, `db/repos/diffLensRepo.ts`, `lens/writeLens.ts`,
`lens/runLens.ts`, `ipc/handlers/diffPanel.ts`, `useLensSession.ts`,
`LensPicker.tsx`, `main.ts`.

**Tests** unit on the repo — a run marker does not clobber the stored grouping.
Renderer — the interrupted row appears and re-runs.

---

## Stage 3 — Say what happened

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
      agent and not the reader. Store it with the lens and show it. A lens
      grouped from line spans instead of code should say so rather than merely
      seeming mediocre.
- [ ] **Token estimate before a run.** Cheap and renderer-side, from the
      `additions`/`deletions` the status poll already returns — no git spawns.
      Output is bounded by the schema to a few hundred tokens and is not worth
      estimating. Lead with what the number implies (`too big to send whole`).
- [ ] **Push when a worktree lens lands.** `diff-lens:run` pushes nothing and
      `useDiffLens.subscribe` listens only for renames, so a CLI-written lens or
      a post-reload landing is invisible until remount. Mirror
      `github:lens-changed`.

**Files** `lens/lens.ts`, `LensPicker.tsx`, `DiffPanel.tsx`, `lens/lensPrompt.ts`,
`ipc/contract.ts`, `ipc/handlers/diffPanel.ts`, `useDiffLens.ts`.

---

## Stage 4 — Housekeeping

- [ ] **Collect rows.** `worktree:remove` (`src/ipc/handlers/worktree.ts:23`)
      should drop the `wt:<path>:*` rows. Not merely tidiness: a reused worktree
      path inherits a grouping written for a different change, and worktree
      staleness renders rather than drops, so it will draw it.
- [ ] **Detached HEAD.** `getBranchDiffPin` runs `rev-parse <branch>` in the
      project checkout, so a detached worktree pins the main checkout's HEAD.
      Run it against the worktree with `HEAD`.
- [ ] **Rename during a run** loses the new name for that row: `writeLens`
      captures the name at the start and saves it after. The honest fix is a
      stable lens id rather than a name as the key, which is a larger change
      than the race deserves. Left open on purpose.

---

## Open decisions

- **Raw token count on the row, or only the too-big warning?** There is a real
  argument for the number that is not about cost — how much of the repository is
  about to leave the machine — but on a subscription a bare token count reads as
  a price, which is the confusion already removed once.
- **Is the rename race worth a lens id?**

## Not covered here

None of the visual work on this branch has been seen in a real window; the
renderer tests run under jsdom, which has no layout engine. Driving e2e to the
Lenses dialog needs a project with a PR or a worktree diff, and the e2e fixtures
create a bare repo. Stage 3 adds the most to the picker, so the scaffolding
belongs there if it is wanted.
