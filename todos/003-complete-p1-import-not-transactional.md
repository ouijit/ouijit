---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, data-integrity, migration]
dependencies: []
---

# Wrap data import in a single transaction

## Problem Statement

`dataImportService.ts` imports tasks, hooks, and settings from legacy JSON files but each insert is a separate statement. If the process crashes mid-import, the database is left in a partial state with the marker file not yet written, causing a retry that may produce duplicates or inconsistencies.

## Findings

- `src/services/dataImportService.ts`: Individual repo calls without wrapping transaction
- Flagged by: security-sentinel, performance-oracle, data-integrity-guardian
- A transaction would also significantly speed up the import (single fsync instead of one per insert)

**Location:**
- `src/services/dataImportService.ts` — `importAll()` function

## Proposed Solutions

### Option A: Wrap entire import in db.transaction()
- Use `better-sqlite3`'s `db.transaction()` to wrap all inserts
- Write marker file only after transaction commits
- **Pros:** Atomic — all or nothing, faster (single fsync), simple
- **Cons:** None significant
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Option A — `better-sqlite3` transactions are straightforward and this is the standard pattern.

## Technical Details

**Affected files:**
- `src/services/dataImportService.ts`

## Acceptance Criteria

- [ ] All inserts during import wrapped in a single transaction
- [ ] Marker file written only after successful commit
- [ ] `npm test` passes
- [ ] Import is faster for large datasets

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | Multiple agents flagged atomicity concern |

## Resources

- better-sqlite3 transaction docs
- PR branch: `db-migration-195`
