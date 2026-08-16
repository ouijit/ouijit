# Ouijit

## Comments

Prefer code that needs none. A better name, a smaller function, or a clearer
structure explains itself and cannot fall out of date. If a comment's value
would disappear by fixing the code, fix the code.

What is left is what code cannot say about itself, and only that is worth a
comment:

- A constraint from outside — git, GitHub's API, the DOM, SQLite, an agent
  CLI's flags. ("git's ref store is a filesystem, so a ref at
  `refs/ouijit/pr/12` blocks one at `refs/ouijit/pr/12/base`.")
- An invariant that spans more than one place, and what breaks without it.
- Why the obvious approach is not the one taken.
- What is not visible from here: who else calls this, what has to change with
  it, which process it runs in.

Not that:

- Development history — what broke, what an earlier version did, what was
  tried. It dates immediately and belongs in the pull request.
- Taste — "reads better", "the noisiest thing on the page". Nothing to act on.
- Reasoning that fits any code — DRY, "single source of truth", "so the two
  cannot disagree". True of anything written once, so it says nothing about
  this.
- Anything the code already says. A comment restating a signature is a naming
  problem wearing a disguise.
- Guessing how a user feels about the result.

Delete a comment rather than rewrite a weak one.
