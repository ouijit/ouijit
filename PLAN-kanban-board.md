# Kanban Board View

## Context

The task-first data model refactor introduced four task statuses (`todo`, `in_progress`, `in_review`, `done`) that map perfectly to kanban columns. Currently the only way to browse tasks is the task index sidebar — a flat list that lumps all non-done statuses together. A kanban board gives a spatial view of the workflow and lets users drag tasks between statuses.

## Requirements

- Full-screen overlay (same position as `.theatre-stack`, hides the terminal stack when open)
- Four columns: To Do | In Progress | In Review | Done
- HTML5 drag-and-drop between columns to change task status
- Click a card to open its terminal (closes the board)
- Expand button on each card for inline detail (branch, prompt, date, actions)
- Right-click for sandbox context menu (reuses existing `showTaskContextMenu`)
- Hotkey: **Cmd+B** to toggle (registered in THEATRE scope)
- Board toggle button in the task index header
- Mutual exclusion: opening kanban closes task index and vice versa
- Auto-refreshes when `taskVersion` signal bumps (same pattern as task index)
- Terminals keep running in the background while board is open (CSS-hidden, not destroyed)
- Status dot mirrors theatre card dot: `idle` (green) or `thinking` (purple+pulse), plus sandboxed ring — looked up via `terminals.value` matching on `taskId`

