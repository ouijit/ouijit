<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/public/assets/ouijit-logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="website/public/assets/ouijit-logo-dark.svg">
  <img alt="ouijit" src="website/public/assets/ouijit-logo.svg" width="160">
</picture>

<br><br>

Ouijit is a task and terminal manager for running coding agents in parallel. Each task gets its own git worktree and terminal. Lifecycle hooks launch your agent CLI with the right context, and a session-aware CLI lets agents drive the board back. Live status, notifications, diff review, and per-terminal sandboxing are built in.

Download the latest release:

- [macOS (Apple Silicon)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-darwin-arm64.dmg)
- [macOS (Intel)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-darwin-x64.dmg)
- [Linux (x64)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-linux-x64.zip)

Free and open source under AGPL-3.0. No account, no sign-in, no telemetry.

[Website](https://ouijit.com/) · [Docs](https://ouijit.com/docs/) · [FAQ](https://ouijit.com/faq/) · [All releases](https://github.com/ouijit/ouijit/releases)

<img src="website/public/assets/screenshots/kanban.png" alt="Kanban board with agent terminals attached to task cards" width="100%">

## Tasks and worktrees

Tasks live on a kanban board. Dragging a card between To Do, In Progress, In Review, and Done fires the matching lifecycle hook. Starting a task creates an isolated git worktree: a copy-on-write clone that arrives instantly with `node_modules` and other gitignored files intact, or a clean `git worktree` checkout if you prefer. Chain tasks off a parent branch, act on several cards at once, set a per-task merge target, and attach images or files to a task's prompt.

## Terminals and panels

Each terminal is a card in a stack. Panels attach as tabs: a runner for the dev server or any script, a web preview, and markdown files with Mermaid diagrams, so a plan opens beside the agent working from it. Shells outside any task get their own strip on the board. Tag sessions to filter them.

<img src="website/public/assets/screenshots/markdown.png" alt="Agent terminal beside a rendered markdown plan" width="100%">

<img src="website/public/assets/screenshots/preview.png" alt="Agent terminal beside a web preview of the app it is building" width="100%">

## Working with agents

Ouijit shadows the agent binaries on PATH to inject lifecycle hooks and a reference for the `ouijit` CLI into each session. Agents can create tasks, advance the board, and open panels with no setup. The board shows each agent's live status, and a sound or OS notification fires when a turn ends.

## Command palette

⌘K (Ctrl+K on Linux) jumps between terminals, projects, tasks, and pull requests, ranked by how often you return to them. Opening an unstarted task creates its worktree on the way.

<img src="website/public/assets/screenshots/palette.png" alt="Command palette over the kanban board" width="100%">

## Diffs and pull requests

Every task terminal includes a diff of its worktree against its merge target, uncommitted changes, or any base you pick, with word-level highlighting. Leave a note on a diff line and it goes to the agent working in that worktree, re-anchoring as the code moves. An experimental GitHub surface adds a pull request inbox, review comments staged locally until you send them, and merging. It drives the `gh` CLI, so `gh auth login` is the only setup.

<img src="website/public/assets/screenshots/diff.png" alt="Worktree diff beside the agent terminal" width="100%">

## Sandboxing

Run any terminal sandboxed: in a Lima VM that mounts only the task's worktree, or in place under Seatbelt/Landlock via nono (experimental).

## Session resume

Quitting saves the session. The next launch offers to bring its terminals back in their worktrees, panels included.

<img src="website/public/assets/screenshots/resume.png" alt="Resume banner listing the previous session's terminals" width="100%">

## Themes

Choose system, light, dark, or one of five presets, or define your own theme as design-token overrides. Switch in settings or with `ouijit theme use`.

<img src="website/public/assets/screenshots/themes.png" alt="The same board in dark, Dracula, Sepia, and light themes" width="100%">

## Hooks, scripts, and settings

Five lifecycle hooks (start, continue, run, review, done) and per-project scripts define how tasks launch and what runs alongside them.

<img src="website/public/assets/screenshots/settings.png" alt="Project settings with hooks and scripts" width="100%">

Also in the box: a multi-project home view, a configurable projects folder, `git init` for folders that need it, an editor launcher, health checks for the agent CLIs, first-run onboarding, terminal font settings, auto-update on macOS with release notes, and a local REST API behind the CLI. Everything is stored locally in SQLite.

## Supported harnesses

- [Claude Code](https://claude.com/claude-code)
- [Codex](https://github.com/openai/codex)
- [Pi](https://pi.dev)
- [OpenCode](https://opencode.ai)

To request support for another harness, [open an issue](https://github.com/ouijit/ouijit/issues/new).

## CLI

The `ouijit` command is available in every terminal Ouijit opens. Use it to create and advance tasks, manage hooks and scripts, stage pull request comments, switch themes, or open markdown and web preview panels:

```bash
ouijit task list                              # array of tasks in the current project
ouijit task current                           # task owning this terminal
ouijit task create-and-start "Fix login bug"  # new task + worktree + terminal
ouijit task set-status 5 in_review
ouijit hook set start --command 'claude "$OUIJIT_TASK_DESCRIPTION"'
ouijit script run Lint
ouijit pr draft add 116 --file src/api.ts --line 88 --body "throws when the token is missing"
ouijit theme use dracula
ouijit markdown add ./plan.md                 # open a markdown file as a panel
ouijit preview add http://localhost:3000      # open a web preview panel
```

The supported harnesses know how to use it out of the box. Output is JSON for easy piping into `jq`. Full command list in the [docs](https://ouijit.com/docs/#cli).

## Setup

Ouijit runs on macOS 13+ (Apple Silicon or Intel) and Linux x64, and needs git 2.20+ on PATH. The downloads above are self-contained.

Building from source also needs Node.js 20+ (the repo pins 22 in `.nvmrc`) and C/C++ build tools for the native modules (better-sqlite3, node-pty, koffi):

- **macOS:** `xcode-select --install`
- **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

```bash
git clone https://github.com/ouijit/ouijit.git
cd ouijit
npm install
npm start
```
