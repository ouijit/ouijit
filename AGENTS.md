# Ouijit

## Comments

Write:

- A constraint from outside the code — git, GitHub's API, the DOM, SQLite, an
  agent CLI's flags — because nothing in the file says it. ("git's ref store is
  a filesystem, so a ref at `refs/ouijit/pr/12` blocks one at
  `refs/ouijit/pr/12/base`.")
- An invariant, and what breaks without it, so the next edit knows the edge it
  is working near.
- Why the obvious approach is not the one taken, as a property of the code as
  it stands.
- What is not visible from here: who else calls this, what has to change with
  it, which process it runs in.

Avoid:

- Development history — what broke, what an earlier version did, what was
  tried. It dates immediately and belongs in the pull request.
- Taste — "reads better", "the noisiest thing on the page". Nothing to act on.
- Reasoning that fits any code — DRY, "single source of truth", "so the two
  cannot disagree". True of anything written once, so it says nothing about
  this.
- Restating the signature.
- Guessing how a user feels about the result.

Delete a comment rather than rewrite a weak one.
