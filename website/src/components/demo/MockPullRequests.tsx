import { useState, type ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';

/**
 * The GitHub surface from the app's PullRequestsPanel, rendered from fixtures:
 * the inbox on the left, one open pull request on the right. Class strings are
 * lifted from the app components so the two stay comparable side by side.
 */

interface PrRowFixture {
  number: number;
  title: string;
  author: string;
  branch: string;
  updated: string;
  additions: number;
  deletions: number;
  state: 'open' | 'merged';
  drafts?: number;
  task?: number;
}

const GROUPS: Array<{ label: string; rows: PrRowFixture[] }> = [
  {
    label: 'Needs your review',
    rows: [
      {
        number: 486,
        title: 'Speed up search index build',
        author: 'mara-oduya',
        branch: 'speed-search-index',
        updated: '2 hours ago',
        additions: 182,
        deletions: 54,
        state: 'open',
        drafts: 3,
        task: 99,
      },
    ],
  },
  {
    label: 'Authored',
    rows: [
      {
        number: 482,
        title: 'Refactor billing webhook router',
        author: 'prentice',
        branch: 'billing-webhook-router',
        updated: '5 hours ago',
        additions: 214,
        deletions: 96,
        state: 'open',
        task: 98,
      },
      {
        number: 501,
        title: 'Rework onboarding flow',
        author: 'prentice',
        branch: 'rework-onboarding',
        updated: 'just now',
        additions: 130,
        deletions: 78,
        state: 'open',
        drafts: 1,
        task: 101,
      },
      {
        number: 479,
        title: 'Restore login redirect after timeout',
        author: 'prentice',
        branch: 'login-redirect',
        updated: '1 day ago',
        additions: 48,
        deletions: 12,
        state: 'merged',
        task: 95,
      },
    ],
  },
  {
    label: 'Everything else',
    rows: [
      {
        number: 488,
        title: 'Add rate limiting to the public API',
        author: 'jkataja',
        branch: 'api-rate-limits',
        updated: '30 minutes ago',
        additions: 96,
        deletions: 8,
        state: 'open',
      },
    ],
  },
];

const ACTIVE = 486;
const PULL_COUNT = GROUPS.reduce((n, g) => n + g.rows.length, 0);

const CHECKS = ['build', 'typecheck', 'unit', 'e2e', 'lint', 'screenshots'];

export function MockPullRequests() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      {!collapsed && <Sidebar />}
      {!collapsed && <div className="pane-seam relative w-px shrink-0" />}
      <Detail collapsed={collapsed} onToggleSidebar={() => setCollapsed(!collapsed)} />
    </>
  );
}

/** The inbox: which pull requests are waiting on you, which are yours, and how
 *  far through them you are. `active` names the row the pane beside it is
 *  showing. */
