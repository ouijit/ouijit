# Scheduled tasks — plan

A schedule runs a prompt on a timer in a project. Runs stay off the board: each
one belongs to its schedule, and only a run with something for you to look at
asks for your attention. Opening it continues the run, the same as reopening an
in-progress task.

## What others ship

| | Codex app (Automations) | Claude Code Desktop (Scheduled tasks) | Cursor (Automations) |
| :- | :- | :- | :- |
| Runs on | Your machine, app open | Your machine, app open and awake | Cloud |
| Where a run works | Fresh background worktree (default) or local checkout | Your folder as it is; worktree opt-in | Fresh clone |
| Scope | One or more projects | One folder | One repo, or none |
| Schedule | Presets, RRULE; minutes for in-chat tasks | Hourly, Daily, Weekdays, Weekly, Manual, cron (≥1h in the form) | Presets, cron, plus GitHub/Slack/Linear/webhook events |
| Permissions | Unattended, sandbox policy, no approvals | Per-task permission mode; runs stall on prompts | Cloud agent, no prompts |
| Results | An inbox of runs worth reading; worktrees pile up unless archived | A session per run, in the task's history | Agent run, PR |
| Missed runs | Unspecified | One catch-up for the latest missed time in 7 days | n/a |
| Created by | UI, or asking the agent | UI, or asking the agent | UI |

Taken: worktree per run, an inbox for runs that need you, one catch-up run, Run
now, schedules the agent can create. Avoided: runs stalling on a permission
prompt nobody is there to answer, worktrees piling up, and every run landing
somewhere you have to clear.

## How it works for a user

1. **Create.** On the project's **Schedules** page, **New**: name, prompt,
   cadence. Or ask the agent — "every weekday at 9, triage new PRs" — and it
   runs `ouijit schedule create`.
2. **Cadence.** Hourly, Daily at, Weekdays at, Weekly on, Manual, or cron, in
   local time. Minimum 15 minutes.
3. **A run.** When due, Ouijit makes a fresh worktree and runs the project's
   start hook with the prompt, so it works with whichever agent the project
   uses. Read-only schedules can run in the project folder instead and skip the
   worktree.
4. **Sandbox by default.** Nobody is there to answer a permission prompt, so
   the agent runs with checks off, which is what the sandbox is for. Host is
   allowed per schedule, with a warning.
5. **Report or stay quiet.** If the run has something for you — two new PRs
   with review comments staged in drafts, outdated packages to bump — the agent
   runs `ouijit schedule report "<one line>"`. The run shows as unread on the
   Schedules page, the sidebar's Schedules row shows an unread count, and a
   notification fires. A run that doesn't report ends quietly, and its
   worktree is removed.
6. **Open a run.** Opening a report runs the continue hook in the run's
   worktree: the agent picks up its session with full context, and you carry on
   from there.
7. **Make a task.** If a run turns into real work, **Make a task** puts it on
   the board, keeping its worktree and branch.

A run is a task that never went on the board: same worktree, same start and
continue hooks. Nothing new is built for sessions.

## Where you see it

- **Schedules page**, per project, beside Board, Pull requests and Analysis.
  Each schedule shows its cadence and next run, with Run now, Pause/Resume,
  Edit and Delete. Its history lists every run — running, reported, quiet, or
  skipped and why — and any run can be opened. Reported runs are unread until
  opened or dismissed.
- **Sidebar**: the project's Schedules row carries the unread count, and a dot
  while a run is going. Runs never appear as terminals there.
- **Run now** opens the run in front of you, to watch it while tuning the
  prompt. Scheduled runs stay in the background.
- **CLI** for agents.

## Rules

- **App must be open.** Schedules fire while Ouijit runs and the Mac is awake.
  On launch or wake, a schedule that missed runs in the last 7 days gets one
  catch-up run for the latest missed time, with a notification.
- **No overlap.** If a schedule's previous run is still going, the next is
  skipped and recorded as skipped.
- **Concurrency cap.** At most N scheduled runs at once across projects
  (default 2); the rest queue.
- **Retention.** A reported run keeps its worktree until you open it and close
  it, make it a task, or dismiss it.
- **Stored per project**, one row per schedule, one per run.

## CLI

```
ouijit schedule list
ouijit schedule create "<name>" --prompt "<text>" --every "weekdays 09:00" [--cron "<expr>"] [--in worktree|project] [--sandbox host|nono|custom]
ouijit schedule run <id>
ouijit schedule pause <id> | resume <id> | delete <id>
ouijit schedule report "<summary>"     # from inside a run
```

## Later, not v1

- **Event triggers** — a PR opened or review requested, a Linear issue
  assigned. Ouijit already reads both.
- **Recurring check on one task** — run the continue hook in an existing
  task's worktree every N minutes, for babysitting a PR. Codex's in-chat tasks
  do this.
- **Cloud runs** while the machine is off.

## Sources

- [Codex automations](https://learn.chatgpt.com/docs/automations?surface=app)
- [Claude Code Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)
- [Cursor automations changelog](https://cursor.com/changelog/03-05-26)
