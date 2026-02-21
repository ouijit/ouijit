---
status: pending
priority: p1
issue_id: "002"
tags: [code-review, architecture, claude-md-violation]
dependencies: []
---

# Remove dynamic import in addProject()

## Problem Statement

`addProject()` in `src/db/index.ts` uses a dynamic `import()` to pull in `scanner.ts`, violating the CLAUDE.md rule: "No dynamic imports — never use `import()` for lazy loading or code splitting." This was done to avoid a circular dependency, but CLAUDE.md explicitly says to use the `projectRegistry` pattern or restructure instead.

## Findings

- `src/db/index.ts`: `addProject()` uses `const { scanForProjects } = await import('./scanner')`
- Flagged by: kieran-typescript-reviewer, code-simplicity-reviewer, architecture-strategist
- CLAUDE.md states: "Vite handles circular dependencies fine for functions called inside handlers (not at module evaluation time)"

**Location:**
- `src/db/index.ts` — `addProject()` function

## Proposed Solutions

### Option A: Static import at top of file
- Since `scanForProjects` is only called inside an async handler (not at module evaluation), the circular dependency is safe with static imports per CLAUDE.md guidance
- **Pros:** Simple, follows rules, Vite handles it
- **Cons:** None — CLAUDE.md explicitly says this works
- **Effort:** Small
- **Risk:** Low

### Option B: Extract addProject to separate module
- Move `addProject` to its own module that imports both `db` and `scanner`
- **Pros:** No circular dependency at all
- **Cons:** More files
- **Effort:** Medium
- **Risk:** Low

## Recommended Action

Option A — CLAUDE.md explicitly says Vite handles circular deps for functions called inside handlers.

## Technical Details

**Affected files:**
- `src/db/index.ts`

## Acceptance Criteria

- [ ] No `import()` calls in `src/db/index.ts`
- [ ] Static import of `scanForProjects` at top of file
- [ ] `npm run check` passes
- [ ] `npm test` passes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | Violates explicit CLAUDE.md rule |

## Resources

- CLAUDE.md: "No dynamic imports" rule
- PR branch: `db-migration-195`
