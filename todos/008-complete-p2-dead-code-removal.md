---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, quality, dead-code]
dependencies: []
---

# Remove dead code (getById, updateIcon, redundant patterns)

## Problem Statement

Several methods and patterns in the new DB layer are unused or redundant:
- `projectRepo.getById()` — no callers
- `projectRepo.updateIcon()` — no callers
- Read-before-write pattern in some wrapper functions that check existence then insert, when a simple upsert or INSERT OR IGNORE would suffice

## Findings

- `src/db/repos/projectRepo.ts`: `getById()` and `updateIcon()` have no callers in the codebase
- `src/db/index.ts`: Some functions read data, check if it exists, then write — could be simplified
- Flagged by: code-simplicity-reviewer, kieran-typescript-reviewer

**Locations:**
- `src/db/repos/projectRepo.ts` — `getById()`, `updateIcon()`
- `src/db/index.ts` — various wrapper functions

## Proposed Solutions

### Option A: Delete unused methods, simplify wrappers
- Remove `getById()` and `updateIcon()` from projectRepo
- Simplify read-before-write patterns where applicable
- **Pros:** Less code to maintain, clearer intent
- **Cons:** May need them later (but YAGNI)
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Option A — follow YAGNI, remove what's not used.

## Technical Details

**Affected files:**
- `src/db/repos/projectRepo.ts`
- `src/db/index.ts`

## Acceptance Criteria

- [ ] No unused methods in repo classes
- [ ] `npm run check` passes
- [ ] `npm test` passes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | |

## Resources

- PR branch: `db-migration-195`
