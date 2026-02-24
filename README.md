# Ouijit

Kanban terminal manager for CLI agent workflows with automatic git worktree isolation per task and optional VM sandboxing for agents out of the box.

![Ouijit Project Mode](board.gif)

## Setup

Requires Node.js 20+, git, and C/C++ build tools for native modules (better-sqlite3, node-pty, koffi):

- **macOS:** `xcode-select --install`
- **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

```bash
git clone https://github.com/pbjer/ouijit.git
cd ouijit
npm install
npm start
```
