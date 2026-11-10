# Scheduled tasks — plan

A scheduled task is a prompt Ouijit turns into a task card on a timer. Each run
is an ordinary task: its own worktree, the project's start hook, a card on the
board. The board's **In review** column is the inbox.

## What others ship

| | Codex app (Automations) | Claude Code Desktop (Scheduled tasks) | Cursor (Automations) |
| :- | :- | :- | :- |
| Runs on | Your machine, app open | Your machine, app open and awake | Cloud |
| Where | Local checkout or a background worktree (default) | Local folder; worktree opt-in | Fresh clone |
| Schedule | Presets, RRULE; minutes for in-chat tasks | Hourly, Daily, Weekdays, Weekly, Manual, cron (≥1h in the form) | Presets, cron, plus GitHub/Slack/Linear/webhook events |
| Permissions | Unattended, sandbox policy, no approvals | Per-task permission mode; runs stall on prompts | Cloud agent, no prompts |
| Results | Triage inbox; runs with findings show unread | A session per run, listed in the task's history | Agent run, PR |
| Missed runs | Unspecified | One catch-up for the latest missed time in 7 days | n/a |
| Created by | UI, or asking the agent | UI, or asking the agent | UI |

What carries over: worktree by default, an inbox of runs that found something,
one catch-up run, "run now", and letting the agent create schedules. What to
avoid: Claude's runs stalling on a permission prompt nobody is there to answer,
and worktrees piling up from runs with nothing to say.

## How it works for a user

1. **Create.** In the project, **Schedules → New**: name, prompt, cadence.
   Or on any card, **Repeat…** seeds a schedule from that card's prompt. Or ask
   the agent: "every weekday at 9, triage new PRs" — it runs
   `ouijit schedule create`.
2. **Cadence.** Hourly, Daily at, Weekdays at, Weekly on, Manual, or cron, in
   local time. Minimum 15 minutes.
3. **A run.** When due, Ouijit runs the equivalent of
   `task create-and-start "<name> · Nov 9" --prompt "<prompt>" --run-hook`.
   The start hook launches whichever agent the project uses, so this works for
   claude, codex, pi and opencode alike. The card carries a schedule badge.
4. **Runs in the Sandbox by default.** A scheduled run has nobody to answer a
   permission prompt, so the agent runs with checks off, and that is what the
   sandbox is for. Host is allowed per schedule, with a warning.
5. **Reporting.** Ouijit appends a short instruction to the prompt: if there is
   something for the user, move the task to `in_review`; if not, move it to
   `done`. Done runs with no commits have their worktree removed. So the board
   only gains a card when a run found something.
6. **Manage.** The schedule's page: **Run now**, Pause/Resume, Edit, Delete,
   and its history — the cards it created, with skipped runs and why.

## Rules

- **App must be open.** Schedules fire while Ouijit runs and the Mac is awake.
  On launch or wake, a schedule that missed runs in the last 7 days gets one
  catch-up run for the latest missed time, with a notification.
- **No overlap.** If the previous run of a schedule is still in progress, the
  next one is skipped and recorded as skipped.
- **Concurrency cap.** At most N scheduled runs at once across projects
  (default 2); the rest queue.
- **Stored in the project's database**, one row per schedule; each run's task
  records its schedule id. Deleting a schedule leaves its cards.

## CLI

```
ouijit schedule list
ouijit schedule create "<name>" --prompt "<text>" --every "weekdays 09:00" [--cron "<expr>"] [--sandbox host|nono|custom]
ouijit schedule run <id>
ouijit schedule pause <id> | resume <id> | delete <id>
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
