# Theatre Mode Enhancement Plan

## Summary
Enhance theatre mode to be the primary project interaction mode with multi-terminal support displayed as a card stack.

## Requirements
1. **Clicking a project row** → Runs default command and enters theatre mode directly
2. **Launch dropdown in theatre header** → Positioned beside git status pill
3. **Multi-terminal card stack** → Up to 5 terminals, click to bring forward
4. **Adding terminals** → Via launch dropdown (selecting a command adds to stack)

---

## Implementation

### 1. Update Terminal State Management
**File:** `src/components/terminalComponent.ts`

- Change `theatreModeProjectPath` from single string to support multiple terminals
- Add new state:
  ```ts
  interface TheatreTerminal {
    ptyId: PtyId;
    projectPath: string;
    command: string | undefined;  // undefined = interactive shell
    label: string;  // Display name for the card
  }

  const MAX_THEATRE_TERMINALS = 5;
  let theatreTerminals: TheatreTerminal[] = [];
  let activeTheatreIndex: number = 0;
  ```
- Modify `enterTheatreMode()` to accept command parameter and create first terminal
- Add `addTheatreTerminal(command)` function for adding to the stack
- Add `switchToTheatreTerminal(index)` for card switching
- Add `closeTheatreTerminal(index)` for removing from stack

### 2. Build Theatre Header with Launch Dropdown
**File:** `src/components/terminalComponent.ts`

Update `buildTheatreHeader()` to include:
- Project icon, name, path (existing)
- **New:** Launch dropdown button (styled like the git status pill)
- Git status pill (existing)
- Exit button (existing)

Create `buildTheatreLaunchDropdown()`:
- Reuse dropdown building logic from `projectRow.ts` (extract to shared util or inline)
- Show run configs + custom commands
- Selecting a command calls `addTheatreTerminal()`
- Show current terminal count indicator (e.g., "2/5")
- Include "Close current" option when multiple terminals open

### 3. Card Stack UI
**File:** `src/components/terminalComponent.ts` + `src/index.css`

DOM structure for card stack:
```html
<div class="theatre-stack">
  <div class="theatre-card theatre-card--back-2" data-index="0">...</div>
  <div class="theatre-card theatre-card--back-1" data-index="1">...</div>
  <div class="theatre-card theatre-card--active" data-index="2">...</div>
</div>
```

CSS styling:
- Active card: full size, z-index highest
- Back cards: slightly scaled down, offset up/left, lower z-index
- Click handler on back cards to bring to front
- Transition animations for stack reordering

Each card contains:
- Small label/tab showing command name
- Close button (X) on the card
- The xterm terminal container

### 4. Modify Project Row Click Behavior
**File:** `src/components/projectRow.ts`

Change the row click handler (around line 435):
```ts
row.addEventListener('click', async () => {
  const settings = await window.api.getProjectSettings(project.path);
  const allConfigs = mergeRunConfigs(project.runConfigs, settings.customCommands);

  if (allConfigs.length === 0) {
    onOpen(project.path);  // Fallback to finder
    return;
  }

  // Get default config
  let defaultConfig = allConfigs[0];
  if (settings.defaultCommandId) {
    const explicit = allConfigs.find(c => getConfigId(c) === settings.defaultCommandId);
    if (explicit) defaultConfig = explicit;
  }

  // NEW: Enter theatre mode directly instead of inline terminal
  enterTheatreMode(project.path, project, defaultConfig);
});
```

Export `enterTheatreMode` from terminalComponent.ts and import in projectRow.ts.

### 5. Update enterTheatreMode Signature
**File:** `src/components/terminalComponent.ts`

```ts
export async function enterTheatreMode(
  projectPath: string,
  projectData: Project,
  runConfig?: RunConfig  // NEW: optional command to run
): Promise<void>
```

- If `runConfig` provided, spawn PTY with that command
- If not provided, spawn interactive shell
- Store terminal in `theatreTerminals` array

### 6. Handle Terminal Lifecycle in Theatre Mode
**File:** `src/components/terminalComponent.ts`

- When a terminal exits in theatre mode:
  - If it's the only one, exit theatre mode entirely
  - If multiple, remove from stack and show next card
- When exiting theatre mode:
  - Kill all theatre terminals
  - Clear `theatreTerminals` array

---

## Files to Modify
1. `src/components/terminalComponent.ts` - Major changes (theatre state, card stack, launch dropdown)
2. `src/components/projectRow.ts` - Row click behavior change
3. `src/index.css` - Card stack styling
4. `src/renderer.ts` - Minor: may need to export/import theatre functions

## New CSS Classes
- `.theatre-stack` - Container for card stack
- `.theatre-card` - Individual terminal card
- `.theatre-card--active` - Front/active card
- `.theatre-card--back-1`, `--back-2`, etc. - Stacked cards
- `.theatre-launch-dropdown` - Launch dropdown in header
- `.theatre-card-label` - Command label on each card
- `.theatre-card-close` - Close button on cards

---

## Verification
1. Click a project row → Should enter theatre mode running the default command
2. Open launch dropdown in theatre → Should show all run configs/custom commands
3. Select a command from dropdown → Should add new terminal card to stack (up to 5)
4. Click a background card → Should bring it to front with animation
5. Close a terminal (X button) → Should remove from stack, show next
6. Close last terminal → Should exit theatre mode
7. Press Escape → Should exit theatre mode (killing all terminals)
8. Git status dropdown → Should still work as before

---

## Code References

### Current Theatre Mode Entry Point
`src/components/terminalComponent.ts:991-1051` - `enterTheatreMode()` function

### Current Theatre Header Builder
`src/components/terminalComponent.ts:536-556` - `buildTheatreHeader()` function

### Project Row Click Handler
`src/components/projectRow.ts:435-456` - Row click event listener

### Launch Dropdown Builder
`src/components/projectRow.ts:112-287` - `buildDropdownContent()` function (can be adapted for theatre)

### Terminal Instance Management
`src/components/terminalComponent.ts:10-21` - `TerminalInstance` interface and `terminals` Map
