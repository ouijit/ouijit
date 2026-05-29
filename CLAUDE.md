# Ouijit

Desktop app for project management with integrated terminal sessions, git worktree-based task isolation, and CLI agent support. Runs on macOS and Linux.

## Development

### Commands for Claude
- `npm run check` - Type check + lint + format check (run this to verify changes)
- `npm run lint` - ESLint only
- `npm run format` - Auto-format with Prettier
- `npm test` - Run unit/integration tests (rebuilds better-sqlite3 silently as a pretest step)
- `npm run test:e2e` - Run Playwright e2e tests (builds app first, tests UI flows)
- `npm run db:reset` - Wipe this worktree's dev DB (next launch = first-launch state)
- `npm run db:seed` - Seed the demo project used in marketing screenshots

Do NOT run `npm run start` or other dev server commands.

Dev userData is isolated per worktree via a hash of the repo path (`…/ouijit-dev-<hash>`), so multiple worktrees can run in parallel without stomping each other and never touch the production DB.

### Project Structure

**Entry points:**
- `src/main.ts` - Electron main process (window lifecycle, native module loading)
- `src/preload.ts` - Preload script (IPC bridge, exposes `window.api`)
- `src/renderer.tsx` - Renderer entry point (mounts the React `App`)
- `src/App.tsx` - Root React component (home/project view routing)

**Core logic (main process):**
- `src/ipc/` - IPC layer
  - `contract.ts` - Typed channel contract shared with the preload bridge
  - `register.ts` - Registers all handlers on app startup
  - `handlers/` - Per-domain handlers (git, worktree, task, project, pty, hooks, scripts, tags, settings, plan, lima, health)
- `src/git.ts` - Git operations (status, diff, merge, branch management)
- `src/worktree.ts` - Git worktree lifecycle (create, start, remove, CoW cloning)
- `src/taskLifecycle.ts` - Task status transitions and side effects
- `src/db/` - SQLite persistence layer (tasks, settings, hooks, projects)
  - `database.ts` - Database singleton (WAL mode, migrations)
  - `index.ts` - Public API barrel (async wrappers preserving IPC contract)
  - `repos/` - Repository classes (taskRepo, hookRepo, projectRepo, scriptRepo, tagRepo, settingsRepo, globalSettingsRepo)
  - `migrations/` - Versioned schema migrations
- `src/services/` - App services (`dataImportService.ts` one-shot JSON→SQLite migration, `taskStartService.ts`, `taskCompletion.ts`)
- `src/scanner.ts` - Project metadata enrichment (language, description, icon)
- `src/ptyManager.ts` - PTY spawning, session management, output buffering
- `src/hookServer.ts` - HTTP server for agent hook status events
- `src/hookRunner.ts` - Script hook execution with timeout/output capture
- `src/projectCreator.ts` - New-project scaffolding
- `src/editorLauncher.ts` - Open files/worktrees in the configured editor
- `src/onboarding.ts` / `src/onboardingState.ts` - First-launch onboarding flow
- `src/updater.ts` - Auto-update wiring
- `src/types.ts` - Shared TypeScript interfaces

**Renderer state (Zustand stores):**
- `src/stores/` - Reactive state: `appStore.ts` (top-level app/view), `projectStore.ts` (tasks, toasts, modals per project), `terminalStore.ts` / `terminalDisplay.ts`, `canvasStore.ts`, `uiStore.ts`, `experimentalStore.ts`, `worktreeSettingsStore.ts`
- `src/hooks/` - Shared React hooks (`useIPCListeners.ts`, `useHookStatusListener.ts`, `useAutoResize.ts`)

