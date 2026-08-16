# Contributing to Ouijit

## Comments

A comment explains a constraint the code must satisfy, or a trap it avoids.
Anything that was only true while the code was being written belongs in the
pull request instead.

Four things to leave out. Development history — what broke, what an earlier
version did, what was tried and rejected — is the record of getting here, and
the pull request is where that record belongs. Taste is not a constraint:
whether something reads better or looks noisy gives the next reader nothing to
act on. Reasoning that would fit any code, such as DRY or "so the two cannot
disagree", is true of anything written once instead of twice, so it says
nothing about the code under it. And a comment that restates the signature
costs a line and returns nothing.

What earns a comment is a fact that outlives the writing of it: a constraint
imposed from outside, by git or GitHub's API or the DOM or an agent CLI's
flags; an invariant the code has to hold, and what breaks when it does not; why
the obvious approach is not the one taken, stated as a property of the code
rather than as the story of finding out; or something a reader cannot see from
where they are standing, like who else calls this and what has to change with
it.

If a comment would fit as a review comment on the commit that introduced it, it
does not belong in the code. Prefer deleting a comment to rewriting a weak one.
