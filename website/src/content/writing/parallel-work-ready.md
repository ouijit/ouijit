---
title: Making your codebase ready for parallel work
description: A worktree isolates the files. Ports, databases, env files, lockfiles, the stash and your browser are still shared.
date: 2026-11-08
cover:
  motif: fan
  wash: prism
  angle: 150
---

A git worktree gives each agent its own copy of the files. It does not give it its own port, database, cache or browser. Those live outside the tree, and when several worktrees point at the same one, the agents overwrite each other without any of them doing anything wrong.

![Three worktrees, each with its own files, all pointing at one row of shared machine resources](/assets/writing/parallel-work-ready/shared.svg "Each worktree gets its own files. The row underneath is one per machine.")

A container per agent solves most of this in one move. The rest of this assumes you don't have one.

Ouijit creates a worktree for every task, and I hit most of these in its own repo. Where I did, the fix is in its code. The browser and Docker ones are what a web app with a login hits, which Ouijit is not.

## Databases and app state

An Electron app keeps its state in a per-user folder, and in development every checkout of the repo would use the same one. Two branches with different migrations open the same SQLite file, and the second one to run finds a schema it doesn't recognise.

The fix is to derive the folder from the path of the worktree. In dev mode Ouijit hashes its own repo path and appends it to the userData folder, so each worktree has its own database and production data is never touched:

```ts title="src/main.ts"
const repoHash = createHash('sha256').update(app.getAppPath()).digest('hex').slice(0, 8);
app.setPath('userData', `${app.getPath('userData')}-dev-${repoHash}`);
```

The same rule covers anything in a shared location: a Postgres database name, a Redis key prefix or a Docker volume. It also takes care of the local half of the migration problem: each tree migrates its own copy, and wiping one tree's data leaves the others alone. Two branches that both add migration 42 still collide at merge. That is a merge conflict, not an isolation problem.

## Ports

Two dev servers on one port is the collision you hit first. The second `npm run dev` either fails or, worse, picks the next free port while the agent keeps hitting the one from its config.

For a server only the app or the tests talk to, bind port 0 and let the OS choose. Ouijit's local API server does this and hands its URL to the agent's terminal in an environment variable.

For a dev server you open in a browser, derive the port from something unique to the tree. The task number is the simplest. Ouijit's start hook, the command it runs when a task begins, already has it in the environment:

```sh title="start hook"
npm run dev -- --port $((3000 + OUIJIT_TASK_NUMBER)) --strictPort
```

Turn on strict port, or your framework's equivalent, so a collision fails loudly instead of sliding to the next free port and recreating the problem above. Ouijit's own dev server hashes the worktree path into a port range instead, and gets away with the small collision chance only because Electron Forge tells the app which port was actually bound. If you type the URL into a browser yourself, use the task number.

## Env files

Secrets are gitignored, so a fresh worktree has none. Ouijit's quick start copies everything git ignores into the new tree, so `.env` and `node_modules` arrive without a reinstall. On APFS, btrfs and XFS that is a copy-on-write clone and takes seconds; on ext4 it is a full copy. Either way the `node_modules` you get is the main checkout's, so a branch that changes the lockfile still has to install.

Whatever is in `.env` is now in every worktree, identical. If it holds a port or a database URL, every tree reads the same one. Keep the values that must differ per tree out of the file, and have the start hook export them or write them to `.env.local`, which most loaders read after `.env`.

## Caches and fixed paths

Most caches live inside the tree. Vite's is under `node_modules/.vite`, a native module's build is in its package, and both come along with the copy. So does stale build output from the main checkout, so do a clean build before trusting a test result.

The ones that collide are keyed by a fixed name instead of the path: a socket at `/tmp/myapp.sock`, a build that writes to `/tmp/myapp-dist`, or a tool that keeps per-project state under your home directory keyed by the project's name, which every worktree shares. Put the path in the name, or move the file into the tree. Ouijit's end-to-end tests set a userData path per run for the same reason.

## Lockfiles

Two agents each add a dependency. Both branches are fine on their own, and `package.json` and the lockfile both conflict on merge. Resolve `package.json` by hand, then run the install. npm, Yarn and pnpm all notice conflict markers in their own lockfile and regenerate it from `package.json`, so there is nothing to merge by hand. Write that down where the agent will read it, because an agent that doesn't know will pick a side with `git checkout --theirs` and get a lockfile missing one of the two dependencies.

## What stays shared

Worktrees share one `.git` directory: one set of git hooks, one config, one stash stack, and one checkout per branch, so two trees cannot have the same branch out. An agent that runs `git stash` and later `git stash pop` can pop another agent's work. Tell the agent, in the repo's instructions, to make a WIP commit instead, and squash it before the branch goes for review.

Your browser is shared too. Cookies ignore the port, so two dev servers on `localhost` share a login: signing in to one tree's app signs you in, or out, of the other's. A hostname per tree, such as `t607.localhost`, separates them in Chrome and Firefox with no setup. The agent's own tooling may not: curl and Node on macOS need a hosts entry, and an OAuth redirect URI registered for `localhost` needs a second entry.

The Docker daemon is one per machine. Compose prefixes containers, networks and volumes with the project name, which defaults to the directory name and is unique per worktree, unless a copied `.env` sets `COMPOSE_PROJECT_NAME` and makes it the same everywhere. A host port mapping like `5432:5432` is not covered by any of that, and needs a port from the task number like the dev server's.

## Before you start

- Every port binds to 0 or derives from the worktree, and fails if it can't.
- Every database, volume and cache outside the tree derives from the worktree.
- `.env` holds only values that are the same in every tree.
- No build step writes to a fixed path.
- The agent's instructions say to let the package manager resolve the lockfile, and to commit instead of stash.
- A login that assumes `localhost` has a hostname per tree.

None of this is about agents. Two checkouts of one repo on one machine were always allowed to collide like this. Agents are the first thing that does it all day.
