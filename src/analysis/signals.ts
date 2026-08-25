import type { DiffSignals, FileSignal } from './types';

export interface FileAnalysis {
  signal: FileSignal;
  /** Coupled partners the file list does not contain. Already filtered. */
  missing: string[];
}

/** The signals for one file list, by path — the shape every surface wants. */
export function analysisByPath(signals: DiffSignals): Map<string, FileAnalysis> {
  const byPath = new Map<string, FileAnalysis>();
  for (const [path, signal] of Object.entries(signals.files)) {
    byPath.set(path, { signal, missing: [] });
  }
  for (const coupling of signals.couplings) {
    const entry = byPath.get(coupling.path);
    if (entry) entry.missing.push(coupling.partner);
  }
  return byPath;
}
