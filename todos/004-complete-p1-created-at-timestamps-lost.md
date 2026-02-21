---
status: pending
priority: p1
issue_id: "004"
tags: [code-review, data-integrity, migration]
dependencies: []
---

# Preserve original created_at timestamps during import

## Problem Statement

When importing tasks from `task-metadata.json`, the original `createdAt` timestamps from the JSON are not being passed through to the SQLite `created_at` column. Instead, the database defaults to the current time, losing the historical creation dates of all tasks.

## Findings

- `src/services/dataImportService.ts`: Task creation during import doesn't pass `createdAt` to the repo
- Flagged by: data-integrity-guardian
- Users would lose the creation dates of all their existing tasks after migration

**Location:**
- `src/services/dataImportService.ts` — task import loop
- `src/db/repos/taskRepo.ts` — `create()` method may need to accept optional `created_at`

## Proposed Solutions

### Option A: Pass created_at through during import
- Modify `taskRepo.create()` to accept an optional `created_at` parameter
- Pass the JSON `createdAt` value during import
- **Pros:** Preserves user data, minimal change
- **Cons:** Slightly more complex create signature
- **Effort:** Small
- **Risk:** Low

### Option B: Direct SQL insert in import service
- Use raw SQL in the import service to insert with explicit timestamps
- **Pros:** No change to repo API
- **Cons:** Bypasses repo, duplicates logic
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Option A — cleaner and keeps the repo as the single point of truth.

## Technical Details

**Affected files:**
- `src/services/dataImportService.ts`
- `src/db/repos/taskRepo.ts`

## Acceptance Criteria

- [ ] Imported tasks retain their original `createdAt` from JSON
- [ ] New tasks created via UI still get current timestamp as default
- [ ] `npm test` passes with a test verifying timestamp preservation

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | Data loss during migration |

## Resources

- PR branch: `db-migration-195`
