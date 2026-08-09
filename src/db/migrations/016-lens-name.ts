import type Database from 'better-sqlite3';

/**
 * Which lens wrote the grouping stored for a pull request.
 *
 * The code pane picks how to read a change from one list — the flat file order,
 * then the project's lenses — so it has to be able to say which of them is on
 * screen. The groups alone cannot: they are the answer, not the question that
 * produced it, and after a restart the name that produced them was gone.
 *
 * Nullable, because a lens can also arrive over the CLI from an agent that
 * never went through one. Those keep the generic name the picker gives them.
 */
export function up(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('github_pr_lenses')").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'lens_name')) {
    db.exec('ALTER TABLE github_pr_lenses ADD COLUMN lens_name TEXT');
  }
}
