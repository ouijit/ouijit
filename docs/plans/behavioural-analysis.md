# Behavioural analysis

Implementation plan for T-553: mine each project's git history with the
algorithms from Adam Tornhill's *Your Code as a Crime Scene* and surface the
results where review decisions happen — the diff panel and the PR viewer.

The premise of the book is that version history is behavioural data: where a
codebase changes tells you more about risk than what the code looks like. For
Ouijit this is a natural fit — agents produce a steady stream of diffs, and the
human's job is deciding where to look hard. Behavioural signals answer that:
"this file is a hotspot", "these two files always change together and one is
missing", "nobody but Alice has ever touched this".

## The analyses

Everything below derives from one `git log` pass. No language parsing.

**Hotspots.** Change frequency (commits touching a file) × a complexity proxy.
The proxy is current line count plus indentation-based complexity (sum and
max of leading-whitespace depth) — Tornhill's language-neutral trick, cheap
enough to compute for every file that matters. A file that is both complicated
and frequently edited is where defects live.

**Change coupling.** Files that appear in the same commits. For a pair,
`degree = shared / max(commits(a), commits(b))`. High-degree pairs that aren't
imports of each other reveal hidden dependencies — and a diff that touches one
side but not the other is the classic "you forgot the other half" review
catch.

**Knowledge map / ownership.** Per file, commits and added lines per author.
Yields a main author, an ownership fraction, and a fragmentation signal (many
minor contributors). Feeds the PR view: a change to a file the PR author has
never touched, in a hotspot, deserves a closer read.

**Churn and age.** Added/deleted totals and first/last commit dates fall out
of the same pass. Age is a stability signal: old untouched code is usually
fine; a hotspot's recency is what makes it hot.

Deferred (see "Later"): complexity trends over a file's history, function-level
X-Ray, and any treemap/enclosure visualization.

## Data pipeline

This is the first `git log` consumer in the app, so the ingest is a new
main-process module rather than an addition to `src/git.ts`.

One spawn per (re)scan, via `gitAsync` (`src/git.ts:932`):

```
git log <range> --no-merges --numstat --date=unix \
  --format=%x01%H%x02%at%x02%aE%x02%aN
```

- **Range and caps.** Default: commits reachable from the project's merge
  target (`getMainBranchAsync`), limited to the last 12 months and 5,000
  commits, whichever is smaller. `maxBuffer` sized like the existing 10MB
  precedent (`src/git.ts:400`), raised if a scan proves it necessary.
- **Renames.** `--numstat` reports `old => new` (and the `{dir => dir}` infix
  form). The parser resolves both and migrates a path's accumulated stats
  forward, so history follows the file without per-file `--follow` spawns.
- **Binary files** report `-  -` in numstat: counted for frequency and
  coupling, zero churn.
- **Coupling cap.** Commits touching more than 50 files are counted for
  frequency but excluded from coupling — bulk renames and format-everything
  commits would otherwise couple the whole repo (standard crime-scene
  practice). Only pairs with ≥ 3 shared commits are kept.
- **Complexity pass.** After the log pass, read the working tree for the top
  ~200 files by frequency (batch of 16, like the untracked-file reads at
  `src/git.ts:984`) and compute LOC + indentation complexity. Files without a
  complexity read stay quiet — a hotspot must be frequent AND complicated.
  Machine-written files (lockfiles) are skipped here so they can't top the
  hotspot list, but keep their coupling: "usually changes with
  package-lock.json" is a real reminder.
- **Incremental refresh.** The cache keeps the last analyzed SHA. A refresh
  scans `last..HEAD` and folds the new commits in. If `last` is no longer
  reachable (rebase, force-push, history rewrite), fall back to a full rescan.
  The cheap gate — `rev-parse` on the merge target vs cached SHA — is what the
  periodic poll actually runs; the log pass only fires when the SHA moved.

Identity is author email; display name kept alongside.

## Caching, not storage

Nothing is persisted. The result is a pure derivation of git history — a
cache, not a source of truth — and rebuilding it is one git spawn: this
repo's full 12-month window is 513 commits, 3,774 numstat rows, 730 unique
paths, ~145KB of log output, well under a second end to end. Persisting it
would cost a migration, repos, seed updates, and staleness-vs-repo edge cases
to buy back a sub-second scan per project per app launch.

So the model lives in the main process, one entry per project path:

```
ProjectAnalysis {
  ref, lastSha, analyzedAt, commitCount
  files:     Map<path, { commits, added, deleted, firstAt, lastAt,
                         loc?, indentTotal?, indentMax? }>
  authors:   Map<path, Map<email, { name, commits, added }>>
  couplings: Map<pairKey, shared>        // only pairs ≥ 3 shared commits
}
```

Held in `src/analysis/service.ts` with the memo + in-flight-dedupe shape of
`getMainBranchAsync` (`src/git.ts:301-329`): computed lazily on the first
signals request, refreshed incrementally behind the SHA gate, dropped when
the project is removed. A restart just rescans. If a pathological monorepo
ever makes the scan hurt, persistence can be added behind the same IPC
surface — nothing above it would change.

## Analysis engine

New directory `src/analysis/` (main process):

- `gitLog.ts` — spawn + parser (`%x01`/`%x02` framing, numstat, renames).
- `accumulate.ts` — pure fold: parsed commits → file stats, author stats,
  coupling pairs. This is where the caps live, and it's the unit-test surface.
- `complexity.ts` — LOC + indentation metrics for a file's text.
- `score.ts` — percentile ranks within the project for frequency and
  complexity; hotspot score = geometric mean of the two ranks; tiers
  (`quiet` / `warm` / `hot`) at fixed rank cutoffs so the UI shows discrete
  chips, not raw numbers.
