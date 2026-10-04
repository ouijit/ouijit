/**
 * Capture-mode fixture seeder. Populates the temp SQLite DB with a single
 * project plus a mix of tasks, hooks, and scripts so screenshots look real
 * without having to spawn PTYs.
 *
 * Only for `OUIJIT_CAPTURE_MODE=1` runs against an empty DB.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import { ProjectRepo } from '../db/repos/projectRepo';
import { TaskRepo } from '../db/repos/taskRepo';
import { HookRepo } from '../db/repos/hookRepo';
import { ScriptRepo } from '../db/repos/scriptRepo';
import { GlobalSettingsRepo } from '../db/repos/globalSettingsRepo';
import { getLogger } from '../logger';
import seedData from './seedData.json';

const captureFixtureLog = getLogger().scope('captureFixture');

export interface CaptureFixtureResult {
  projectPath: string;
  projectName: string;
}

export interface CaptureFixtureOptions {
  projectPath: string;
  projectName: string;
}

type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

interface TaskSeed {
  name: string;
  status: TaskStatus;
  prompt?: string;
  branch?: string;
  mergeTarget?: string;
  parentTaskNumber?: number;
  sandboxed?: boolean;
}

const TASK_SEEDS = seedData.tasks as TaskSeed[];

const STEPPER_COMMITTED = `import { useState } from 'react';
import { WelcomeCopy } from './WelcomeCopy';

const STEPS = ['profile', 'workspace', 'invite'] as const;

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  return (
    <div className="onboarding">
      <WelcomeCopy />
      <StepBody step={STEPS[step]} />
      <button onClick={() => setStep((s) => s + 1)}>Continue</button>
    </div>
  );
}
`;

const STEPPER_MODIFIED = `import { useState } from 'react';
import { IntroCard } from './IntroCard';
import { loadProgress, saveProgress } from './progress';

const STEPS = ['profile', 'workspace', 'invite'] as const;

export function OnboardingStepper() {
  const [step, setStep] = useState(() => loadProgress());
  const advance = () => {
    saveProgress(step + 1);
    setStep((s) => s + 1);
  };
  return (
    <div className="onboarding">
      <IntroCard />
      <ol className="stepper">
        {STEPS.map((name, i) => (
          <li key={name} data-active={i === step}>{name}</li>
        ))}
      </ol>
      <StepBody step={STEPS[step]} />
      <button onClick={advance}>Continue</button>
    </div>
  );
}
`;

const INTRO_CARD = `export function IntroCard() {
  return (
    <section className="intro-card">
      <h2>Welcome aboard</h2>
      <p>Three quick steps and your workspace is ready to share.</p>
    </section>
  );
}
`;

const DASHBOARD_COMMITTED = `import { useState } from 'react';
import { Header } from './Header';
import { MetricGrid } from './MetricGrid';
import { ProjectList } from './ProjectList';
import { EmptyState } from './EmptyState';

export function Dashboard({ workspaceId, projects }: DashboardProps) {
  const [range, setRange] = useState('7d');

  if (projects.length === 0) {
    return <EmptyState workspaceId={workspaceId} />;
  }

  return (
    <div className="dashboard">
      <Header workspaceId={workspaceId} range={range} onRange={setRange} />
      <MetricGrid workspaceId={workspaceId} range={range} />
      <ProjectList workspaceId={workspaceId} projects={projects} />
    </div>
  );
}
`;

/**
 * Two hunks apart, and the lens scene puts each in a different part: the
 * polling that can outlive the page with the query behind it, the mount with
 * the feed it renders. A change small enough to land in one hunk would draw
 * the same lines under every heading.
 */
const DASHBOARD_MODIFIED = `import { useEffect, useState } from 'react';
import { Header } from './Header';
import { MetricGrid } from './MetricGrid';
import { ProjectList } from './ProjectList';
import { EmptyState } from './EmptyState';
import { ActivityFeed } from './ActivityFeed';
import { fetchActivity } from '../api/activity';

export function Dashboard({ workspaceId, projects }: DashboardProps) {
  const [range, setRange] = useState('7d');
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    const poll = setInterval(() => {
      void fetchActivity(workspaceId).then(setActivity);
    }, 5_000);
    return () => clearInterval(poll);
  }, [workspaceId]);

  if (projects.length === 0) {
    return <EmptyState workspaceId={workspaceId} />;
  }

  return (
    <div className="dashboard">
      <Header workspaceId={workspaceId} range={range} onRange={setRange} />
      <MetricGrid workspaceId={workspaceId} range={range} />
      <ActivityFeed events={activity} />
      <ProjectList workspaceId={workspaceId} projects={projects} />
    </div>
  );
}
`;

const ACTIVITY_FEED = `import type { ActivityEvent } from '../api/activity';

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <p className="activity-empty">Nothing has happened here yet.</p>;
  }

  return (
    <ol className="activity-feed">
      {events.map((event) => (
        <li key={event.id}>
          <span className="activity-actor">{event.actor}</span>
          <span className="activity-verb">{event.verb}</span>
          <time dateTime={event.at}>{event.at}</time>
        </li>
      ))}
    </ol>
  );
}
`;

const ACTIVITY_API = `import { query } from './db';

export interface ActivityEvent {
  id: string;
  actor: string;
  verb: string;
  at: string;
}

export async function fetchActivity(workspaceId: string): Promise<ActivityEvent[]> {
  const rows = await query(
    'select id, actor, verb, created_at from events where workspace_id = $1 order by created_at desc',
    [workspaceId],
  );
  return rows.map((row) => ({ id: row.id, actor: row.actor, verb: row.verb, at: row.created_at }));
}
`;

const ACTIVITY_CSS = `.activity-feed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.activity-feed li {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.activity-empty {
  color: var(--text-muted);
}
`;

