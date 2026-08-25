import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Icon } from '../terminal/Icon';
import { cloneUrl, isDotCom, parseRepoInput } from '../../github/repoUrl';
import { repoSlug } from '../../github/types';
import type { GithubRepoSummary, ResolvedRepo } from '../../types';

interface CloneFromGithubFormProps {
  onCancel: () => void;
  /** `projectPath` is where the clone will land, not where it already is. */
  onStarted: (projectPath: string) => void;
}

interface RepoChoice extends GithubRepoSummary {
  /** What the clone is handed for this row — the slug, or a URL for Enterprise. */
  ref: string;
}

/** Long enough that typing a name out does not fork a `gh` process per keystroke. */
const RESOLVE_DEBOUNCE_MS = 400;

function matchesNeedle(repo: GithubRepoSummary, needle: string): boolean {
  return repo.slug.toLowerCase().includes(needle) || (repo.description?.toLowerCase().includes(needle) ?? false);
}

/** Body and footer only — the add-project dialog owns the overlay and header. */
export function CloneFromGithubForm({ onCancel, onStarted }: CloneFromGithubFormProps) {
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubRepoSummary[]>([]);
  const [listNote, setListNote] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [highlight, setHighlight] = useState(-1);
  const [cloning, setCloning] = useState(false);
  const [resolution, setResolution] = useState<ResolvedRepo & { checking: boolean }>({
    status: 'unknown',
    checking: false,
  });
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.api
      .getDefaultProjectsFolder()
      .then((folder) => {
        if (!cancelled) setLocation(folder);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the projects folder. Choose a location.');
      });
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
  // A GitHub Enterprise repo has to keep its host: the bare slug parses back as
  // github.com on the way to the clone, which is a different repo entirely.
  const resolvedRef = resolved && (isDotCom(resolved) ? repoSlug(resolved) : cloneUrl(resolved));

  // A pasted URL is filtered on as the `owner/name` it resolves to, so it can
  // match a listed repo, and is offered as its own row when it matches none —
  // the list is only the user's own repos, and any repo is fair game to clone.
  const listedMatch = resolvedSlug
    ? repos.find((repo) => repo.slug.toLowerCase() === resolvedSlug.toLowerCase())
    : undefined;

  const matches = useMemo((): RepoChoice[] => {
    const needle = (resolvedSlug || query).trim().toLowerCase();
    const listed = (needle ? repos.filter((repo) => matchesNeedle(repo, needle)) : repos).map((repo) => ({
      ...repo,
      ref: repo.slug,
    }));
    const unlisted = resolvedSlug && resolvedRef && !listed.some((repo) => repo.slug.toLowerCase() === needle);
    if (unlisted && resolution.status !== 'not-found') {
      const found = resolution.status === 'found' ? resolution.repo : undefined;
      return [
        {
          slug: resolvedSlug,
          ref: resolvedRef,
          description: found?.description ?? null,
          isPrivate: found?.isPrivate ?? false,
        },
        ...listed,
      ];
    }
    return listed;
  }, [repos, query, resolvedSlug, resolvedRef, resolution]);

  // A repo already in the list is known to exist; anything else is checked
  // against GitHub so the confirmation below is earned rather than a restatement
  // of what was typed.
  useEffect(() => {
    if (!resolvedRef || listedMatch) {
      setResolution({ status: listedMatch ? 'found' : 'unknown', repo: listedMatch, checking: false });
      return;
    }
    setResolution({ status: 'unknown', checking: true });
    let cancelled = false;
    const timer = setTimeout(() => {
      window.api
        .resolveGithubRepo(resolvedRef)
        .then((result) => {
          if (!cancelled) setResolution({ ...result, checking: false });
        })
        .catch(() => {
          if (!cancelled) setResolution({ status: 'unknown', checking: false });
        });
    }, RESOLVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resolvedRef, listedMatch]);

  const target = (matches[highlight]?.ref || resolvedRef || query).trim();
  // `unknown` never blocks — see `resolveRepo`. Only a definite 404 does.
  const canClone = parseRepoInput(target) !== null && resolution.status !== 'not-found';

  useEffect(() => {
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const handleChooseLocation = useCallback(async () => {
    const result = await window.api.showFolderPicker({
      title: 'Choose Projects Folder',
      buttonLabel: 'Choose',
      defaultPath: location ?? undefined,
    });
    if (!result.canceled && result.filePaths.length > 0) {
      setLocation(result.filePaths[0]);
    }
  }, [location]);

  // The dialog's job ends once the repo is chosen. Starting the clone only
  // waits on validation, so what follows — minutes of it, for a large repo —
  // is watched from the project's own place in the sidebar.
  const handleClone = useCallback(
    async (repo: string) => {
      if (!repo || !parseRepoInput(repo) || cloning) return;
      setError(null);
      setCloning(true);
      const result = await window.api.startClone({ repo, parentDir: location ?? undefined });
      if (result.success && result.projectPath) {
        onStarted(result.projectPath);
      } else {
        setError(result.error ?? 'Could not start the clone.');
        setCloning(false);
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
            className="w-full h-9 px-4 font-sans text-sm text-text-primary bg-background border border-border rounded-md outline-none transition-all duration-150 ease-out focus:border-accent focus:ring-3 focus:ring-accent-light placeholder:text-text-tertiary"
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
                onClick={() => setQuery(repo.ref)}
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

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-secondary">Location</span>
          <div className="flex items-center gap-2">
            <div
              className="flex-1 min-w-0 h-9 px-4 flex items-center text-xs font-mono text-text-secondary bg-background border border-border rounded-md truncate"
              title={location ?? undefined}
            >
              <span className="truncate">{location ?? '…'}</span>
            </div>
            <button className="btn-secondary shrink-0" onClick={handleChooseLocation} disabled={cloning}>
              Choose…
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
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
