import { useMemo } from 'react';
import type { ChangedFile } from '../types';
import type { DiffSignals } from '../analysis/types';
import { prFilesFingerprint } from '../diffSource';
import { useGithubStore } from '../stores/githubStore';
import { useAnalysisSignals } from './useAnalysisSignals';

/**
 * Behavioural-analysis signals for a pull request's files. The rail, the file
 * list and the summary all render from one fetch, which holds only while they
 * ask under the same key — so the key is built here rather than at each of them.
 */
export function usePullRequestSignals(headSha: string, files: readonly ChangedFile[]): DiffSignals | null {
  const projectPath = useGithubStore((s) => s.projectPath);
  const fingerprint = useMemo(() => prFilesFingerprint(headSha, files), [headSha, files]);
  const paths = useMemo(() => files.map((f) => f.path), [files]);
  return useAnalysisSignals(projectPath ?? '', fingerprint, paths);
}
