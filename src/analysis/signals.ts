import type { DiffSignals, FileSignal } from './types';

export interface FileAnalysis {
  signal: FileSignal;
  /** Coupled partners of the file that this list does not contain. */
  missing: string[];
}

/**
 * The signals for one file list, indexed by path. The coupling rows arrive as
 * a flat list, so every surface that wants them per file would otherwise scan
 * the whole list once per file.
 */
export function analysisByPath(signals: DiffSignals, paths: readonly string[]): Map<string, FileAnalysis> {
  const present = new Set(paths);
  const partners = new Map<string, string[]>();
  for (const coupling of signals.couplings) {
    if (present.has(coupling.partner)) continue;
    const missing = partners.get(coupling.path);
    if (missing) missing.push(coupling.partner);
    else partners.set(coupling.path, [coupling.partner]);
  }

  const byPath = new Map<string, FileAnalysis>();
  for (const path of paths) {
    const signal = signals.files[path];
    if (signal) byPath.set(path, { signal, missing: partners.get(path) ?? [] });
  }
  return byPath;
}
