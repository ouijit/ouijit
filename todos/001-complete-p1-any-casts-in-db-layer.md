---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, typescript, quality]
dependencies: []
---

# Remove `any` casts in database and import service

## Problem Statement

Multiple `any` type assertions are used in `src/db/database.ts` and `src/services/dataImportService.ts`, bypassing TypeScript's type safety. This defeats the purpose of TypeScript and can hide real bugs during refactoring.

## Findings

- `database.ts`: `(db as any).pragma(...)` cast used for pragma calls
- `dataImportService.ts`: `any` casts when reading/parsing JSON files and mapping data to repo methods
- Multiple agents flagged this: kieran-typescript-reviewer, security-sentinel

**Locations:**
- `src/db/database.ts`
- `src/services/dataImportService.ts`

## Proposed Solutions

### Option A: Proper typing with better-sqlite3 types
- Use `Database` type from `better-sqlite3` directly — `.pragma()` is a real method on the type
- For JSON parsing, define interfaces for the legacy JSON file shapes
- **Pros:** Full type safety, catches bugs at compile time
- **Cons:** More code for legacy format interfaces
- **Effort:** Small
- **Risk:** Low

### Option B: Use `unknown` + type guards
- Replace `any` with `unknown` and add runtime type guards
- **Pros:** Safer than `any`, validates at runtime
- **Cons:** More verbose
- **Effort:** Medium
- **Risk:** Low

## Recommended Action

Option A — the `better-sqlite3` types already support `.pragma()`, and the legacy JSON shapes are small and well-known.

## Technical Details

**Affected files:**
- `src/db/database.ts`
- `src/services/dataImportService.ts`

## Acceptance Criteria

- [ ] Zero `as any` casts in `src/db/` and `src/services/`
- [ ] `npm run check` passes
- [ ] `npm test` passes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from code review | Multiple agents flagged |

## Resources

- PR branch: `db-migration-195`