const ACTIVITY_TEST = `import { describe, expect, it } from 'vitest';
import { fetchActivity } from '../activity';

describe('fetchActivity', () => {
  it('returns the workspace events newest first', async () => {
    const events = await fetchActivity('ws-1');
    expect(events.map((e) => e.id)).toEqual(['e-3', 'e-2', 'e-1']);
  });
});
`;

export function seedCaptureFixture(
  db: Database.Database,
  { projectPath, projectName }: CaptureFixtureOptions,
): CaptureFixtureResult {
  fs.mkdirSync(projectPath, { recursive: true });
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: projectPath });
    fs.writeFileSync(path.join(projectPath, 'README.md'), `# ${projectName}\n`);
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      `{\n  "name": "${projectName}",\n  "version": "1.0.0"\n}\n`,
    );
    const onboardingDir = path.join(projectPath, 'src', 'onboarding');
    fs.mkdirSync(onboardingDir, { recursive: true });
    fs.writeFileSync(path.join(onboardingDir, 'Stepper.tsx'), STEPPER_COMMITTED);
    const dashboardDir = path.join(projectPath, 'src', 'dashboard');
    fs.mkdirSync(dashboardDir, { recursive: true });
    fs.writeFileSync(path.join(dashboardDir, 'Dashboard.tsx'), DASHBOARD_COMMITTED);
    // Committed rather than left untracked: the diff scene should lead with
    // the code changes, not a page of plan markdown.
    const plansDir = path.join(projectPath, 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(path.join(plansDir, seedData.onboardingPlanFilename), seedData.onboardingPlanMarkdown);
    execFileSync('git', ['add', '.'], { cwd: projectPath });
    execFileSync(
      'git',
      ['-c', 'user.email=capture@ouijit.dev', '-c', 'user.name=Ouijit Capture', 'commit', '-q', '-m', 'Initial commit'],
      { cwd: projectPath },
    );
    // Real worktrees at the paths the task rows record, so a seeded terminal
    // pointed at one reports the task branch rather than the project's main.
    const worktreesDir = path.join(path.dirname(projectPath), `${projectName}-worktrees`);
    for (let i = 0; i < TASK_SEEDS.length; i++) {
      const seed = TASK_SEEDS[i];
      if (!seed.branch || seed.status === 'done') continue;
      execFileSync('git', ['worktree', 'add', '-q', '-b', seed.branch, path.join(worktreesDir, `T-${i + 1}`), 'main'], {
        cwd: projectPath,
      });
    }
    // Left uncommitted on purpose: the diff scene screenshots these changes.
    const diffSceneDir = path.join(worktreesDir, 'T-1', 'src', 'onboarding');
    fs.writeFileSync(path.join(diffSceneDir, 'Stepper.tsx'), STEPPER_MODIFIED);
    fs.writeFileSync(path.join(diffSceneDir, 'IntroCard.tsx'), INTRO_CARD);
    // The lens scene reads T-2: six files over three concerns, which is the
    // least a grouping can be drawn over and still look like one.
    const lensDashboardDir = path.join(worktreesDir, 'T-2', 'src', 'dashboard');
    const lensApiDir = path.join(worktreesDir, 'T-2', 'src', 'api');
    fs.mkdirSync(path.join(lensApiDir, '__tests__'), { recursive: true });
    fs.writeFileSync(path.join(lensDashboardDir, 'Dashboard.tsx'), DASHBOARD_MODIFIED);
    fs.writeFileSync(path.join(lensDashboardDir, 'ActivityFeed.tsx'), ACTIVITY_FEED);
    fs.writeFileSync(path.join(lensDashboardDir, 'activity.css'), ACTIVITY_CSS);
    fs.writeFileSync(path.join(lensApiDir, 'activity.ts'), ACTIVITY_API);
    fs.writeFileSync(path.join(lensApiDir, '__tests__', 'activity.test.ts'), ACTIVITY_TEST);
  } catch (err) {
    captureFixtureLog.warn('git init failed', { error: err instanceof Error ? err.message : String(err) });
  }

  const projectRepo = new ProjectRepo(db);
  const taskRepo = new TaskRepo(db);
  const hookRepo = new HookRepo(db);
  const scriptRepo = new ScriptRepo(db);

  projectRepo.add(projectPath, projectName);

  // Create tasks in seed order — task numbers match array index + 1.
  for (let i = 0; i < TASK_SEEDS.length; i++) {
    const seed = TASK_SEEDS[i];
    const taskNumber = i + 1;
    const worktreePath = seed.branch
      ? path.join(path.dirname(projectPath), `${projectName}-worktrees`, `T-${taskNumber}`)
      : undefined;
    taskRepo.create(projectPath, taskNumber, seed.name, {
      status: seed.status,
      prompt: seed.prompt,
      branch: seed.branch,
      mergeTarget: seed.mergeTarget,
      parentTaskNumber: seed.parentTaskNumber,
      worktreePath,
      createdAt: new Date(Date.now() - (TASK_SEEDS.length - i) * 3600_000).toISOString(),
    });
  }

  for (const hook of seedData.hooks) {
    hookRepo.save(
      projectPath,
      hook.type as 'start' | 'continue' | 'run' | 'review',
      hook.name,
      hook.command,
      undefined,
      hook.description,
    );
  }

  for (const script of seedData.scripts) {
    scriptRepo.save(projectPath, script.name, script.command);
  }

  new GlobalSettingsRepo(db).set(`experimental:${projectPath}`, JSON.stringify({ canvas: false }));

  captureFixtureLog.info('fixture seeded', { projectPath, tasks: TASK_SEEDS.length });

  return { projectPath, projectName };
}
