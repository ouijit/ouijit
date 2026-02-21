---
status: pending
priority: p3
issue_id: "010"
tags: [code-review, quality]
dependencies: []
---

# Fix killExistingOnRun default inconsistency

## Problem Statement

The default value for `killExistingOnRun` differs between `getProjectSettings()` (returns `false` by default) and the database schema (column default may be different). This could lead to different behavior depending on which path reads the setting.

## Findings

- Flagged by: code-simplicity-reviewer
- Minor inconsistency that could cause subtle bugs

**Locations:**
- `src/db/index.ts` — `getProjectSettings()` default
- `src/db/migrations/001-initial.ts` — column default

## Proposed Solutions

### Option A: Align defaults
- Ensure the column DEFAULT and the code default match
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria

- [ ] Defaults are consistent across code and schema

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | |
