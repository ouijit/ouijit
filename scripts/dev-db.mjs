#!/usr/bin/env node
// Dev DB helpers. Operates on this worktree's isolated dev userData DB only —
// production data and other worktrees' dev data are untouched.
//
// Usage:
//   node scripts/dev-db.mjs reset        Delete dev DB + seed project (next launch = first-launch)
//   node scripts/dev-db.mjs seed         Create the demo project used in marketing screenshots
//   node scripts/dev-db.mjs clone-prod   Copy prod DB into this worktree's dev DB
//   node scripts/dev-db.mjs path         Print the dev userData dir for this worktree

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function devDbDir() {
  const repoHash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 8);
  const suffix = `-dev-${repoHash}`;
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', `ouijit${suffix}`);
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, `ouijit${suffix}`);
}

function prodDbDir() {
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'ouijit');
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'ouijit');
}

function dbPath() {
  const dir = devDbDir();
  if (!/-dev-[0-9a-f]{8}$/.test(dir)) {
    throw new Error(`Refusing to operate on non-dev path: ${dir}`);
  }
  return join(dir, 'ouijit.db');
}

function seedProjectDir() {
  return join(devDbDir(), 'seed-project');
}

function exec(sql) {
  const result = spawnSync('sqlite3', [dbPath(), sql], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `sqlite3 exited ${result.status}\n`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function cloneProd() {
  const srcDir = prodDbDir();
  const srcDb = join(srcDir, 'ouijit.db');
  if (!existsSync(srcDb)) {
    process.stderr.write(`Prod DB not found at ${srcDb}\n`);
    process.exit(1);
  }

  const dstDir = devDbDir();
  if (!/-dev-[0-9a-f]{8}$/.test(dstDir)) {
    throw new Error(`Refusing to write to non-dev path: ${dstDir}`);
  }
  mkdirSync(dstDir, { recursive: true });

  // Wipe any existing dev DB so the backup lands on a clean target.
  for (const ext of ['', '-wal', '-shm']) {
    const f = join(dstDir, `ouijit.db${ext}`);
    if (existsSync(f)) rmSync(f);
  }

  const dstDb = join(dstDir, 'ouijit.db');
  // sqlite3 .backup is an online backup — safe even if the prod app is running.
  const result = spawnSync('sqlite3', [srcDb, `.backup '${dstDb.replace(/'/g, "''")}'`], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `sqlite3 .backup exited ${result.status}\n`);
    process.exit(result.status ?? 1);
  }

  console.log(`Cloned prod DB → ${dstDb}`);
  console.log('Migrations will run on next launch of the dev app in this worktree.');
}

function reset() {
  const dir = devDbDir();
  let removed = 0;
  for (const ext of ['', '-wal', '-shm']) {
    const f = join(dir, `ouijit.db${ext}`);
    if (existsSync(f)) {
      rmSync(f);
      removed++;
    }
  }
  const seedDir = seedProjectDir();
  if (existsSync(seedDir)) {
    rmSync(seedDir, { recursive: true, force: true });
    removed++;
  }
  console.log(`Target: ${dir}`);
  if (removed > 0) {
    console.log(`Cleared ${removed} item(s). Next launch = first-launch state.`);
  } else {
    console.log(`Nothing to clear.`);
  }
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

function nullable(s) {
  return s == null ? 'NULL' : `'${esc(s)}'`;
}

function gitInit(projectPath, projectName) {
  mkdirSync(projectPath, { recursive: true });
  if (existsSync(join(projectPath, '.git'))) return;
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: projectPath });
    writeFileSync(join(projectPath, 'README.md'), `# ${projectName}\n`);
    writeFileSync(join(projectPath, 'package.json'), `{\n  "name": "${projectName}",\n  "version": "1.0.0"\n}\n`);
    execFileSync('git', ['add', '.'], { cwd: projectPath });
    execFileSync(
      'git',
      ['-c', 'user.email=seed@ouijit.dev', '-c', 'user.name=Ouijit Seed', 'commit', '-q', '-m', 'Initial commit'],
      { cwd: projectPath },
    );
  } catch (err) {
    console.warn(`git init failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function seed() {
  if (!existsSync(dbPath())) {
    process.stderr.write(
      `Dev DB not found at ${dbPath()}\nLaunch \`npm run start\` once to create it, then re-run this command.\n`,
    );
    process.exit(1);
  }

  const seedData = JSON.parse(readFileSync(join(repoRoot, 'src', 'capture', 'seedData.json'), 'utf8'));
  const projectPath = seedProjectDir();
  const projectName = seedData.projectName;

  const existing = exec(`SELECT path FROM projects WHERE path = '${esc(projectPath)}';`).trim();
  if (existing) {
    process.stderr.write(`Already seeded at ${projectPath}\nRun \`npm run db:reset\` first to reseed.\n`);
    process.exit(1);
  }

  gitInit(projectPath, projectName);

  // Project + counter + settings
  exec(`
    INSERT OR IGNORE INTO projects (path, name, sort_order) VALUES ('${esc(projectPath)}', '${esc(projectName)}', 0);
    INSERT OR IGNORE INTO project_counters (project_path) VALUES ('${esc(projectPath)}');
    INSERT OR IGNORE INTO project_settings (project_path) VALUES ('${esc(projectPath)}');
  `);

  // Tasks — task_number = index + 1, sort_order grouped per status, mirrors TaskRepo.create
  const sortByStatus = {};
  const taskInserts = seedData.tasks.map((t, i) => {
    const taskNumber = i + 1;
    const status = t.status;
    const sortOrder = (sortByStatus[status] = (sortByStatus[status] ?? -1) + 1);
    const worktreePath = t.branch
      ? join(dirname(projectPath), `${projectName}-worktrees`, `T-${taskNumber}`)
      : null;
    const createdAt = new Date(Date.now() - (seedData.tasks.length - i) * 3600_000).toISOString();
    return `INSERT INTO tasks (project_path, task_number, name, status, prompt, branch, worktree_path, merge_target, sandboxed, sort_order, created_at, parent_task_number) VALUES ('${esc(projectPath)}', ${taskNumber}, '${esc(t.name)}', '${esc(status)}', ${nullable(t.prompt)}, ${nullable(t.branch)}, ${nullable(worktreePath)}, ${nullable(t.mergeTarget)}, ${t.sandboxed ? 1 : 0}, ${sortOrder}, '${esc(createdAt)}', ${t.parentTaskNumber ?? 'NULL'});`;
  });
  const nextTaskNumber = seedData.tasks.length + 1;
  exec(
    `${taskInserts.join('\n')}\nUPDATE project_counters SET next_task_number = ${nextTaskNumber} WHERE project_path = '${esc(projectPath)}';`,
  );

  // Hooks
  const hookInserts = seedData.hooks.map(
    (h) =>
      `INSERT INTO hooks (id, project_path, type, name, command, description) VALUES ('${randomUUID()}', '${esc(projectPath)}', '${esc(h.type)}', '${esc(h.name)}', '${esc(h.command)}', ${nullable(h.description)});`,
  );
  exec(hookInserts.join('\n'));

  // Scripts
  const scriptInserts = seedData.scripts.map(
    (s, i) =>
      `INSERT INTO scripts (id, project_path, name, command, sort_order) VALUES ('${randomUUID()}', '${esc(projectPath)}', '${esc(s.name)}', '${esc(s.command)}', ${i});`,
  );
  exec(scriptInserts.join('\n'));

  // Plan markdown
  const plansDir = join(projectPath, 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(plansDir, seedData.onboardingPlanFilename), seedData.onboardingPlanMarkdown);

  // Mark welcome seen so the dialog doesn't pop on top of seeded data
  exec(`INSERT OR REPLACE INTO global_settings (key, value) VALUES ('hasSeenWelcome', '1');`);

  console.log(`Seeded demo project at ${projectPath}`);
  console.log(`  ${seedData.tasks.length} tasks, ${seedData.hooks.length} hooks, ${seedData.scripts.length} scripts`);
}

const cmd = process.argv[2];
switch (cmd) {
  case 'reset':
    reset();
    break;
  case 'seed':
    seed();
    break;
  case 'clone-prod':
    cloneProd();
    break;
  case 'path':
    console.log(devDbDir());
    break;
  default:
    process.stderr.write(
      `Usage: node scripts/dev-db.mjs <reset|seed|clone-prod|path>\n\n` +
        `  reset       Delete dev DB + seed project (next launch = first-launch state)\n` +
        `  seed        Create the demo project used in marketing screenshots\n` +
        `  clone-prod  Copy prod DB into this worktree's dev DB\n` +
        `  path        Print this worktree's dev userData dir\n`,
    );
    process.exit(1);
}
