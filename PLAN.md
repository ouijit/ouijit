# T-416 — Done task UX

## Problem

Marking a task done behaves differently depending on where you trigger it:

| Path | Confirm close terminals? | Done hook fires? |
|---|---|---|
| Kanban drag to done | no (pre-PR) / yes (today) | yes |
| Terminal "Close Task" menu | yes (if other terminals) | no |
| CLI `set-status done` | no | no |

Three entry points, three different behaviors. The original task ticket framed it as "shared code path to normalize" — that's the spirit, but the right answer is broader than just sharing a confirmation dialog. Done is a *lifecycle event* (terminal cleanup + hook execution + status write); only the kanban path treats it that way. The principled fix is to make done a first-class operation that all three paths funnel into.

## Design

### One operation, three entry points

```
completeTask(projectPath, taskNumber, { skipHook?, hookCommand? })
```

All three entry points call it:
- Kanban drop into done column
- Terminal context menu "Close Task"
- CLI `ouijit task set-status <n> done`

Steps inside, every time:
1. Snapshot the task's existing terminals
2. If a done hook is configured and not skipped, spawn the hook terminal
3. Close the snapshotted terminals (the new hook terminal is excluded by construction)
4. Write status to done

### No confirmation dialog for terminal closure

Terminals are task-scoped (`findOtherTaskTerminals` filters by `taskId`). When a task is done, its terminals are done. There's no real choice to surface, so no dialog. The CloseTaskDialog I added earlier in this PR is retired.

Failure visibility is the safety net. The system tells you loudly when something goes wrong (error status, see below) instead of asking you to predict every action.

### No RunHookDialog for done

Start/continue/review hooks are interactive — users edit them per-task before running. The dialog's editable command field is the affordance. Done hooks are configured automation (lint/deploy/notify); editing per-invocation isn't a real workflow. So done skips the dialog and just runs. UI affordance to skip *for one transition* is a modifier-key drag (alt-drag).

RunHookDialog stays for start/continue/review.

### Done hook terminal self-tidies

- Exits 0 → header flips to **success** state → terminal closes after a short grace period
- Exits non-zero → header flips to **error** state → stays open until user dismisses

Only the done hook tidies itself. Start/continue/review terminals are interactive sessions and never auto-close.

### Error becomes a first-class terminal status

Current model: `idle` (green) / `thinking` (purple). New: also `success` and `error`. This is the visibility mechanism that makes "auto-close on success, keep on failure" legible — without it, silent closure of a failed deploy is dangerous.

This status surfacing applies to all terminals whose underlying command exits, not just done hooks. (Adjacent feature ask: users want error visibility on any terminal.)

### CLI flags

Mirror the available decisions. No flag for "run hook" because that's the default.

- `--skip-hook` — skip the configured done hook for this transition
- `--hook-command "<cmd>"` — run a different command instead
- (Mutually exclusive)

Reuses `task start`'s flag vocabulary so users don't learn a new dialect.

## Implementation tasks

Tracked in ouijit: #14, #15, #16, #17, #18, #19, #20.

1. **#14** Build unified `completeTask` lifecycle (`src/services/taskCompletion.ts` extended, or a new module).
2. **#15** Route all three entry points through it (KanbanBoard drag handler, TerminalHeader Close Task menu, CLI/API path).
3. **#16** Add `success` / `error` to the terminal status model — extend `displayState`, push from PTY exit codes, render in `TerminalHeader`.
4. **#17** Done hook terminal lifecycle: hook process exit → status update → grace-period close on success.
5. **#18** Remove the done branch from RunHookDialog's caller (kanban drop into done no longer enqueues a hook prompt). Confirm start/continue/review paths are untouched.
6. **#19** CLI: `task set-status <n> done [--skip-hook | --hook-command "<cmd>"]`. CLI pushes the choice to the renderer via the existing `cli:task-*` IPC channel (mirrors `task start --hook-control`).
7. **#20** UI affordance for one-off skip: shift-drag to done column = skip hook. Add shift-key tracking alongside the existing `optionKeyHeld` mechanism; tooltip on the done column header when shift is held.

## Test plan

Tests are scoped to the unit doing the work; the bar is "if someone breaks this in three months, a test fails."

### Regression — must continue to pass

