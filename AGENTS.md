# Ouijit

## Comments

A comment says what the code has to keep being true. Anything that was only
true while the code was being written belongs in the pull request instead.

The test: if it would fit as a review comment on the commit that introduced it,
it does not go in the code.

### Do not write

**Development history** — what broke, what an earlier version did, what was
tried and rejected.

```ts
// ✗ Pinning the base failed silently, which left it prunable by `git gc`.
// ✓ git's ref store is a filesystem, so a ref at `refs/ouijit/pr/12` makes
//   `refs/ouijit/pr/12/base` uncreatable.
```

**Taste** — what reads better, what deserves what, how something feels.

```ts
// ✗ The line numbers are the least useful part, so the range is dimmed.
// ✓ Splits `@@ -12,7 +12,10 @@ export function readToken()` into range and context.
```

**Reasoning that would fit any code** — DRY, single source of truth, "so the
two cannot disagree". True of everything written once instead of twice, so it
says nothing about the code under it.

```ts
// ✗ One mapper for both paths, so a field added here cannot miss one.
// ✓ The kanban card and the terminal header both render this menu.
```

**The signature again.**

```ts
// ✗ /** Is the experimental flag on for this project? */
//   export async function isGithubEnabled(projectPath: string)
```

### Do write

- Constraints imposed from outside: git, GitHub's API, the DOM, an agent CLI's
  flags, SQLite.
- Invariants the code must hold, and what breaks when it does not.
- Why the obvious approach is not used, stated as a property of the code as it
  is now — not as the story of finding out.
- Facts a reader cannot see from here: who else calls this, what has to change
  with it, which process it runs in.

Prefer deleting a comment to rewriting a weak one. Code with no comment is
read; code with a comment that explains nothing is read twice.
