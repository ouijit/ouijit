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
- Why the obvious approach is not the one taken — only when a reader would
  otherwise change the code to it.
- What is not visible from here: which process it runs in, what a caller has to
  guarantee, what has to change alongside it.

Not that:

- Development history — what broke, what an earlier version did, what was
  tried. It dates immediately and belongs in the pull request.
- Taste — "reads better", "the noisiest thing on the page". Nothing to act on.
- The alternative you rejected, named to justify the code against it — "per
  spawn, not process.env", "a map rather than an array". Nobody was going to
  write the other one. It belongs in the commit message.
- Reasoning that fits any code — DRY, "single source of truth", "so the two
  cannot disagree". True of anything written once, so it says nothing about
  this.
- Anything the code already says. A comment restating a signature is a naming
  problem wearing a disguise.
- Guessing how a user feels about the result.
- Where it is called from, or how often. A caller changes that without touching
  this file.

Delete a comment rather than rewrite a weak one. Shortening a comment that
should not exist still leaves a comment that should not exist.

## Tests

Few and comprehensive beats many and narrow. One test that walks a behaviour
end to end is easier to read, and easier to keep true, than a wall of
one-assertion tests. Fold related cases together, and name a test after the
behaviour it pins rather than the function it calls.

Avoid mocks. The `integration` project runs against real git repos and real
databases under a tmpdir, and most of what is worth testing can be reached that
way — try it before reaching for `vi.mock`. A mocked module is code the suite
stops checking, so mocking one of ours means a regression inside it still
passes.

Where something genuinely cannot run — the network, a spawned agent CLI, the
clock — mock at that boundary and no further in, and make the fake honour the
real contract (`gh pr list --json` returning only the fields asked for), which
catches what a `mockResolvedValue` cannot.

Under jsdom that includes the terminal: `renderer` tests stub `terminalActions`
and `terminalReact` because xterm cannot construct there, and
`electron-log/renderer` because importing it hangs. Those are boundaries rather
than licence to mock our own modules, and they are why a renderer test can pass
while the spawn it stubbed is broken — behaviour that only shows up in a real
window belongs in `e2e/`.

Treat the mocks already in the suite as debt rather than as precedent. The
direction is cassettes — record a real interaction once and replay it, so the
fixture cannot drift from the contract the way a hand-written fake does. None
exist yet; adding a mock is a step away from that, so it should be the option
left after the others fail.

Assert on behaviour, not on the shape it is stored in. A test that reads the
persisted JSON or a private key format fails when those change and passes when
the behaviour breaks.

Imports go at the top of the file, above `vi.mock` and `vi.hoisted` — vitest
hoists those itself, so nothing has to move to accommodate them.

Don't test `src/db/migrations/*` — not for a new column, not for
re-runnability. A test that chains the earlier migrations to rebuild the prior
schema duplicates that schema and drifts from it, and the runner exercises the
real thing on every launch. Cover migration-backed behaviour where it is used,
if it needs covering at all.

Where a test goes, per `vitest.config.ts`:

- `src/__tests__/*.test.ts` — `unit`, node environment.
- `src/__tests__/integration/**` — `integration`, real git repos and databases
  under a tmpdir.
- `src/__tests__/renderer/**/*.test.tsx` — `renderer`, jsdom.
- `e2e/*.test.ts` — Playwright, driving a real Electron window.

`npm test` and `npm run test:e2e` each rebuild better-sqlite3 for their own ABI
in a pre-hook, so run them separately. `npm run test:full` chains the two
without a rebuild between and cannot pass both halves.