| Test | File | What it guards |
|---|---|---|
| `findOtherTaskTerminals` filters by taskId/isLoading | `src/__tests__/findOtherTaskTerminals.test.ts` | Snapshot semantics underlying `completeTask` |
| Start transition: dialog + worktree + hook spawn | `src/__tests__/renderer/taskStartService.test.tsx` | Start path untouched by done refactor |
| Continue/review transitions | same file | Non-done lifecycle unchanged |
| RunHookDialog queue ordering for bulk transitions | same file | Bulk moves still hit `runHookQueue` for start/continue/review |
| Bulk transition to done closes terminals via shared path | new in same file | Replaces the old "auto-close on done hook" test |

### New behavior — `completeTask` lifecycle

`src/__tests__/renderer/taskCompletion.test.tsx` (new)

- snapshot-before-spawn: pre-existing task terminals close, hook terminal survives
- no hook configured → status writes to done, terminals close, no spawn
- hook configured + no skip → spawn happens, status writes, snapshot closes
- hook configured + `skipHook: true` → no spawn, snapshot still closes
- `hookCommand` overrides the configured hook's command
- idempotency: calling `completeTask` twice for the same task is a no-op the second time
- status write happens *after* terminal closure (so the kanban doesn't reflow before the close)

### New behavior — entry point routing

- Kanban drag to done calls `completeTask`, not `setStatus` then `beginTransition` separately. Verify via mocked `completeTask` and `setStatus` — only the former is called. (`src/__tests__/renderer/kanbanBoardDoneFlow.test.tsx` — new)
- Terminal Close Task menu calls `completeTask`, not the bare `setStatus`. (`src/__tests__/renderer/terminalHeaderCloseTask.test.tsx` — new, or extend existing TerminalHeader tests)
- CLI `set-status done` hits the `completeTask` API path (vs the bare status PATCH). (`src/__tests__/cli/setStatusDone.test.ts` — new)

### New behavior — terminal status model

`src/__tests__/terminalStatus.test.ts` (new)

- `success` and `error` accepted by the status reducer
- PTY exit code 0 → `success`
- PTY non-zero exit → `error`
- Header renders distinct styling for each state (snapshot test or a smoke render)
- Status transitions: `thinking → success` after process exit; `thinking → error` on non-zero

### New behavior — done hook terminal self-tidy

`src/__tests__/renderer/doneHookTerminalLifecycle.test.tsx` (new)

- Done hook process exits 0 → terminal status becomes `success` → after grace period, terminal closes (fake timers)
- Done hook process exits non-zero → terminal becomes `error` → terminal stays open after grace period
- Non-done hook terminals never auto-close on exit (regression guard for start/continue/review)

### New behavior — CLI flags

`src/__tests__/cli/setStatusFlags.test.ts` (new)

- `set-status N done` with no flag → API call carries `runHook: true` (or equivalent)
- `set-status N done --skip-hook` → API call carries `skipHook: true`
- `set-status N done --hook-command "echo hi"` → API call carries `hookCommand: "echo hi"`
- `--skip-hook --hook-command` together → exits with usage error
- Flags silently ignored when status is not `done` (e.g. `set-status N in_review --skip-hook` succeeds with the status change and no warning)

### New behavior — UI shift-drag

`src/__tests__/renderer/kanbanShiftDrag.test.tsx` (new)

- Shift-drag to done column passes `skipHook: true` to `completeTask`
- Plain drag passes no skip flag
- Tooltip / visual cue rendered when shift is held over the done column (smoke test)

### End-to-end (Playwright)

`e2e/done-task.test.ts` (new)

One happy path through the GUI:
1. Start a task with a configured done hook
2. Drag it to done
3. Assert: hook terminal spawns, original terminals close, status updates to done
4. Hook command exits 0 → assert hook terminal closes after the grace period

Skip the failure path in e2e (covered well enough in unit tests).

## Decisions

- **Grace period for done-hook terminal auto-close on success: 3 seconds.** Single constant, no setting.
- **Modifier for one-off hook skip: Shift.** Add shift-key tracking to the kanban drag flow alongside the existing `optionKeyHeld` mechanism. Shift-drag to the done column skips the hook for that transition.
- **CLI flag scope: `--skip-hook` and `--hook-command` are silently ignored when `<status>` is not `done`.** Forward-compatible — if either flag ever applies to another status, the call site doesn't need to change.
- **Undo is out of scope.** Marking done is recoverable through existing affordances (drag back out of done, or re-open a terminal on the worktree). No toast, no undo stack.