**UI components (renderer process, React/.tsx):**
- `src/components/` - Top-level views: `HomeViewReact.tsx` (project grid), `ProjectViewReact.tsx` (project mode), `SidebarReact.tsx`, `TitleBarReact.tsx`, `GlobalSettingsPanel.tsx`, `RecentTasksPanel.tsx`, `ResumeBanner.tsx`
- `src/components/terminal/` - Terminal card stack, xterm integration, session restore/snapshot, OSC 133 handling, the shared `Icon` component
- `src/components/kanban/` - Task kanban board (4 columns: todo/in_progress/in_review/done), cards, bulk actions, onboarding panel
- `src/components/canvas/` - React Flow terminal canvas (nodes, chain edges, smart guides, alignment)
- `src/components/diff/` - Diff review panel + syntax highlighting
- `src/components/dialogs/` - Modal dialogs (new project, hook config, help, what's new, etc.)
- `src/components/scripts/` - Project settings, hook/script lists, sandbox + worktree sections
- `src/components/plan/` - Plan markdown panel
- `src/components/webPreview/` - Web preview panel
- `src/components/ui/` - Reusable primitives (`ToastContainer.tsx`, `ContextMenu.tsx`, `Tooltip.tsx`, `TooltipButton.tsx`)

**Lima VM sandbox:**
- `src/lima/` - Lima VM integration (sandboxed terminal sessions)
  - `manager.ts` - limactl CLI wrapper
  - `spawn.ts` - Sandboxed PTY creation
  - `config.ts` - Lima YAML config generation
  - `sandboxSync.ts` - Host↔VM file sync
  - `configStore.ts` / `types.ts` - Sandbox config persistence and shared types

**Utilities:**
- `src/utils/` - Shared utilities (icons, IDs, date formatting, file-path linkify/safety, plan markdown rendering, syntax highlighting, task chain, view transitions, OS notifications)

### Tech Stack
- Electron + Vite + TypeScript
- React 19 in the renderer (function components, no class components)
- Zustand for renderer state management
- @xyflow/react (React Flow) for the terminal canvas
- xterm.js for terminal emulation
- node-pty for shell processes
- better-sqlite3 for local persistence (SQLite, WAL mode)
- koffi (FFI) for native Copy-on-Write file cloning
- hotkeys-js for keyboard shortcuts
- Tailwind CSS v4 for styling
- Vitest for testing
- ESLint 9 + typescript-eslint for linting (circular dependency detection via `import-x/no-cycle`)
- Prettier for formatting (single quotes, 120 char width)

## Design Rules

- No `cursor: pointer` - this is a desktop app, not web
- Use hover/active states for visual feedback, not cursor changes
- Follow macOS HIG patterns
- Respect system light/dark mode

## Logging

Use `electron-log` instead of `console.*`. Each module gets a scoped logger:

```typescript
// Main process files:
import log from './log';              // or '../log' etc.
const worktreeLog = log.scope('worktree');

// Renderer process files:
import log from 'electron-log/renderer';
const kanbanLog = log.scope('kanban');
```

- **Variable naming:** `{module}Log` — e.g. `worktreeLog`, `hookServerLog`, `scannerLog`. Don't abbreviate.
- **Scope names:** lowercase, match the module — e.g. `'worktree'`, `'hookServer'`, `'scanner'`
- **Structured metadata:** pass context as a plain object in the last argument:
  ```typescript
  worktreeLog.info('started task', { taskNumber, worktreePath, branch });
  worktreeLog.error('recovery failed', { taskNumber, error: error instanceof Error ? error.message : String(error) });
  ```
- **Error formatting:** always extract `.message` from Error objects — `JSON.stringify(error)` produces `'{}'`
- **Log file:** writes JSON lines to `ouijit.log` (5MB rotation). Console transport kept for dev readability.
- **Tests:** both `electron-log/main` and `electron-log/renderer` are globally mocked in test setup files with console passthrough — no per-test mocking needed.

## Broken Windows

Never leave broken windows. If you encounter lint errors, type errors, or warnings in code you're touching — fix them, even if they're pre-existing. A clean `npm run check` is a requirement, not a nice-to-have.

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

## Pull Requests

PR descriptions should only contain a `## Summary` section with bullet points. No test plans, checklists, or generated-by credits.