**Prerequisite:** The task-first refactor accidentally re-introduced the old six-type `SummaryType` (overwriting commit f69dc41's simplification). Step 0 re-applies that simplification before building the kanban board.

## Files to Change

| File | Change |
|------|--------|
| **`src/components/theatre/kanbanBoard.ts`** | **NEW** — board component (~250 lines) |
| `src/utils/hotkeys.ts` | Add `KANBAN` scope to `Scopes` |
| `src/components/theatre/signals.ts` | Add `kanbanVisible` signal + reset |
| `src/components/theatre/state.ts` | Add `kanbanCleanup` to `theatreState`; simplify `SummaryType` |
| `src/components/theatre/helpers.ts` | Add `toggleKanbanBoard` to `TheatreRegistry` |
| `src/components/theatre/theatreMode.ts` | Register/unregister Cmd+B in enter/restore/exit |
| `src/components/theatre/terminalCards.ts` | Add `'b'` to `appHotkeys`; simplify `analyzeTerminalOutput` |
| `src/components/theatre/taskIndex.ts` | Board toggle button in header; close kanban in `showTaskIndex()` |
| `src/components/theatre/effects.ts` | Auto-refresh effect for kanban (mirrors task index pattern) |
| `src/index.css` | Kanban styles (~120 lines); remove stale status dot CSS |

## Implementation Steps

### 0. Re-apply SummaryType simplification (from f69dc41)

**`src/components/theatre/state.ts`** — Change `SummaryType` from `'error' | 'listening' | 'building' | 'watching' | 'thinking' | 'idle'` to `'thinking' | 'idle'`.

**`src/components/theatre/terminalCards.ts`** — Simplify `analyzeTerminalOutput`: remove buffer analysis (shell prompts, errors, listening, building, watching patterns), keep only the OSC title spinner check → `'thinking'`, default → `'idle'`. Change `_buffer` parameter prefix. On process exit, always set `summaryType: 'idle'` (no error state).

**`src/index.css`** — Remove CSS rules for `data-status="error"`, `data-status="listening"`, `data-status="building"`, `data-status="watching"`.

### 1. Scaffolding (no dependencies between these)

**`src/utils/hotkeys.ts`** — Add `KANBAN: 'kanban'` to `Scopes` object.

**`src/components/theatre/signals.ts`** — Add `export const kanbanVisible = signal(false);` and `kanbanVisible.value = false;` in `resetSignals()`.

**`src/components/theatre/state.ts`** — Add `kanbanCleanup: null as (() => void) | null` to `theatreState`.

**`src/components/theatre/helpers.ts`** — Add `toggleKanbanBoard: (() => void) | null` to `TheatreRegistry` interface and `toggleKanbanBoard: null` to the object.

### 2. Main component: `src/components/theatre/kanbanBoard.ts`

Structure (follows `taskIndex.ts` pattern):

- **`KANBAN_COLUMNS`** constant — `[{ status, label }]` for the four columns
- **`buildKanbanHtml()`** — HTML shell with four `.kanban-column[data-status]` divs, each with header (title + count) and scrollable body
- **`buildKanbanCard(task, path, limaAvailable)`** — DOM element per card:
  - `draggable=true`, `data-task-number` attribute
  - Header: name, status dot (lookup terminal by `taskId` → use `summaryType` as `data-status`, add `--sandboxed` class if sandboxed), expand chevron
  - Detail (hidden): branch, prompt (3-line clamp), date, action buttons (close/reopen, delete)
  - Events: dragstart/dragend, click-to-open-terminal, expand toggle, actions, right-click context menu
  - Reuses: `showTaskContextMenu` (helpers.ts), `reopenTask`/`closeTask`/`deleteTask` (worktreeDropdown.ts), `escapeHtml` (utils/html)
- **`setupColumnDropTargets()`** — `dragover`/`dragleave`/`drop` on column bodies. Drop: parse taskNumber, call `window.api.task.setStatus()`, `invalidateTaskList()`, re-populate
- **`populateKanbanBoard()`** — Fetch `window.api.task.getAll()`, distribute into columns, render lucide icons
- **`showKanbanBoard()`** — Guard `kanbanVisible`, create DOM, populate, `body.kanban-open`, animate, push KANBAN scope, register escape + Cmd+B hotkeys, store cleanup
- **`hideKanbanBoard()`** — Remove `--visible`, remove DOM after 200ms, remove body class, cleanup, clear signal
- **`toggleKanbanBoard()` / `refreshKanbanBoard()`**
- Register `theatreRegistry.toggleKanbanBoard = toggleKanbanBoard` at module load

### 3. Hotkey wiring: `src/components/theatre/theatreMode.ts`

- `enterTheatreMode()` (~line 285): register `mod+b` → `theatreRegistry.toggleKanbanBoard?.()`
- `restoreTheatreMode()` (~line 604): same
- `exitTheatreMode()` (~line 400): unregister `mod+b`, hide kanban via dynamic import

### 4. Terminal passthrough: `src/components/theatre/terminalCards.ts`

Add `'b'` to `appHotkeys` array (line 46).

### 5. Task index integration: `src/components/theatre/taskIndex.ts`

- Add board toggle button (lucide `columns-3`) in `buildTaskIndexHtml()` header
- Wire button in `showTaskIndex()`: `hideTaskIndex()` then `theatreRegistry.toggleKanbanBoard?.()`
- Top of `showTaskIndex()`: if `kanbanVisible.value`, dynamically import and call `hideKanbanBoard()`

### 6. Auto-refresh: `src/components/theatre/effects.ts`

New effect: track `taskVersion`, when bumped and `kanbanVisible` is true, dynamically import `refreshKanbanBoard()`.

### 7. CSS: `src/index.css`

Add after task index section (~line 2090):

- `body.kanban-open .theatre-stack { display: none }` — hide stack (terminals keep running)
- `body.kanban-open .task-index-panel { display: none }` — hide sidebar
- `.kanban-board` — fixed positioning matching `.theatre-stack`, opacity transition
- `.kanban-columns` — flex row, gap-3
- `.kanban-column` — flex-1, subtle bg `rgba(255,255,255,0.03)`, rounded-lg, border
- `.kanban-column--drop-target` — accent border + faint accent bg
- `.kanban-column-header` — 11px uppercase secondary title + count
- `.kanban-column-body` — flex-col, overflow-y-auto, gap-1.5, padding
- `.kanban-card` — subtle bg, hover/active states, no cursor:pointer
- `.kanban-card--dragging` — opacity 40%
- `.kanban-card-header` — name + dot + expand
- `.kanban-card-status-dot` — reuse `.theatre-card-status-dot` styles (same `data-status` → idle green, thinking purple+pulse, sandboxed ring)
- `.kanban-card-expand` — opacity-0 until hover, rotate 180deg when expanded
- `.kanban-card-detail` — border-top, rows for branch/prompt/date/actions
- `.kanban-card-action` — small icon buttons, danger variant for delete
- `.task-index-board-btn` — icon button in task index header

## Verification

1. **`npm run check`** — Type check passes
2. **`npm test`** — Existing tests pass
3. Manual:
   - Cmd+B in theatre mode → board appears, stack hides (terminals keep running)
   - Four columns with correct task distribution
   - Status dots match theatre card dots (green idle, purple thinking, sandboxed ring)
   - Drag card between columns → status updates, card moves
   - Click card → board closes, terminal opens
   - Expand chevron → detail slides open
   - Escape or Cmd+B → board closes, stack returns intact
   - Cmd+T opens task index, board icon in header opens kanban (mutual exclusion works)
