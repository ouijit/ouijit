# Ouijit

Conventions: [CONTRIBUTING.md](CONTRIBUTING.md). Comments, by example:

```ts
// ✗ Pinning the base failed silently, which left it prunable by `git gc`.
// ✓ git's ref store is a filesystem, so a ref at `refs/ouijit/pr/12` makes
//   `refs/ouijit/pr/12/base` uncreatable.

// ✗ Without this, every reconnectTerminal would have run activateLast.
// ✓ reconnectTerminal calls activateLast, so without this whichever PTY
//   reconnects last takes the selection.

// ✗ The line numbers are the least useful part, so the range is dimmed.
// ✓ Splits `@@ -12,7 +12,10 @@ export function readToken()` into range and context.

// ✗ A checkbox that waits for a round trip to tick is one you press twice.
// ✓ Applied here and written behind; the write reverts it on failure.

// ✗ One mapper for both paths, so a field added here cannot miss one.
// ✓ The kanban card and the terminal header both render this menu.

// ✗ Two hairlines running the height of every diff was the noisiest thing
//   on the page.
// ✓ One rule at the edge of the gutter, not a second between the two
//   number columns.

// ✗ /** Is the experimental flag on for this project? */
//   export async function isGithubEnabled(projectPath: string)
// ✓ export async function isGithubEnabled(projectPath: string)
```

Delete a comment rather than rewrite a weak one.