- `service.ts` — orchestration: cheap-gate refresh with the rate-limit +
  in-flight-dedupe scaffold from `src/github/service.ts:326` (`MIN_INTERVAL`,
  `inFlight` map), reads for the IPC handlers.

Refresh is driven by the existing visibility-aware project interval
(`ProjectViewReact.tsx:277`), gated on the experimental flag exactly like the
PR sweep — the renderer pokes `analysis:refresh`, the service decides whether
anything actually runs.

## IPC, store, gating

Contract entries in `src/ipc/contract.ts`, handlers in
`src/ipc/handlers/analysis.ts`, `registerAnalysisHandlers()` in
`src/ipc/register.ts`, an `analysis:` namespace on `window.api` in
`src/preload.ts` + `ElectronAPI` in `src/types.ts`:

- `analysis:refresh (projectPath) → { analyzedAt, commitCount, lastSha } | null`
  — dedup/rate-limit inside.
- `analysis:diff-signals (projectPath, paths[]) →`
  `{ files: Record<path, { tier, score, commits, mainAuthor, ownership }>,`
  `  couplings: Array<{ path, partner, shared, degree }> }`
  — everything the diff and PR surfaces need for one file list, in one call.
  Coupling rows are returned for pairs where at least one side is in `paths`;
  the caller decides what "partner missing from this diff" means.
- `analysis:overview (projectPath) → { hotspots, couplings, owners }` — top-N
  lists for the panel phase.

Renderer state: `src/stores/analysisStore.ts` modelled on `githubStore` —
signals cached per `projectPath + diffShape(files)` fingerprint, `{data,
loading, error}` triad, no persist middleware.

Gating: a new `analysis` key in `ExperimentalFlags`
(`src/experimentalFlags.ts`), defaulting off, with a toggle in
`ExperimentalFeaturesSection.tsx` labelled "Behavioural analysis". Main-side
reads gate the service like `isGithubEnabled()` does.

## Diff panel tie-ins

The extension slots already exist; `DiffPanel` just starts using them.

- **File header chip** — `DiffFileSectionProps.headerRight`
  (`DiffFileSection.tsx:105`). A small tier chip for `warm`/`hot` files
  (nothing for `quiet` — most files stay unadorned). Tooltip carries the
  numbers: commits in window, main author, score. Follow the rename-chip
  precedent (`FilesSection.tsx:91`) — memoized, built only when there's
  something to show.
- **File tree dot** — `DiffFileTreeProps.renderFileTrailing`
  (`DiffFileTree.tsx:90`), currently unused by `DiffPanel`. A muted dot for
  hot files so the rail shows the diff's risk shape at a glance.
- **Missing-partner hint** — from `couplings`, pairs above degree 0.5 whose
  partner is not in the diff. Rendered in the hot file's header tooltip and
  aggregated in the header ledge (`DiffPanel.tsx:260`) as a single quiet line
  ("2 files usually change with files not in this diff"). No islands, no
  banners.

`DiffPanel` fetches signals once per `filesFingerprint` (the discipline at
`DiffPanel.tsx:63` — status polls must not refetch), through the store. Chips
render only when the flag is on and signals have arrived; the diff never waits
on analysis.

## PR viewer tie-ins

The PR view composes the same diff primitives, so the header chip and rail dot
come for free once `FilesSection` and `PullRequestRail` pass the same slots
(`FilesSection.tsx:122`, `PullRequestRail.tsx:29`). PR file paths are
repo-relative and diffed from local refs (`prDiff.ts`), so they hit the same
analysis cache.

PR-specific additions:

- **Risk section in the summary** — a `Section` in `SummaryPane.tsx` beside
  Checks, built from `Fact` rows (`Sections.tsx`): hotspot files touched,
  coupled files missing from the PR, and files where the PR author has no
  commit history but a strong owner exists ("Most edits by …"). Facts only,
  no verdict — the copy names the observation and stops.
- **Freshness** — signals key on the same store as the rest of the PR detail
  and reload with it; nothing polls.

## Testing

Per the house style: few comprehensive tests, real boundaries.

- Unit: the log parser (rename forms, binary numstat, `%x01` framing),
  `accumulate` (coupling caps, rename carry-forward), `score` (ranks, tiers).
- Integration (`src/__tests__/integration/`, temp-repo pattern from
  `diffAgainstBase.test.ts`): scripted commits → full scan → expected model;
  one more commit → incremental fold matches a fresh full scan; rebase →
  full-rescan fallback.
- Renderer: chip + missing-partner rendering through the existing
  `diffFileSection.test.tsx` approach.

## Phases

1. **Engine** — `src/analysis/` with its in-memory cache, IPC, store,
   experimental flag. Ship dark. (The bulk of the work.)
2. **Diff panel** — header chips, rail dots, missing-partner hint.
3. **PR viewer** — slots wired, Risk section in the summary.
4. **Analysis panel** — a project-level view (`analysis:overview`): ranked
   hotspot list with inline CSS bars, coupling pairs, ownership. There is no
   charting dependency and none gets added; bars and sparklines are CSS/SVG
   against the theme tokens (`--color-vcs-*`, ANSI palette).

## Later

- Complexity trends (per-file history sampling — needs per-file `git show`
  batches; only worth it on demand from the panel).
- Function-level X-Ray of a single hotspot.
- CLI/REST surface (`ouijit analysis hotspots`, routes in `src/api/router.ts`)
  so agents can read the same signals a reviewer sees.
- Team-level knowledge loss (departed-author detection needs configuration;
  out of scope until asked for).
