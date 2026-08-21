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
    execFileSync('git', ['add', '.'], { cwd: projectPath });
    execFileSync(
      'git',
      ['-c', 'user.email=capture@ouijit.dev', '-c', 'user.name=Ouijit Capture', 'commit', '-q', '-m', 'Initial commit'],
      { cwd: projectPath },
    );
    // Left uncommitted on purpose: the diff scene screenshots these changes.
    fs.writeFileSync(path.join(onboardingDir, 'Stepper.tsx'), STEPPER_MODIFIED);
    fs.writeFileSync(path.join(onboardingDir, 'IntroCard.tsx'), INTRO_CARD);
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

  const plansDir = path.join(projectPath, 'plans');
  fs.mkdirSync(plansDir, { recursive: true });
  fs.writeFileSync(path.join(plansDir, seedData.onboardingPlanFilename), seedData.onboardingPlanMarkdown);

  new GlobalSettingsRepo(db).set(`experimental:${projectPath}`, JSON.stringify({ canvas: false }));

  captureFixtureLog.info('fixture seeded', { projectPath, tasks: TASK_SEEDS.length });

  return { projectPath, projectName };
}
