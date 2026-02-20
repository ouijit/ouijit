# Ouijit

![Ouijit Project Mode](screenshot.png)

## Features

- **Isolated sessions** - Each task gets its own git worktree
- **Status lights** - Green when a session needs input, purple when busy (uses [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) for accurate status)
- **Terminal card stack** - Quick switching between sessions
- **Diff review** - View changes before merging
- **Script hooks** - Run scripts on task creation, play, and cleanup
- **Sandboxed terminals** - Optionally run tasks in isolated Linux VMs via Lima

## Script Hooks

Configure shell scripts that run at key points in the task lifecycle:

| Hook | When it runs | Example use |
|------|--------------|-------------|
| **init** | After worktree is created | `npm install` to set up dependencies |
| **run** | On-demand via launch menu | `npm run dev` to start dev server |
| **cleanup** | Before worktree is removed | Clean up resources, stop services |
| **sandbox-setup** | After sandbox VM is created | Install tools, configure the VM environment |

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

### Prerequisites

- **Node.js 20+** and npm
- **C/C++ build tools** — required for compiling native modules (node-pty, koffi)
  ```bash
  # macOS
  xcode-select --install
  # Ubuntu/Debian
  sudo apt-get install build-essential
  ```
- **git**

### Setup

```bash
npm install
```

This compiles native C/C++ modules (node-pty, koffi) and downloads the limactl binary for sandbox support. May take a minute on first run.

### Running in dev mode

```bash
npm start
```

Launches the app via electron-forge with Vite HMR for the renderer process.

### Type checking

```bash
npm run check
```

### Project structure

```
src/main.ts          # Electron main process
src/preload.ts       # Preload script (IPC bridge)
src/renderer.ts      # Renderer entry point
src/components/      # UI components
src/components/project/  # Project mode (terminal/task runner UI)
src/utils/           # Shared utilities
src/ouijit/          # Core app logic (import/export, dependencies)
src/lima/            # Lima VM sandbox integration
```

### Native modules

Ouijit depends on **node-pty** and **koffi**, both native C/C++ modules that compile platform-specific `.node` binaries. ASAR packaging is disabled because native binaries need to live on the real filesystem — Node's module loader can't resolve them from inside an archive. The `afterCopy` hook in `forge.config.ts` copies these modules into the packaged app before code signing.

## Packaging

### macOS

```bash
npm run make
```

Produces a ZIP in `out/make/zip/darwin/`. For local/unsigned builds, skip signing and notarization:

```bash
SKIP_SIGN=1 SKIP_NOTARIZE=1 npm run make
```

### macOS code signing & notarization

Distributing outside the App Store requires signing and notarization so macOS Gatekeeper doesn't block the app.

1. **Apple Developer Program** membership is required
2. **Install your signing certificate** via Xcode or Keychain Access (Developer ID Application certificate)
3. **Create a notarization keychain profile:**
   ```bash
   xcrun notarytool store-credentials ouijit-notarize \
     --apple-id <your-apple-id-email> \
     --team-id <your-team-id> \
     --password <app-specific-password>
   ```
4. **Build:** `npm run make` will automatically sign (via `osxSign` in forge.config.ts) and notarize (via the `postPackage` hook)

The entitlements in `entitlements.mac.plist` grant JIT, unsigned executable memory, and library validation exceptions required by Electron's V8 engine.

### Linux

See [docs/building-linux.md](docs/building-linux.md) for the full guide. In short, `npm run make:linux` uses Lima + Docker to cross-compile native modules for x64 from macOS. Alternatively, build natively on a Linux x64 machine with `npm install && npm run make`.

## Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Run in development mode |
| `npm run check` | TypeScript type checking |
| `npm run package` | Package app (no installer) |
| `npm run make` | Package + create distributable |
| `npm run make:linux` | Cross-compile Linux build from macOS |

## Tech Stack

Electron, Vite, TypeScript, xterm.js, node-pty, @preact/signals-core, Lima

## Platforms

macOS and Linux
