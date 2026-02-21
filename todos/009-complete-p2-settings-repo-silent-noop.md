---
status: pending
priority: p2
issue_id: "009"
tags: [code-review, data-integrity]
dependencies: []
---

# Fix SettingsRepo.update() silent no-op when row missing

## Problem Statement

`settingsRepo.update()` runs an UPDATE statement but if no row exists for that project, the UPDATE affects 0 rows and silently does nothing. The caller has no indication that the settings weren't saved.

## Findings

- `src/db/repos/settingsRepo.ts`: `update()` doesn't check `changes` count
- Wrapper functions like `setSandboxConfig()` and `setKillExistingOnRun()` call update and assume success
- Flagged by: code-simplicity-reviewer, data-integrity-guardian

**Location:**
- `src/db/repos/settingsRepo.ts` — `update()` method
- `src/db/index.ts` — wrapper functions

## Proposed Solutions

### Option A: Use INSERT OR REPLACE (upsert)
- Change update to an upsert that creates the row if missing
- **Pros:** Always succeeds, no silent failures
- **Cons:** Slightly more complex SQL
- **Effort:** Small
- **Risk:** Low

### Option B: Ensure row exists via ensureProject()
- Call `ensureProject()` before updating settings (already done in some paths)
- **Pros:** Guarantees row exists via foreign key cascade
- **Cons:** Extra query
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Option A — upsert is the standard SQLite pattern for this.

## Technical Details

**Affected files:**
- `src/db/repos/settingsRepo.ts`

## Acceptance Criteria

- [ ] Settings updates succeed even for new projects
- [ ] `npm test` passes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | |

## Resources

- PR branch: `db-migration-195`
