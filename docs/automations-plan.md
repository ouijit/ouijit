# Automations — plan

An automation runs a command on a schedule in a project. The command can be a
plain script, or an agent with a prompt. Each firing is a **run**. Runs stay off
the board; a run that needs you says so, and opening it picks up where it left
off.

## Why a command, not a prompt

A prompt is one kind of command: `claude "<prompt>"`. A command also covers a
nightly `npm audit` that spends no tokens, and a script that checks for work
and only launches an agent when it finds some. It is what hooks and project
scripts already are.

Nor does Ouijit need event triggers. "Every 15 minutes, handle PRs where my
review was requested" is a schedule and a prompt: the agent has `gh`, Linear
and the Ouijit CLI, so it can poll anything, see what an earlier run already
did, and act on each item it finds. The cost is latency up to the interval.

## What others ship

| | Codex app | Claude Code Desktop | Cursor |
| :- | :- | :- | :- |
| Called | Automations | Scheduled tasks (formerly Routines) | Automations |
| Runs on | Your machine, app open | Your machine, app open and awake | Cloud |
| What runs | A prompt | A prompt | A prompt |
| Triggers | Schedule; Gmail, Slack, GitHub events on web | Schedule, manual; cloud tasks add API and GitHub events | Schedule, GitHub, GitLab, Slack, Linear, webhooks |
| Where a run works | Fresh worktree (default) or local checkout | Your folder as it is; worktree opt-in | Fresh clone |
| Permissions | Unattended, sandbox policy | Per-task mode; runs stall on prompts | Cloud agent, no prompts |
| Results | Inbox of runs worth reading | A session per run | Agent run, PR |
| Missed runs | Unspecified | One catch-up for the latest missed time | n/a |

All three run a prompt. Running a command covers that and the cases with no
agent at all.

## How it works for a user

1. **Find it.** Every project has an **Automations** row in the sidebar,
   beside Board, Pull requests and Analysis. Empty, its page offers a few
   examples to start from — "Triage new PRs each weekday morning", "Nightly
   dependency audit". The command palette has **New automation**, and asking
   the agent ("every morning, check for outdated deps") creates one and links
   to it.
2. **Create.** Name, schedule, and what to run:
   - **Agent with a prompt** — fills in the command from the project's start
     hook, so it runs whichever agent the project uses.
   - **Script** — one of the project's scripts, or a command typed in.
3. **Schedule.** Hourly, Daily at, Weekdays at, Weekly on, Manual, or cron, in
   local time. Minimum 15 minutes. **Run now** fires it any time, and
   `ouijit automation run <name>` lets a script or another agent fire it.
4. **Where a run works.** A fresh worktree by default, removed afterwards
   unless the run needs you. Or the project folder, for runs that only read.
5. **Sandbox by default.** Nobody is there to answer a permission prompt, so
   an agent runs with checks off, which is what the sandbox is for. Host is
   allowed per automation, with a warning.
6. **A run that needs you** — it fails, or it runs
   `ouijit automation notify "<one line>"` — shows as unread on the
   Automations page, adds to the unread count on the sidebar row, and sends a
   notification. Every other run ends quietly.
7. **Open a run.** A script run shows its output, like a runner panel. An
   agent run continues: the continue hook runs in its worktree and the agent
   picks up its session.
8. **Make a task.** If a run turns into real work, **Make a task** puts it on
   the board, keeping its worktree and branch.

## The Automations page

Each automation shows its schedule, what it runs and its next run, with Run
now, Pause/Resume, Edit and Delete. Its history lists every run — running,
needs you, quiet, failed, or skipped and why — and any run can be opened.
**Run now** opens the run in front of you, to watch it while tuning the
command; scheduled runs stay in the background, shown only by a dot on the
sidebar row while they go.

## Rules

- **App must be open.** Automations fire while Ouijit runs and the Mac is
  awake. On launch or wake, one that missed runs in the last 7 days gets one
  catch-up run for the latest missed time, with a notification.
- **No overlap.** If an automation's previous run is still going, the next is
  skipped and recorded as skipped.
- **Concurrency cap.** At most N runs at once across projects (default 2); the
  rest queue.
- **Retention.** A run that needs you keeps its worktree until you open and
  close it, make it a task, or dismiss it.
- **Stored per project**, one row per automation, one per run. Each run gets
  `OUIJIT_AUTOMATION_NAME` and `OUIJIT_RUN_ID` in its environment.

## CLI

```
ouijit automation list
ouijit automation create "<name>" --every "weekdays 09:00" (--prompt "<text>" | --command "<cmd>" | --script <name>) [--cron "<expr>"] [--in worktree|project] [--sandbox host|nono|custom]
ouijit automation run <name>
ouijit automation pause <name> | resume <name> | delete <name>
ouijit automation notify "<one line>"     # from inside a run
```

## Direction

Hooks are automations whose trigger is a task's status changing and whose
target is that task. Folding them into one model would let a status change
fire any automation. Not v1: it touches something that works today.

## Sources

- [Codex automations](https://learn.chatgpt.com/docs/automations?surface=app)
- [Claude Code Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)
- [Cursor automations changelog](https://cursor.com/changelog/03-05-26)
