# Ouijit

## Comments

The default is none. Prefer code that needs none: a better name, a smaller
function, or a clearer structure explains itself and cannot fall out of date.
If a comment's value would disappear by fixing the code, fix the code.

A comment has to earn its place against a standing cost — it dates, it gets
skimmed, and every weak one makes the next reader trust the strong ones less.
So the test is not "is this true and on topic". It is "would a competent reader
get this wrong without it, and would that cost them something". Anything a
reader works out in the seconds it takes to read the code below it is not worth
writing down. A comment longer than the code it sits above is almost never the
right call. In doubt, write nothing.

The categories below are necessary, not sufficient — fitting one is what makes
a comment eligible, not what makes it worth writing:

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

Delete a comment rather than rewrite a weak one. Shortening a comment that
should not exist still leaves a comment that should not exist.
