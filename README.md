# Ouijit

![Ouijit Theatre Mode](screenshot.png)

## Features

- **Isolated sessions** - Each task gets its own git worktree
- **Status lights** - Green when a session needs input, purple when busy
- **Terminal card stack** - Quick switching between sessions
- **Diff review** - View changes before merging
- **Script hooks** - Run scripts on task creation, play, and cleanup

## Script Hooks

Configure shell scripts that run at key points in the task lifecycle:

| Hook | When it runs | Example use |
|------|--------------|-------------|
| **init** | After worktree is created | `npm install` to set up dependencies |
| **run** | On-demand via launch menu | `npm run dev` to start dev server |
| **cleanup** | Before worktree is removed | Clean up resources, stop services |

Hooks receive environment variables:

```
OUIJIT_PROJECT_PATH    # Main project directory
OUIJIT_WORKTREE_PATH   # Task worktree directory
OUIJIT_TASK_BRANCH     # Git branch name
OUIJIT_TASK_NAME       # Task display name (e.g., "T-1")
OUIJIT_HOOK_TYPE       # Which hook is running
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| ⌘D | Toggle diff panel |
| ⌘S | Open ship-it panel |
| ⌘T | Show task index |
| ⌘N | Create new task |
| ⌘P | Open runner terminal |
| ⌘W | Close current terminal |
| ⌘[ / ⌘] | Switch terminal cards |

## Development

```bash
npm install
npm run start    # Dev mode
npm run check    # Type check
npm run make     # Package for distribution
```

## Tech Stack

Electron, Vite, TypeScript, xterm.js, node-pty, @preact/signals-core

## Platforms

macOS and Linux

## License

MIT
