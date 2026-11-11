---
title: Making your codebase ready for parallel skadoinking
description: A worktree isolates the files. Ports, databases, env files, lockfiles, the stash and your browser are still shared.
date: 2026-11-08
cover:
  field: { wash: prism, angle: 150 }
  system: { motif: fan }
---

An agent fixes a bug, starts the app, and the bug is still there, so it reverts the fix and tries another. Its dev server had found port 3000 taken and moved to 3001, and its requests went to the server in another worktree, which never had the fix.

When parallel agents collide over a shared database or port, the failure never mentions the other worktree, so each one fixes the wrong thing. A worktree separates the files and nothing else.

## One name per tree

Pick something unique to each tree and put it in the name of everything the trees would otherwise share. Take it from something that outlives the tree, like the branch name or a task number. A hash of the worktree path works while the tree exists, but once the tree is deleted nothing can recompute it, and teardown needs it.

```sh
id=$(git branch --show-current | tr '/' '-')
```

Ouijit numbers its tasks and hands the number to the hook it runs when a task starts.

## Ports

Whether a dev server moves off a taken port, and what stops it, depends on the server:

| Server | When the port is taken | To make it fail instead |
|---|---|---|
| Vite, SvelteKit, React Router | moves to the next free port | `--strictPort` |
| Next.js | moves, but only off the default port | pass the port with `-p` or `PORT` |
| Astro | moves to the next free port | `vite.server.strictPort` in the Astro config |
| Nuxt | moves to a random free port | check the port first |
| Hugo | moves, even when you passed `--port` | check the port first |
| Storybook | asks whether to use another port | `--exact-port`, and `--ci` to skip the question |
| Angular CLI | exits, but only checks `localhost` | check the port first |
| Rails, Django, Flask, Phoenix | exits with "address in use" | nothing to do |

Next.js is the one people get wrong in both directions. Its default of 3000 slides, so a tree that relies on the default can end up anywhere, but the same server given `-p 3000` refuses a taken port. Hugo goes the other way. Its source has a comment noting that a port set explicitly by the user was probably meant. The next line ignores it.

Angular's check has a gap that applies to every server here. Port 4200 held on `127.0.0.1` doesn't stop a server binding it on `::1`, and port 4200 held on the wildcard address doesn't stop one binding `localhost`. Angular warns about the second case and starts anyway. Two servers then answer on "port 4200", and which one a request reaches depends on how the client resolves `localhost`. A check in the start script that looks at every address closes that, along with the servers that have no option of their own:

```sh
lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null && { echo "port $PORT is taken"; exit 1; }
```

Servers that only your own code talks to, like an API behind a proxy or a server the tests spawn, don't need a chosen port. Bind port 0 and pass the real port along.

## Databases

Two trees on one database break each other's migrations. Branch B applies its migration 42, and branch A's code then hits a missing column, or A's runner complains that 42's checksum doesn't match. Nothing in either error says another tree touched the database, so the agent goes looking for a bug in its own migration.

Prisma, when it detects drift, offers to reset the database, which drops every table. Since version 6.15 it refuses to reset when an AI agent runs it, until the user consents through an environment variable, which moves the decision to the one party in the room who also doesn't know about the other worktree. Approving it wipes the database every tree shares. Put "never reset a database" in the agents' instructions whatever ORM you use.

You have to choose where the databases live. One Postgres on the host with a database per tree is cheap and seeds fast, because `createdb -T` copies a seeded template in seconds, as long as nothing is connected to the template. A Postgres container per tree is heavier and needs a host port per tree, but tearing down the Compose project takes the data with it. Pick one, and don't let the dev setup and the Compose file each assume the other.

## State keyed by the app

Some state is keyed by a name the repo never chose. Electron puts an app's data in a per-user folder named after the app, the keychain files an item under a service name, and a CLI tool writes to `~/.config/<tool>`. None of them know which checkout they were run from, and no config file sits between them and the name, so the fix goes in the app's code. Ouijit does it to its userData folder in development:

```ts title="src/main.ts"
const repoHash = createHash('sha256').update(app.getAppPath()).digest('hex').slice(0, 8);
app.setPath('userData', `${app.getPath('userData')}-dev-${repoHash}`);
```

