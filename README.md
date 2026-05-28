<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/public/assets/ouijit-logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="website/public/assets/ouijit-logo-dark.svg">
  <img alt="ouijit" src="website/public/assets/ouijit-logo.svg" width="160">
</picture>

<br><br>

Ouijit is a customizable task and terminal session manager that integrates with agent CLIs and TUIs via lifecycle hooks, scripts, and a session-aware CLI. It offers basic comforts for agentic development like live agent status with notifications, automatic worktree management for parallel workstreams, and VM sandboxing for untrusted code.

Download the latest release:

- [macOS (Apple Silicon)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-darwin-arm64.zip)
- [macOS (Intel)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-darwin-x64.zip)
- [Linux (x64)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-linux-x64.zip)

Free and open source. No account, no sign-in, no telemetry.

[Website](https://ouijit.com/) · [Docs](https://ouijit.com/docs/) · [All releases](https://github.com/ouijit/ouijit/releases)

<img src="website/public/assets/screenshots/kanban.png" alt="Kanban board" width="100%">

<img src="website/public/assets/screenshots/terminal-stack.png" alt="Terminal stack" width="100%">

<img src="website/public/assets/screenshots/settings.png" alt="Settings" width="100%">

## Supported harnesses

- [Claude Code](https://claude.com/claude-code)
- [Codex](https://github.com/openai/codex)
- [Pi](https://pi.dev)

To request support for another harness, [open an issue](https://github.com/ouijit/ouijit/issues/new).

## CLI

The `ouijit` command is available in every terminal Ouijit opens. You can use it directly from the shell to create and advance tasks, manage hooks and scripts, or attach a plan file to the current terminal:

```bash
ouijit task list                              # array of tasks in the current project
ouijit task current                           # task owning this terminal
ouijit task create-and-start "Fix login bug"  # new task + worktree + terminal
ouijit task set-status 5 in_review
ouijit hook set start --command 'claude "$OUIJIT_TASK_DESCRIPTION"'
ouijit script run Lint
ouijit plan set ./plan.md
```

The supported harnesses (Claude Code, Codex, Pi) know how to use it out of the box. Output is JSON on stdout for easy piping into `jq`. Full command list in the [docs](https://ouijit.com/docs/#cli).

## Setup

Requires Node.js 20+, git, and C/C++ build tools for native modules (better-sqlite3, node-pty, koffi):

- **macOS:** `xcode-select --install`
- **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

```bash
git clone https://github.com/ouijit/ouijit.git
cd ouijit
npm install
npm start
```
