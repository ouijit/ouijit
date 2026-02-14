# Ouijit

Native macOS desktop app for project management.

## Development

### Commands for Claude
- `npm run check` - Type check (run this to verify changes)
- `npm test` - Run tests (run this to validate data layer changes)

Do NOT run `npm run start` or other dev server commands.

### Project Structure
- `src/main.ts` - Electron main process
- `src/preload.ts` - Preload script (IPC bridge)
- `src/renderer.ts` - Renderer entry point
- `src/components/` - UI components
- `src/components/theatre/` - Theatre mode (terminal/task runner UI)
- `src/utils/` - Shared utilities
- `src/ouijit/` - Core app logic (import/export, dependencies)
- `src/lima/` - Lima VM sandbox integration

### Tech Stack
- Electron + Vite + TypeScript
- No framework - vanilla DOM manipulation
- @preact/signals-core for reactivity
- xterm.js for terminal emulation
- node-pty for shell processes

## Design Rules

- No `cursor: pointer` - this is a desktop app, not web
- Use hover/active states for visual feedback, not cursor changes
- Follow macOS HIG patterns
- Respect system light/dark mode

## Code Rules

- **No dynamic imports** — never use `import()` for lazy loading or code splitting. Always use static `import` at the top of the file. Vite handles circular dependencies fine for functions called inside handlers (not at module evaluation time). Use the `theatreRegistry` pattern only when true circular top-level access is needed.
- Don't replace `innerHTML` on elements with event listeners (destroys handlers)
- Use targeted DOM updates instead of full rebuilds
- Clear intervals/timeouts on cleanup
- Use `-webkit-app-region: no-drag;` for any UI elements (dropdowns, menus) originating in the titlebar area

### Theatre Mode Hotkeys

To add a new hotkey in theatre mode:

1. Add the handler function signature to `TheatreRegistry` interface in `helpers.ts`
2. Add initial `null` value in the `theatreRegistry` object
3. Implement the handler in the appropriate module (e.g., `terminalCards.ts`, `diffPanel.ts`)
4. Register it: `theatreRegistry.myHandler = myHandler;` at module load time
5. In `theatreMode.ts`:
   - Register hotkey in both `enterTheatreMode` and `restoreTheatreMode`
   - Unregister in `exitTheatreMode`
   - Call via registry with optional chaining: `theatreRegistry.myHandler?.()`

This registry pattern avoids circular dependencies between theatre modules.
