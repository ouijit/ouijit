---
title: Making your codebase ready for parallel work
description: A worktree isolates the files. Ports, databases, env files, lockfiles, the stash and your browser are still shared.
date: 2026-11-08
cover:
  field: { wash: prism, angle: 150 }
  system: { motif: fan }
---

A worktree is a copy of the files and nothing else. The port is still one per machine. So is the database, the cache, and the login in your browser. Run two agents against them and they collide.

![Three worktrees, each with its own files, all pointing at one row of shared machine resources](/assets/writing/parallel-work-ready/shared.svg "Each worktree gets its own files. The row underneath is one per machine.")

A container per agent fixes most of this in one move. If you have one, you can stop here.

## One id per tree

A value that is one per machine becomes one per tree when something unique to the tree goes into its name. The only thing a worktree has that the others don't is its path. Hash it once and derive everything else from the hash:

```sh title="tree-env.sh"
root=$(git rev-parse --show-toplevel)
hash=$(printf %s "$root" | shasum | cut -c1-8)
n=$((16#${hash:0:3} % 1000))

export TREE_ID=$hash
export TREE_PORT=$((3000 + n))
export TREE_DB=app_$hash
export TREE_HOST=$hash.localhost
export COMPOSE_PROJECT_NAME=app-$hash
```

Source it from whatever starts work in a tree: your shell profile, a `direnv` `.envrc`, the dev script. If you assign trees numbers anyway, use the number instead of the hash and drop the modulo. Ouijit numbers its tasks and runs a start hook when one begins, with the number in `OUIJIT_TASK_NUMBER`; that hook is where this file gets sourced.

The hash is stable for the life of the tree, so the same tree always gets the same port and database.

## Ports

Two dev servers, one port 3000. The second one fails. Or worse, it takes 3001 and says so in the log, while the agent keeps hitting 3000.

If only the app or the tests talk to a server, bind port 0 and let the OS pick, then hand the URL to whoever needs it, printed or in the environment of the process you spawn. Ouijit's API server does that for the agent's terminal.

If you open it in a browser, you need to know the port, so take it from the tree:

```sh
npm run dev -- --port $TREE_PORT --strictPort
```

Make it strict. Rails and Django fail on a taken port on their own. Vite needs `--strictPort`. Next.js slides to the next free port and has no flag to stop it, so check the port is free before you start it.

An app with several servers needs several ports. Give each tree a block: `TREE_PORT` for the frontend, `TREE_PORT + 1` for the API, and so on, with `n` multiplied by the block size so blocks don't overlap.

## Databases and app state

Two branches with different migrations open the same database. Whichever runs second finds a schema it has never seen, and the error points at the migration, not at the other tree.

Key the database by the tree. For Postgres that is a database per tree, created when the tree is and dropped with it:

```sh
createdb "$TREE_DB" 2>/dev/null || true
DATABASE_URL=postgres://localhost/$TREE_DB npm run migrate
```

The same rule covers a Redis key prefix, a Docker volume, or an app's own state folder. Electron keeps app state in a per-user folder, so in development every checkout of a repo would share one database. Ouijit hashes its repo path into that folder's name:

```ts title="src/main.ts"
const repoHash = createHash('sha256').update(app.getAppPath()).digest('hex').slice(0, 8);
app.setPath('userData', `${app.getPath('userData')}-dev-${repoHash}`);
```

Per-tree databases also mean per-tree seeding. If seeding takes minutes, seed once into a template and copy it: `createdb -T app_seed "$TREE_DB"` in Postgres, a file copy in SQLite.

Two branches that both add migration 42 still collide, at merge. That's a merge conflict.

## Env files and node_modules

A fresh worktree has the tracked files and nothing git ignores, so no `.env` and no `node_modules`. You either install again, or copy the ignored files from the main checkout. Copying is faster. On APFS, btrfs and XFS it's a copy-on-write clone and takes seconds:

```sh
cd path/to/main && git ls-files --others --ignored --exclude-standard --directory -z \
  | xargs -0 -I{} cp -Rc {} path/to/tree/{}
```

