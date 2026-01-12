# Plan: Git Checkout via IPC with Error Handling

## Overview
Replace the current terminal-based branch checkout with a proper IPC handler that runs git checkout as a separate process and gracefully handles errors like uncommitted changes.

## Files to Modify

1. `src/types.ts` - Add GitCheckoutResult type
2. `src/git.ts` - Add checkoutBranch function
3. `src/ipc.ts` - Add git-checkout handler
4. `src/preload.ts` - Add gitCheckout bridge method
5. `src/components/terminalComponent.ts` - Update switchToBranch to use IPC + toast

## Implementation Steps

### Step 1: src/types.ts

Add new result type after other result types:
```typescript
export interface GitCheckoutResult {
  success: boolean;
  error?: string;
}
```

Add to ElectronAPI interface:
```typescript
gitCheckout(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
```

### Step 2: src/git.ts

Add new exported function at the end of the file:
```typescript
/**
 * Checkout a git branch
 */
export function checkoutBranch(projectPath: string, branchName: string): { success: boolean; error?: string } {
  const opts = { cwd: projectPath, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const };

  try {
    execSync(`git checkout "${branchName}"`, opts);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Parse git error messages into user-friendly text
    if (errorMsg.includes('Your local changes')) {
      return {
        success: false,
        error: 'Uncommitted changes would be overwritten. Commit or stash first.'
      };
    }
    if (errorMsg.includes('did not match any')) {
      return { success: false, error: `Branch '${branchName}' not found` };
    }

    return { success: false, error: 'Checkout failed' };
  }
}
```

### Step 3: src/ipc.ts

Add import for checkoutBranch:
```typescript
import { getGitStatus, getGitDropdownInfo, checkoutBranch } from './git';
```

Add handler after the get-git-dropdown-info handler:
```typescript
// Checkout a git branch
ipcMain.handle('git-checkout', async (_event, projectPath: string, branchName: string) => {
  return checkoutBranch(projectPath, branchName);
});
```

### Step 4: src/preload.ts

Add import for GitCheckoutResult type:
```typescript
import type { ..., GitCheckoutResult } from './types';
```

Add bridge method after getGitDropdownInfo:
```typescript
/**
 * Checkout a git branch
 */
gitCheckout: (projectPath: string, branchName: string): Promise<GitCheckoutResult> =>
  ipcRenderer.invoke('git-checkout', projectPath, branchName),
```

### Step 5: src/components/terminalComponent.ts

Add import for showToast at the top:
```typescript
import { showToast } from './importDialog';
```

Replace the existing switchToBranch function with:
```typescript
/**
 * Switch to a branch using IPC git checkout
 */
async function switchToBranch(branchName: string): Promise<void> {
  if (!theatreModeProjectPath) return;

  // Close dropdown immediately for responsiveness
  hideGitDropdown();

  const result = await window.api.gitCheckout(theatreModeProjectPath, branchName);

  if (result.success) {
    showToast(`Switched to ${branchName}`, 'success');
    // Trigger git status refresh to update the UI
    await refreshGitStatus();
  } else {
    showToast(result.error || 'Checkout failed', 'error');
  }
}
```

## Verification Checklist

1. [ ] Open theatre mode on a git repo
2. [ ] Click git status dropdown
3. [ ] Click a recent branch with no uncommitted changes -> should switch and show success toast
4. [ ] Make uncommitted changes, try to switch -> should show error toast about uncommitted changes
5. [ ] Git status pill should update after successful checkout
6. [ ] Run `npm run build` to verify no TypeScript errors
