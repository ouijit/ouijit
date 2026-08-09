import type Database from 'better-sqlite3';

/**
 * Pull request commands, gone.
 *
 * They were named shell commands run against a pull request in a terminal —
 * which is what a task made from that pull request already is, with a hook and
 * every run command the project has. Two ways to do one thing, one of them
 * carrying its own settings section, its own storage and its own environment.
 *
 * The table is dropped rather than left behind: 015 created it and has been
 * amended not to, so this exists only for the machines that ran 015 while it
 * still did.
 */
export function up(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS github_pr_commands');
}
