<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/public/assets/ouijit-logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="website/public/assets/ouijit-logo-dark.svg">
  <img alt="ouijit" src="website/public/assets/ouijit-logo.svg" width="200">
</picture>

<br>

Kanban terminal manager for CLI agent workflows with automatic git worktree isolation and VM sandbox support included.

[macOS (Apple Silicon)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-darwin-arm64.zip) · [macOS (Intel)](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-darwin-x64.zip) · [Linux](https://github.com/ouijit/ouijit/releases/latest/download/ouijit-linux-x64.zip)

<table>
  <tr>
    <td><img src="website/assets/screenshots/kanban.png" alt="Kanban board"></td>
    <td><img src="website/assets/screenshots/terminal-stack.png" alt="Terminal stack"></td>
  </tr>
  <tr>
    <td><img src="website/assets/screenshots/canvas.png" alt="Terminal canvas"></td>
    <td><img src="website/assets/screenshots/settings.png" alt="Settings"></td>
  </tr>
</table>

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
