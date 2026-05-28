<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/public/assets/ouijit-logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="website/public/assets/ouijit-logo-dark.svg">
  <img alt="ouijit" src="website/public/assets/ouijit-logo.svg" width="200">
</picture>

<br>

_Integrated Divination Environment._

Ouijit is a customizable task and terminal session manager that integrates with agent CLIs and TUIs like Claude Code via lifecycle hooks, scripts, and a session-aware CLI. It offers basic comforts for agentic development like live agent status with notifications, automatic worktree management for parallel workstreams, and VM sandboxing for untrusted code.

Download the latest release:

- [macOS (Apple Silicon)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-darwin-arm64.zip)
- [macOS (Intel)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-darwin-x64.zip)
- [Linux (x64)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-linux-x64.zip)

Free and open source. No account, no sign-in. [Docs](https://ouijit.com/docs/) · [All releases](https://github.com/ouijit/ouijit/releases)

<img src="website/public/assets/screenshots/kanban.png" alt="Kanban board" width="100%">

Tasks move across To Do, In Progress, In Review, and Done columns. Each task owns a git worktree and a stack of terminal sessions.

<img src="website/public/assets/screenshots/terminal-stack.png" alt="Terminal stack" width="100%">

Open multiple terminals per task, with an optional plan panel alongside the active session. Agent status (thinking, ready, waiting for input) surfaces in the tab header.

<img src="website/public/assets/screenshots/settings.png" alt="Settings" width="100%">

Configure worktree strategy, lifecycle hooks (Start, Continue, Review, Done), run scripts, and the editor command per project.

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
