---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, performance]
dependencies: []
---

# Use prepared statements in reorder loops

## Problem Statement

`taskRepo.reorder()` runs unprepared SQL statements inside a loop when compacting column order. Each iteration re-parses the SQL string. While `better-sqlite3` caches prepared statements internally, explicitly preparing them is clearer and ensures optimal performance for hot paths.

## Findings

- `src/db/repos/taskRepo.ts`: `reorder()` method loops over tasks updating order values
- Flagged by: performance-oracle, kieran-typescript-reviewer
- For kanban boards with many tasks, this could be noticeable

**Location:**
- `src/db/repos/taskRepo.ts` — `reorder()` method

## Proposed Solutions

### Option A: Prepare statement once, execute in loop
- `const stmt = db.prepare('UPDATE tasks SET "order" = ? WHERE id = ?')` outside the loop
- Call `stmt.run(order, id)` inside the loop
- Wrap in `db.transaction()` for atomicity
- **Pros:** Clear intent, optimal performance, atomic
- **Cons:** Minor refactor
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Option A

## Technical Details

**Affected files:**
- `src/db/repos/taskRepo.ts`

## Acceptance Criteria

- [ ] Reorder uses a prepared statement
- [ ] Reorder wrapped in transaction
- [ ] `npm test` passes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | |

## Resources

- PR branch: `db-migration-195`
