# Brainstorm: Testing Plan v2

**Date:** 2026-02-20
**Status:** Draft

## What We're Building

An improved testing plan for the Ouijit desktop app that:

1. **Provides refactoring safety** — the primary goal is catching breakage during active refactoring, not exhaustive coverage
2. **Supports multi-agent parallel development** — tests must be fully isolated so multiple AI agents can run them simultaneously in worktrees or VMs
3. **Offers a fast/full split** — a quick suite (<15s) for rapid validation during development, and a full suite (including e2e) for pre-commit/PR validation
4. **Includes an agent testing guide** — clear rules for when and how agents should add tests when modifying code

## Why This Approach (Hybrid — Approach C)

The existing TESTING-PLAN.md has solid bones: the 3-tier priority structure (pure functions → data layer → e2e) is the right mental model. Rather than rewriting from scratch, we enhance it with:

- **Agent-safety guarantees** — random ports, temp dirs per test run, no shared filesystem state, cache resets
- **Test split** — `npm test` (fast unit + integration) vs `npm run test:full` (everything including e2e)
- **IPC boundary tests** — the main/renderer interface is the most refactor-prone seam and is currently untested
- **Success criteria** instead of time estimates — measurable outcomes, not guesses
- **Agent testing guide** — so agents know the testing conventions without human guidance

## Key Decisions

### 1. Keep the 3-tier structure
The existing Tier 1 (pure functions) → Tier 2 (data layer) → Tier 3 (e2e) priority order is correct. Pure function tests have the highest ROI: fast, stable, zero mocking.

### 2. Full e2e plan stays
Despite the cost, all three e2e scenarios (project discovery, task creation, diff/merge) are worth building. The app is complex enough that integration-level confidence matters, especially when agents are making changes.

### 3. Leave hookRunner.ts and scanner.ts untested (for now)
Both are too integration-heavy to unit test well. Scanner involves filesystem traversal and native image loading. HookRunner is process spawning with timeout logic. E2e tests cover their critical paths indirectly. Not worth the mocking complexity.

### 4. Env var approach for e2e test isolation
`OUIJIT_TEST_SCAN_DIRS` in scanner.ts is pragmatic. Agents running in worktrees or VMs each get their own environment, so env vars provide clean isolation without complex mocking. This is a single line of production code that enables all e2e tests.

### 5. Two test commands
- `npm test` — Vitest only (Tier 1 + Tier 2). Target: <15 seconds. Agents run this constantly.
- `npm run test:full` — Vitest + Playwright e2e (all tiers). Target: <2 minutes. Run before committing or in CI.

### 6. Add projectSettings._resetCacheForTesting()
The existing `taskMetadata.ts` has `_resetCacheForTesting()`. `projectSettings.ts` uses the same caching pattern but lacks a reset function. The new plan should include adding one.

### 7. Add IPC boundary contract tests (new Tier 2 item)
The IPC layer (ipc.ts) is pure glue code, but it's the seam between main and renderer — exactly where refactoring breaks things. A lightweight contract test that verifies handler registration and basic input/output shapes would catch wiring regressions without testing implementation details.

## What Changes from the Current Plan

| Aspect | Current Plan | Improved Plan |
|--------|-------------|---------------|
| Test commands | `npm test` (single) | `npm test` (fast) + `npm run test:full` (all) |
| Time estimates | Specific (e.g., "~30 min") | Removed — replaced with success criteria |
| Agent guidance | None | Agent Testing Guide section |
| Test isolation | Implicit (temp dirs) | Explicit guarantees (random ports, cache resets, no shared state) |
| IPC testing | Excluded ("pure glue code") | Lightweight boundary contract tests |
| projectSettings cache | Not mentioned | Add `_resetCacheForTesting()` |
| hookRunner/scanner | Listed as gap but not planned | Explicitly excluded with rationale |

## What Stays the Same

- Tier 1: Git parsing, branch names, date formatting — unchanged
- Tier 2a: Project settings lifecycle — same approach, add cache reset
- Tier 2b: Task lifecycle integration — same approach
- Tier 3: All three e2e scenarios — same scope
- "What NOT to Test" — same exclusions
- Export `parseDiff` and `parseShortstat` from git.ts
- Playwright + Electron for e2e

## Agent Testing Guide (New Section)

Rules for agents modifying code:

1. **If you modify a pure function that has tests, run the tests and fix any failures**
2. **If you add a new pure function, add a test** — follow existing patterns in `src/__tests__/`
3. **If you modify IPC handlers, verify the contract tests still pass**
4. **If you modify data persistence (taskMetadata, projectSettings), run the integration tests**
5. **Always run `npm test` before committing**
6. **Run `npm run test:full` before creating a PR**
7. **Never modify test setup files (setup.ts) without understanding the impact on all tests**
8. **Use unique project paths per test to avoid cross-test contamination**

## Open Questions

None — all major questions resolved during brainstorming.