That's macOS. On Linux, `cp -R --reflink=auto`. Ouijit does this on every task by default and calls it quick start. The copy is the main checkout's `node_modules`, so a branch that changes the lockfile still has to install, and its stale build output comes along too. Build clean before you trust a test result.

After the copy, every tree has the same `.env`. If there's a port or a database URL in it, every tree reads the same one. Anything that has to differ per tree stays out of the copied file. Export it from `tree-env.sh`, or write it to `.env.local`. Vite and Next.js read `.env.local` after `.env`. Plain dotenv reads only the file you point it at.

## Caches and fixed paths

Caches inside the tree are fine. Vite's lives under `node_modules/.vite` and a native module's build in its package. They come along with the copy or get rebuilt, and either way no other tree sees them.

Caches outside the tree are mostly fine too, when they're keyed by content or by path. Turborepo and Nx hash the inputs. Jest keys its cache on the project path. Playwright's browsers, `~/.m2`, `~/.cargo/registry` and the Docker build cache are meant to be shared.

The ones that collide are keyed by a fixed name: a socket at `/tmp/myapp.sock`, a build that writes to `/tmp/myapp-dist`, or a tool that keeps per-project state under your home directory keyed by the project's name, which every worktree shares. Put `$TREE_ID` in the name, or move the file into the tree.

## Lockfiles

Two agents each add a dependency, and each branch is fine on its own. Merge them and `package.json` conflicts, and so does the lockfile. Fix `package.json` by hand, then run the install. npm, Yarn and pnpm all notice conflict markers in their own lockfile and regenerate it from `package.json`.

Write that down where the agent reads it. An agent that doesn't know will pick a side with `git checkout --theirs` and ship a lockfile missing one of the two dependencies.

## Git

Worktrees share one `.git`, so they share its hooks, its config and its stash, and a branch can be checked out in only one of them. An agent that stashes and later pops can pop another agent's work. Tell the agent, in the repo's instructions, to make a WIP commit instead and squash it before review.

One checkout per branch also means the agent can't `git checkout main` inside its tree while the main checkout has it. To look at main, use `git show main:path/to/file` or `git diff main...`.

## The browser

Cookies don't care about the port. Two dev servers on `localhost` share a login, so signing in to one tree's app signs you in, or out, of the other's. Give each tree a hostname. `$TREE_HOST` is `3f9a2c1e.localhost`, and Chrome and Firefox resolve any `*.localhost` to loopback with no setup. Safari didn't before macOS 26, and the agent's tooling still doesn't: curl and Node on macOS need a hosts entry, and an OAuth redirect URI registered for `localhost` needs a second one.

## Docker

There's one Docker daemon. Compose prefixes containers, networks and volumes with the project name, which defaults to the directory name, so worktrees get distinct ones. A copied `.env` that sets `COMPOSE_PROJECT_NAME` to a fixed value takes that away, which is why `tree-env.sh` sets it per tree.

A hard-coded `container_name:`, a volume with an explicit `name:` and a host port mapping like `5432:5432` all skip the prefix. The first two collide the moment a second tree runs `compose up`. The third needs `"${TREE_PORT}:5432"` and a `DATABASE_URL` that agrees.

## Merging and teardown

When the branch is done, its tree can't merge into `main`, because `main` is checked out in the main checkout. Either merge from there, or push the branch and open a pull request.

Then remove the tree and everything it created outside itself:

```sh
git worktree remove path/to/tree && git branch -D the-branch
dropdb "$TREE_DB"
COMPOSE_PROJECT_NAME=app-$TREE_ID docker compose down -v
```

`git worktree prune` cleans up after a tree that was deleted by hand.

## Before you start

- One script derives a port, a database name, a hostname and a Compose project from the tree, and everything that starts a tree sources it.
- Every port binds to 0 or comes from the script, and fails if it's taken.
- Every database, volume and cache outside the tree carries the tree id in its name.
- `.env` holds only values that are the same in every tree.
- No build step writes to a fixed path.
- The agent's instructions say to let the package manager resolve the lockfile, and to commit instead of stash.
- A login that assumes `localhost` has a hostname per tree.
- Teardown drops what the script created.
