---
status: pending
priority: p2
issue_id: "007"
tags: [code-review, data-integrity]
dependencies: []
---

# Fix hook id not updated on upsert conflict

## Problem Statement

`hookRepo.upsert()` uses `ON CONFLICT(project_path, type) DO UPDATE` but doesn't update the `id` column in the SET clause. If a hook is saved with a new `id` but the same `(project_path, type)`, the old `id` persists in the database, creating a mismatch between what the caller thinks the `id` is and what's stored.

## Findings

- `src/db/repos/hookRepo.ts`: upsert SQL updates `name` and `command` but not `id`
- Flagged by: data-integrity-guardian

**Location:**
- `src/db/repos/hookRepo.ts` — `upsert()` method

## Proposed Solutions

### Option A: Add id to the UPDATE SET clause
- `SET id = excluded.id, name = excluded.name, command = excluded.command`
- **Pros:** Simple one-line fix
- **Cons:** None
- **Effort:** Small
- **Risk:** Low

### Option B: Ignore — id is not used as a reference key
- If `id` is never used for lookups (only `(project_path, type)` matters), this is harmless
- **Pros:** No change needed
- **Cons:** Inconsistent data
- **Effort:** None
- **Risk:** Low

## Recommended Action

Option A — keep data consistent even if `id` isn't currently used for lookups.

## Technical Details

**Affected files:**
- `src/db/repos/hookRepo.ts`

## Acceptance Criteria

- [ ] Upsert updates `id` column on conflict
- [ ] `npm test` passes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | |

## Resources

- PR branch: `db-migration-195`