| Where | Shared by | Per tree |
|---|---|---|
| Redis | key names on one instance | prefix keys with the tree name |
| Job queues | queue name | queue name carries the tree name |
| Search indexes | index name | an index per tree |
| MinIO or LocalStack | bucket name | a bucket per tree |
| Mail catchers | one inbox | a catcher per tree |
| Upload folders outside the tree | the path | the path carries the tree name |
| Scheduled jobs | the database they point at | point them at the tree's database, or run them in one tree |

## Env files and node_modules

A fresh worktree has no `.env` and no `node_modules`. Some tools that create worktrees for agents copy them from the main checkout, Ouijit among them, because a copy-on-write clone takes seconds and an install takes minutes.

The copy brings the main checkout's build output with it. An agent that runs the tests before building is testing the main checkout's code. The copy also brings one `.env` to every tree, so a port or database URL in it is the same everywhere. Values that differ per tree belong in whatever starts the tree, written after the copy.

## Caches

Caches inside the tree are fine, and so are caches outside it that are keyed by content or path, like Turborepo's, Nx's and Jest's. What breaks is anything at a fixed path. A build that writes to `/tmp/<app>` lets one tree run the other's output, so tests pass on code the branch doesn't have. A server that deletes a stale socket in `/tmp` before binding takes it from the tree already listening, and that tree's clients start talking to the wrong server. Put the tree name in the path.

## Lockfiles

Two agents each add a dependency, and merging the branches conflicts in `package.json` and in the lockfile. Resolve `package.json` and run the install, and npm, Yarn and pnpm all regenerate a lockfile that has conflict markers in it. An agent that doesn't know this resolves the lockfile with `git checkout --theirs` and ships it missing one of the two dependencies.

## Git

Worktrees share one `.git`, which means one stash. An agent that stashes and later pops can pop another agent's work into its own tree. A WIP commit, squashed before review, does the same job without the shared stack.

A branch can also be checked out in only one tree. An agent that runs `git checkout main` to look at it gets an error instead. `git show main:<path>` and `git diff main...HEAD` do what it wanted.

## The browser

A browser scopes most of what it stores to the origin, which is the scheme, the host and the port together, so localStorage and IndexedDB for `localhost:3001` and `localhost:3002` are already separate. Cookies predate the origin model and ignore the port. Every tree's app on `localhost` shares one cookie jar, so signing in or out of one does it for all of them. That catches you in your own browser, and it catches an agent driving a shared browser profile, such as your Chrome through a browser tool. Test runners like Playwright start each test with fresh cookies and are unaffected.

A hostname per tree, like `fix-auth.localhost`, separates the cookies. Chrome and Firefox resolve any `*.localhost` to loopback. Safari did not before macOS 26, and curl and Node still need a hosts entry. The cost is OAuth: providers want each redirect URI registered and most refuse wildcards, so either your app's dev login bypasses OAuth, or one tree gets the real login and the others don't.

## Docker

Compose prefixes what it creates with the project name, which defaults to the directory, so separate trees get separate containers. Three things skip the prefix. A `container_name:` makes the second tree's `compose up` fail with a name conflict, and the quick fix, removing the container in the way, takes down the other tree's database in the middle of its test run. A fixed host port like `5432:5432` fails the same way. A volume with a fixed `name:` doesn't fail at all: both trees mount it and share one database, with all the migration trouble above.

## Webhooks

A forwarder such as `stripe listen` or an ngrok tunnel points at one port, so webhooks reach one tree. Pay in another tree and the order never shows as paid, because the event went to the first tree's server and its database. The handler looks broken and isn't. Either run a forwarder per tree or test webhooks in one tree at a time, and tell the agents which.

## Merging and teardown

A tree can't merge into `main` while the main checkout has it out, so the merge happens there or through a pull request. `git worktree remove` deletes the directory and nothing else. The tree's database, containers and volumes stay, and a container left running keeps its host port, so a later tree's `compose up` fails on a port no live tree is using. Teardown removes everything named after the tree.

## For your agents' instructions

Most of the damage is an agent doing something reasonable in a single checkout. These go in `AGENTS.md`, `CLAUDE.md`, or wherever your agents read their rules:

```md
- Other agents work in other worktrees of this repo at the same time.
- Never reset, drop or recreate a database. If migrations disagree, stop and report it.
- Use the port in $PORT. If it's taken, stop. Never fall back to another port.
- Build before running tests; build output may have been copied from another checkout.
- Never use git stash. Make a WIP commit instead.
- On a lockfile conflict, resolve package.json and rerun the install. Never pick a side.
- Don't check out main. Use `git show main:<path>` or `git diff main...HEAD`.
```