export function Sidebar({ width = 320, active = ACTIVE }: { width?: number; active?: number } = {}) {
  return (
    <div className="shrink-0 flex flex-col overflow-hidden" style={{ width }}>
      <div className="shrink-0 flex flex-col">
        <nav className="flex items-stretch gap-4 pane-ledge h-12 px-3 items-center">
          <Tab active count={PULL_COUNT}>
            Pull requests
          </Tab>
          <Tab count={3}>Issues</Tab>
        </nav>
        <div className="px-3 py-2">
          <label className="flex items-center gap-2 h-9 px-3 rounded-full bg-ink/[0.05] focus-within:bg-ink/[0.08] transition-colors duration-150">
            <Icon name="magnifying-glass" className="w-4 h-4 shrink-0 text-text-tertiary" />
            <input
              placeholder="Search pull requests"
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary"
            />
          </label>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-4">
        {GROUPS.map(({ label, rows }) => (
          <section key={label} className="pt-3">
            <div className="px-4 pb-1 text-[13px] text-text-tertiary">{label}</div>
            {rows.map((pr) => (
              <PullRequestRow key={pr.number} pr={pr} active={pr.number === active} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function Tab({ active, count, children }: { active?: boolean; count?: number; children: ReactNode }) {
  return (
    <span
      className={`flex items-center gap-1.5 px-0.5 border-b-2 -mb-px text-[13px] font-medium transition-colors duration-150 ${
        active ? 'border-accent text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'
      }`}
    >
      {children}
      {count != null && count > 0 && <span className="opacity-50 tabular-nums">{count}</span>}
    </span>
  );
}

function PullRequestRow({ pr, active }: { pr: PrRowFixture; active: boolean }) {
  return (
    <div
      className={`group relative w-full px-4 py-2 flex flex-col gap-0.5 transition-colors duration-100 ${
        active ? 'bg-ink/[0.07]' : 'hover:bg-ink/[0.04]'
      }`}
    >
      <span className="flex items-baseline gap-2 text-left">
        <span className="flex-1 min-w-0 truncate text-[15px] text-text-primary">{pr.title}</span>
        <span className="shrink-0 text-[13px] text-text-tertiary">{pr.updated}</span>
      </span>
      <span className="flex items-center gap-2 min-w-0 text-[13px] text-text-tertiary">
        <Icon
          name={pr.state === 'merged' ? 'git-merge' : 'git-pull-request'}
          className={`w-3.5 h-3.5 shrink-0 ${pr.state === 'merged' ? 'text-vcs-renamed' : 'text-vcs-added'}`}
        />
        <MockAvatar login={pr.author} size={16} />
        <span className="shrink-0">{pr.author}</span>
        <span className="flex-1 min-w-0 truncate font-mono text-[12px]">{pr.branch}</span>
        {pr.drafts != null && pr.drafts > 0 && <span className="shrink-0 text-accent">{pr.drafts} unsent</span>}
        {pr.task != null && <span className="shrink-0 font-mono text-[12px] text-text-tertiary">T-{pr.task}</span>}
        <span className="shrink-0 font-mono text-[12px] tabular-nums">
          <span className="text-diff-added">+{pr.additions}</span>{' '}
          <span className="text-diff-removed">-{pr.deletions}</span>
        </span>
      </span>
    </div>
  );
}

function Detail({ collapsed, onToggleSidebar }: { collapsed: boolean; onToggleSidebar: () => void }) {
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <header className="pane-ledge relative z-30 shrink-0 h-12 flex items-center gap-3 px-3">
        <button
          type="button"
          title={collapsed ? 'Show the list' : 'Hide the list'}
          className="w-7 h-7 rounded-md bg-transparent border-none text-ink/60 flex items-center justify-center shrink-0 transition-all duration-150 ease-out hover:bg-ink/10 hover:text-ink/90 -ml-1"
          onClick={onToggleSidebar}
        >
          <Icon name={collapsed ? 'caret-right' : 'caret-left'} />
        </button>
        <span className="flex items-center gap-2 min-w-0 max-w-[min(45%,720px)] text-text-secondary">
          <Icon name="git-pull-request" className="w-4 h-4 shrink-0 text-vcs-added" />
          <span className="truncate text-[15px]">Speed up search index build</span>
        </span>

        <nav className="flex items-stretch gap-4 mx-auto shrink-0 self-stretch items-center">
          <Tab active>Summary</Tab>
          <Tab>Timeline</Tab>
          <Tab count={7}>Code</Tab>
        </nav>

        <div className="flex items-center gap-1 shrink-0">
          <div className="inline-flex items-center h-7 glass-bevel relative border border-bezel rounded-[12px] overflow-hidden bg-background-secondary">
            <Segment>
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />3 unsent
            </Segment>
            <SegmentDivider />
            <Segment>Review</Segment>
            <SegmentDivider />
            <Segment accent>Merge</Segment>
          </div>
          <HeaderIconButton icon="arrows-clockwise" label="Refresh" />
          <HeaderIconButton icon="arrow-square-out" label="Open on GitHub" />
          <HeaderIconButton icon="x" label="Close" />
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <SummaryPane />
      </div>
    </div>
  );
}

function Segment({ accent, children }: { accent?: boolean; children: ReactNode }) {
  return (
    <span
      className={`h-full px-2.5 flex items-center gap-1.5 border-none font-sans text-[13px] font-medium transition-colors duration-150 ease-out ${
        accent ? 'bg-accent text-accent-ink' : 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-background-tertiary'
      }`}
    >
      {children}
    </span>
  );
}

function SegmentDivider() {
  return <div aria-hidden className="w-px h-3 bg-ink/10 self-center" />;
}

function HeaderIconButton({ icon, label }: { icon: string; label: string }) {
  return (
    <span
      title={label}
      className="w-7 h-7 rounded-md text-text-tertiary flex items-center justify-center hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-150"
    >
      <Icon name={icon} className="w-4 h-4" />
    </span>
  );
}

function SummaryPane() {
  return (
    <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-7">
      <header className="flex flex-col gap-3">
        {/* A div, not an h1: the marketing stylesheet styles bare headings in
            its own display face, which must not leak into the app mock. */}
        <div className="text-[28px] leading-tight font-medium text-text-primary text-balance">
          Speed up search index build
        </div>
        <div className="flex items-center gap-2 text-[15px] text-text-secondary">
          <MockAvatar login="mara-oduya" size={22} />
          <span className="text-text-primary">mara-oduya</span>
          <Dot />
          <span>2 hours ago</span>
          <Dot />
          <span className="flex items-center gap-1">
            #486
            <Icon name="arrow-square-out" className="w-3.5 h-3.5 opacity-60" />
          </span>
          <Dot />
          <span>Ready for review</span>
        </div>
      </header>

      <dl className="flex flex-col gap-2.5">
        <Fact icon="git-branch" label="Branch">
          <span className="font-mono text-[13px] text-text-primary">speed-search-index</span>
          <Icon name="caret-right" className="w-3 h-3 text-text-tertiary" />
          <span className="font-mono text-[13px] text-text-primary">main</span>
          <span className="font-mono text-[13px] tabular-nums ml-1">
            <span className="text-diff-added">+182</span> <span className="text-diff-removed">-54</span>
          </span>
        </Fact>

        <Fact icon="user-circle" label="Task">
          <span className="flex items-center gap-1.5 text-[15px] text-text-primary">
            <span className="font-mono text-[13px]">T-99</span>
            <span className="text-text-tertiary">In review</span>
            <Icon name="arrow-right" className="w-3.5 h-3.5 opacity-60" />
          </span>
        </Fact>

        <Fact icon="chat-circle" label="Comments">
          <span className="text-text-primary">
            3 comments<span className="text-accent">, 1 unresolved</span>
          </span>
        </Fact>

        <Fact icon="clock" label="Checks">
          <span className="text-text-primary">6 passing</span>
        </Fact>
      </dl>

      <Section label="Description" defaultOpen>
        <div className="app-markdown text-sm text-text-primary leading-relaxed break-words">
          <p>
            Builds the search index from the change log instead of walking every document on boot. The full walk only
            runs when the log is missing or truncated.
          </p>
          <ul>
            <li>
              Incremental rebuild driven by <code>indexJournal</code>, keyed on document revision
            </li>
            <li>Batch writes flushed every 250ms instead of per document</li>
            <li>Cold start on the demo project drops from 41s to 9s</li>
          </ul>
        </div>
      </Section>

      <Section label="Checks" count={CHECKS.length}>
        <div className="py-2">
          {CHECKS.map((name) => (
            <div key={name} className="flex items-center gap-2.5 px-4 py-1">
              <Icon name="check-circle" className="w-3.5 h-3.5 shrink-0 text-vcs-added" />
              <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-text-secondary">{name}</span>
              <span className="shrink-0 font-mono text-[10px] text-text-tertiary">success</span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Comments" count={2} defaultOpen>
        <div className="flex flex-col gap-5">
          <Comment author="jkataja" when="1 hour ago" verb="commented">
            The cold-start path is what was hurting the demo projects. Did you check the journal survives a crashed
            build half-way through a flush?
          </Comment>
          <Comment author="mara-oduya" when="45 minutes ago" verb="commented">
            Yes — the journal is truncated to the last complete batch on open, so a torn flush falls back to the full
            walk for just the affected documents.
          </Comment>
          <div className="flex gap-3">
            <MockAvatar login="prentice" size={26} className="mt-1" />
            <div className="flex-1 min-w-0 flex flex-col items-start gap-2">
              <textarea rows={3} readOnly placeholder="Leave a comment" className="field resize-y" />
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Dot() {
  return <span className="text-text-tertiary opacity-60">·</span>;
}

function Fact({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="flex items-center gap-2 w-[150px] shrink-0 text-[15px] text-text-tertiary">
        <Icon name={icon} className="w-4 h-4 shrink-0 opacity-70" />
        {label}
      </dt>
      <dd className="flex items-center gap-1.5 min-w-0 flex-wrap text-[15px]">{children}</dd>
    </div>
  );
}

function Section({
  label,
  count,
  defaultOpen = false,
  children,
}: {
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        className="group flex items-center gap-2 pb-2.5 border-b border-ink/[0.08] text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[19px] font-medium text-text-primary">{label}</span>
        <Icon
          name="caret-right"
          className={`w-4 h-4 text-text-tertiary transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        {count != null && count > 0 && <span className="text-[15px] text-text-tertiary">{count}</span>}
      </button>
      {open && <div className="pt-4">{children}</div>}
    </section>
  );
}

function Comment({
  author,
  when,
  verb,
  children,
}: {
  author: string;
  when: string;
  verb: string;
  children: ReactNode;
}) {
  return (
    <article className="flex gap-3">
      <MockAvatar login={author} size={26} className="mt-0.5" />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
          <span className="text-text-primary text-[15px]">{author}</span>
          <span>{verb}</span>
          <span className="opacity-50">·</span>
          <span className="flex-1 min-w-0 truncate">{when}</span>
        </div>
        <div className="app-markdown text-sm text-text-primary leading-relaxed break-words">
          <p>{children}</p>
        </div>
      </div>
    </article>
  );
}

/** The app Avatar's initial fallback: a stable tinted circle per login. */
function MockAvatar({ login, size, className = '' }: { login: string; size: number; className?: string }) {
  let hash = 0;
  for (let i = 0; i < login.length; i++) hash = (hash * 31 + login.charCodeAt(i)) % 360;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, hsl(${hash} 55% 55%) 30%, transparent)`,
      }}
      title={login}
    >
      <span
        aria-hidden
        className="font-sans font-medium leading-none text-ink/70"
        style={{ fontSize: Math.max(9, Math.round(size * 0.45)) }}
      >
        {login[0].toUpperCase()}
      </span>
    </span>
  );
}
