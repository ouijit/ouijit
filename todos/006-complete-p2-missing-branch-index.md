---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, performance, database]
dependencies: []
---

# Add index on tasks(project_path, branch)

## Problem Statement

`taskRepo.getByBranch(projectPath, branch)` does a lookup by `(project_path, branch)` but there's no composite index for this. The existing index only covers `(project_path, status, "order")`. For projects with many tasks, branch lookups will be slow table scans.

## Findings

- `src/db/migrations/001-initial.ts`: Only index is `idx_tasks_project_status` on `(project_path, status, "order")`
- `src/db/repos/taskRepo.ts`: `getByBranch()` queries `WHERE project_path = ? AND branch = ?`
- `src/worktree.ts` and `src/taskLifecycle.ts` call `getByBranch()` frequently
- Flagged by: performance-oracle

**Location:**
- `src/db/migrations/001-initial.ts`

## Proposed Solutions

### Option A: Add index in 001-initial.ts migration
- Add `CREATE INDEX idx_tasks_project_branch ON tasks(project_path, branch)` to the initial migration
- Since no production databases exist yet (this is the first release), modifying the initial migration is safe
- **Pros:** Clean, no additional migration file needed
- **Cons:** None — no production DB to worry about
- **Effort:** Small
- **Risk:** Low

### Option B: Add a new 002-add-branch-index.ts migration
- Create a separate migration file
- **Pros:** Follows migration-per-change convention
- **Cons:** Unnecessary since no production DBs exist yet
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Option A — simpler since this is the initial release.

## Technical Details

**Affected files:**
- `src/db/migrations/001-initial.ts`

## Acceptance Criteria

- [ ] Index exists on `tasks(project_path, branch)`
- [ ] `npm test` passes
- [ ] `EXPLAIN QUERY PLAN` shows index usage for branch lookups

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | |

## Resources

- PR branch: `db-migration-195`
