---
status: pending
priority: p3
issue_id: "011"
tags: [code-review, testing]
dependencies: []
---

# Isolate test that touches real ~/Ouijit/ filesystem

## Problem Statement

The `taskMetadata.migration.test.ts` test for "imports added projects from added-projects.json" reads and writes to the real `~/Ouijit/added-projects.json` file. While it saves and restores the original content, this is fragile and can interfere with a running instance of the app.

## Findings

- `src/__tests__/taskMetadata.migration.test.ts`: test reads/writes real `~/Ouijit/added-projects.json`
- Flagged by: security-sentinel

**Location:**
- `src/__tests__/taskMetadata.migration.test.ts` — "imports added projects" test

## Proposed Solutions

### Option A: Mock fs operations for added-projects.json
- Use vi.mock to intercept the specific file read
- **Effort:** Medium
- **Risk:** Low

### Option B: Use a temp directory
- Override the path used by the import service during tests
- **Effort:** Medium
- **Risk:** Low

## Acceptance Criteria

- [ ] Test doesn't touch real filesystem outside temp dirs

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | |
