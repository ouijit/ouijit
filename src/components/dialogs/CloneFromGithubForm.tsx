import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Icon } from '../terminal/Icon';
import { parseRepoInput, repoRef } from '../../github/repoUrl';
import { repoSlug } from '../../github/types';
import { scoreFields } from '../../utils/paletteScore';
import { DIALOG_INPUT_CLASS, ProjectLocationField, useProjectLocation } from './ProjectLocationField';
import type { GithubRepoSummary, RepoIdentity, ResolvedRepo } from '../../types';

interface CloneFromGithubFormProps {
  onCancel: () => void;
  /** `projectPath` is where the clone will land, not where it already is. */
  onStarted: (projectPath: string) => void;
}

interface RepoChoice extends GithubRepoSummary {
  slug: string;
}

/** Long enough that typing a name out does not fork a `gh` process per keystroke. */
const RESOLVE_DEBOUNCE_MS = 400;

const UNKNOWN: ResolvedRepo = { status: 'unknown' };

function scoreRepo(repo: RepoChoice, needle: string): number | null {
  return (
    scoreFields(needle, [
      { key: 'slug', text: repo.slug, weight: 1 },
      { key: 'description', text: repo.description ?? '', weight: 0.5 },
    ])?.score ?? null
  );
}

export function CloneFromGithubForm({ onCancel, onStarted }: CloneFromGithubFormProps) {
  const [query, setQuery] = useState('');
  const { location, loadError, chooseLocation } = useProjectLocation();
  const [repos, setRepos] = useState<GithubRepoSummary[]>([]);
  const [listNote, setListNote] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [highlight, setHighlight] = useState(-1);
  const [cloning, setCloning] = useState(false);
  const [remote, setRemote] = useState<ResolvedRepo>(UNKNOWN);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.api
      .listGithubRepos()
      .then((result) => {
        if (cancelled) return;
        setRepos(result.repos);
        setListNote(result.message ?? null);
      })
      .catch(() => {
        if (!cancelled) setListNote('Could not load your repositories.');
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolved = useMemo(() => parseRepoInput(query), [query]);
  const resolvedSlug = resolved && repoSlug(resolved);

  const choices = useMemo(
    (): RepoChoice[] => repos.map((repo) => ({ ...repo, slug: repoSlug(repo.identity) })),
    [repos],
  );

  // A pasted URL is filtered on as the `owner/name` it resolves to, so it can
  // match a listed repo, and is offered as its own row when it matches none —
  // the list is only the user's own repos, and any repo is fair game to clone.
  const listedMatch = resolvedSlug
    ? choices.find((repo) => repo.slug.toLowerCase() === resolvedSlug.toLowerCase())
    : undefined;

  // A repo already in the list is known to exist; anything else is checked
  // against GitHub. Answers are kept because every form of the same repo — the
  // URL, the slug, the `.git` suffix — asks the same question, and each miss
  // forks `gh`.
  const resolvedBefore = useRef(new Map<string, ResolvedRepo>());
  useEffect(() => {
    if (!resolved || listedMatch) return;
    const key = repoSlug(resolved);
    const remembered = resolvedBefore.current.get(key);
    if (remembered) {
      setRemote(remembered);
      return;
    }
    setRemote((current) => (current.status === 'unknown' ? current : UNKNOWN));
    let cancelled = false;
    const timer = setTimeout(() => {
      window.api
        .resolveGithubRepo(resolved)
        .then((result) => {
          resolvedBefore.current.set(key, result);
          if (!cancelled) setRemote(result);
        })
        .catch(() => {
          if (!cancelled) setRemote(UNKNOWN);
        });
    }, RESOLVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resolved, listedMatch]);

  const resolution = useMemo<ResolvedRepo>(() => {
    if (listedMatch) return { status: 'found', repo: listedMatch };
    return resolved ? remote : UNKNOWN;
  }, [listedMatch, resolved, remote]);

  const matches = useMemo((): RepoChoice[] => {
    const needle = (resolvedSlug || query).trim();
    const listed = needle
      ? choices
          .flatMap((repo) => {
            const score = scoreRepo(repo, needle);
            return score === null ? [] : [{ repo, score }];
          })
          .sort((a, b) => b.score - a.score)
          .map(({ repo }) => repo)
      : choices;
    const unlisted = resolved && resolvedSlug && !listedMatch;
    if (unlisted && resolution.status !== 'not-found') {
      const found = resolution.status === 'found' ? resolution.repo : undefined;
      return [
        {
          slug: resolvedSlug,
          identity: resolved,
          description: found?.description ?? null,
          isPrivate: found?.isPrivate ?? false,
        },
        ...listed,
      ];
    }
    return listed;
  }, [choices, query, resolved, resolvedSlug, listedMatch, resolution]);

  const target = matches[highlight]?.identity ?? resolved;
  // `unknown` never blocks — see `resolveRepo`. Only a definite 404 does.
  const canClone = target !== null && resolution.status !== 'not-found';

  useEffect(() => {
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  // The dialog's job ends once the repo is chosen. Starting the clone only
  // waits on validation, so what follows — minutes of it, for a large repo —
  // is watched from the project's own place in the sidebar.
  const handleClone = useCallback(
    async (repo: RepoIdentity | null) => {
      if (!repo || cloning) return;
      setError(null);
      setCloning(true);
      const result = await window.api.startClone({ repo, parentDir: location ?? undefined });
      if (result.success === false) {
        setError(result.error);
        setCloning(false);
      } else {
        onStarted(result.projectPath);
      }
    },
    [location, cloning, onStarted],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, matches.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleClone(target);
      }
    },
    [matches.length, target, handleClone],
  );

  return (
    <>
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text-secondary" htmlFor="clone-repo">
            Repository
          </label>
          <input
            ref={inputRef}
            id="clone-repo"
            className={DIALOG_INPUT_CLASS}
            type="text"
            placeholder="owner/name or a GitHub URL"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(-1);
            }}
            onKeyDown={handleKeyDown}
            disabled={cloning}
          />
        </div>

        <div ref={listRef} className="max-h-56 overflow-y-auto rounded-md border border-border bg-background">
          {listLoading ? (
            <p className="px-3 py-2 text-xs text-text-tertiary">Loading your repositories…</p>
          ) : listNote ? (
            <p className="px-3 py-2 text-xs text-text-tertiary">{listNote}</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-tertiary">
              {resolution.status === 'not-found'
                ? `${resolvedSlug} was not found on GitHub.`
                : query.trim()
                  ? `No repository matches “${query.trim()}”.`
                  : 'No repositories found.'}
            </p>
          ) : (
            matches.map((repo, index) => (
              <button
                key={repo.slug}
                className={`w-full flex items-baseline gap-2 px-3 py-2 text-left border-none transition-colors duration-100 ease-out ${index === highlight ? 'bg-ink/[0.08]' : 'bg-transparent hover:bg-ink/[0.05]'}`}
                onClick={() => setQuery(repoRef(repo.identity))}
                disabled={cloning}
              >
                {repo.slug === resolvedSlug && (
                  <Icon
                    name="check"
                    className={`w-3 h-3 shrink-0 self-center ${resolution.status === 'found' ? 'text-success' : 'text-transparent'}`}
                  />
                )}
                <span className="text-xs text-text-primary shrink-0">{repo.slug}</span>
                {repo.isPrivate && <span className="text-[10px] text-text-tertiary shrink-0">Private</span>}
                {repo.description && (
                  <span className="text-[11px] text-text-tertiary truncate">{repo.description}</span>
                )}
              </button>
            ))
          )}
        </div>

        <ProjectLocationField location={location} onChoose={chooseLocation} disabled={cloning} />
        {(error ?? loadError) && <p className="text-xs text-error">{error ?? loadError}</p>}
      </div>
      <div className="flex gap-2 justify-end mt-4 items-center">
        <button className="btn-secondary" onClick={onCancel} disabled={cloning}>
          Cancel
        </button>
        <button
          className="btn-primary flex items-center gap-1.5"
          onClick={() => handleClone(target)}
          disabled={!canClone || cloning}
        >
          <Icon name="github-logo" className="w-3.5 h-3.5" />
          {cloning ? 'Starting…' : 'Clone'}
        </button>
      </div>
    </>
  );
}
