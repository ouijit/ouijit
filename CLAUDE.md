# Ouijit

Desktop app for project management with integrated terminal sessions, git worktree-based task isolation, and CLI agent support. Runs on macOS and Linux.

## Development

### Commands for Claude
- `npm run check` - Type check (run this to verify changes)
- `npm test` - Run tests (run this to validate data layer changes)

Do NOT run `npm run start` or other dev server commands.

### Project Structure

**Entry points:**
- `src/main.ts` - Electron main process (window lifecycle, native module loading)
- `src/preload.ts` - Preload script (IPC bridge, exposes `window.api`)
- `src/renderer.ts` - Renderer entry point (project grid UI)

**Core logic (main process):**
- `src/ipc.ts` - All IPC handler registrations
- `src/git.ts` - Git operations (status, diff, merge, branch management)
- `src/worktree.ts` - Git worktree lifecycle (create, start, remove, CoW cloning)
- `src/db/` - SQLite persistence layer (tasks, settings, hooks, projects)
  - `database.ts` - Database singleton (WAL mode, migrations)
  - `index.ts` - Public API barrel (async wrappers preserving IPC contract)
  - `repos/` - Repository classes (taskRepo, hookRepo, projectRepo, settingsRepo)
  - `migrations/` - Versioned schema migrations
- `src/services/dataImportService.ts` - One-shot JSON→SQLite migration on first launch
- `src/scanner.ts` - Project metadata enrichment (language, description, icon)
- `src/ptyManager.ts` - PTY spawning, session management, output buffering
- `src/hookServer.ts` - HTTP server for Claude Code hook status events
- `src/hookRunner.ts` - Script hook execution with timeout/output capture
- `src/types.ts` - Shared TypeScript interfaces

**UI components (renderer process):**
- `src/components/projectGrid.ts` - Project list grid view
- `src/components/projectRow.ts` - Individual project card
- `src/components/searchBar.ts` - Project search
- `src/components/newProjectDialog.ts` - Create project dialog
- `src/components/hookConfigDialog.ts` - Script hook configuration
- `src/components/importDialog.ts` - Toast notifications
- `src/components/project/` - Project mode (terminal card stack, kanban board, diff panel, git status, dropdowns)
  - `projectMode.ts` - Enter/exit project mode orchestration
  - `signals.ts` - Preact signals (reactive state)
  - `state.ts` - Mutable session state
  - `helpers.ts` - Registry pattern for cross-module calls
  - `terminalCards.ts` - Terminal card stack UI
  - `kanbanBoard.ts` - Task kanban board (4 columns: todo/in_progress/in_review/done)
  - `diffPanel.ts` - Diff review panel
  - `gitStatus.ts` - Per-terminal git status display

**Lima VM sandbox:**
- `src/lima/` - Lima VM integration (sandboxed terminal sessions)
  - `manager.ts` - limactl CLI wrapper
  - `spawn.ts` - Sandboxed PTY creation
  - `config.ts` - Lima YAML config generation

**Utilities:**
- `src/utils/` - Shared utilities (hotkeys, DOM helpers, icons, IDs, dropdowns, toasts, date formatting)

### Tech Stack
- Electron + Vite + TypeScript
- No framework - vanilla DOM manipulation with targeted DOM updates
- @preact/signals-core for reactivity
- xterm.js for terminal emulation
- node-pty for shell processes
- better-sqlite3 for local persistence (SQLite, WAL mode)
- koffi (FFI) for native Copy-on-Write file cloning
- hotkeys-js for keyboard shortcuts
- sortablejs for kanban drag-and-drop
- Tailwind CSS for styling
- Vitest for testing

## Design Rules

- No `cursor: pointer` - this is a desktop app, not web
- Use hover/active states for visual feedback, not cursor changes
- Follow macOS HIG patterns
- Respect system light/dark mode

## Code Rules

- **No dynamic imports** — never use `import()` for lazy loading or code splitting. Always use static `import` at the top of the file. Vite handles circular dependencies fine for functions called inside handlers (not at module evaluation time). Use the `projectRegistry` pattern only when true circular top-level access is needed.
- Don't replace `innerHTML` on elements with event listeners (destroys handlers)
- Use targeted DOM updates instead of full rebuilds
- Clear intervals/timeouts on cleanup
- Use `-webkit-app-region: no-drag;` for any UI elements (dropdowns, menus) originating in the titlebar area

### Project Mode Hotkeys

To add a new hotkey in project mode:

1. Add the handler function signature to `ProjectRegistry` interface in `helpers.ts`
2. Add initial `null` value in the `projectRegistry` object
3. Implement the handler in the appropriate module (e.g., `terminalCards.ts`, `diffPanel.ts`)
4. Register it: `projectRegistry.myHandler = myHandler;` at module load time
5. In `projectMode.ts`:
   - Register hotkey in both `enterProjectMode` and `restoreProjectMode`
   - Unregister in `exitProjectMode`
   - Call via registry with optional chaining: `projectRegistry.myHandler?.()`

This registry pattern avoids circular dependencies between project modules.
