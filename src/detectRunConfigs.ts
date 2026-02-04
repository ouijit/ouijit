import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RunConfig } from './types';

// Priority constants (lower = higher priority)
const PRIORITY = {
  DEV: 1,
  START: 2,
  BUILD: 5,
  OTHER: 10,
};

// Safe script name pattern: alphanumeric, hyphens, underscores, colons, dots
// Rejects shell metacharacters like $, ;, |, &, `, (, ), etc.
const SAFE_SCRIPT_NAME_REGEX = /^[a-zA-Z0-9_:.-]+$/;

/**
 * Checks if a file exists
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect npm/yarn scripts from package.json
 */
async function detectPackageJsonScripts(dirPath: string): Promise<RunConfig[]> {
  const packageJsonPath = path.join(dirPath, 'package.json');
  if (!await exists(packageJsonPath)) return [];

  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    const scripts = pkg.scripts || {};

    const configs: RunConfig[] = [];

    // Scripts to exclude (test, lint, etc.)
    const excludePatterns = ['test', 'lint', 'format', 'prettier', 'eslint', 'typecheck', 'clean', 'prepare', 'precommit', 'postinstall'];

    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command !== 'string') continue;

      // Validate script name to prevent command injection via malicious names
      if (!SAFE_SCRIPT_NAME_REGEX.test(name)) {
        console.warn(`[detectRunConfigs] Skipping script with unsafe name: ${name}`);
        continue;
      }

      // Skip excluded scripts
      if (excludePatterns.some(p => name.toLowerCase().includes(p))) {
        continue;
      }

      // Determine priority based on script name
      let priority = PRIORITY.OTHER;
      if (['dev', 'develop', 'serve', 'watch'].includes(name)) {
        priority = PRIORITY.DEV;
      } else if (['start', 'run'].includes(name)) {
        priority = PRIORITY.START;
      } else if (['build', 'compile'].includes(name)) {
        priority = PRIORITY.BUILD;
      }

      configs.push({
        name,
        command: `npm run ${name}`,
        source: 'package.json',
        description: command.length > 50 ? command.substring(0, 47) + '...' : command,
        priority,
      });
    }

    return configs.sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

/**
 * Detect Makefile targets
 */
async function detectMakefileTargets(dirPath: string): Promise<RunConfig[]> {
  const makefilePath = path.join(dirPath, 'Makefile');
  if (!await exists(makefilePath)) return [];

  try {
    const content = await fs.readFile(makefilePath, 'utf-8');
    const configs: RunConfig[] = [];

    // Look for common run targets
    const runTargets = ['run', 'start', 'dev', 'serve', 'watch'];
    const targetRegex = /^([a-zA-Z_][a-zA-Z0-9_-]*):/gm;

    let match;
    while ((match = targetRegex.exec(content)) !== null) {
      const targetName = match[1];

      // Validate target name to prevent command injection
      if (!SAFE_SCRIPT_NAME_REGEX.test(targetName)) {
        console.warn(`[detectRunConfigs] Skipping Makefile target with unsafe name: ${targetName}`);
        continue;
      }

      if (runTargets.includes(targetName.toLowerCase())) {
        let priority = PRIORITY.OTHER;
        if (['dev', 'serve', 'watch'].includes(targetName.toLowerCase())) {
          priority = PRIORITY.DEV;
        } else if (['run', 'start'].includes(targetName.toLowerCase())) {
          priority = PRIORITY.START;
        }

        configs.push({
          name: targetName,
          command: `make ${targetName}`,
          source: 'Makefile',
          priority,
        });
      }
    }

    return configs.sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

/**
 * Detect Cargo.toml (Rust projects)
 */
async function detectCargoRun(dirPath: string): Promise<RunConfig[]> {
  const cargoPath = path.join(dirPath, 'Cargo.toml');
  if (!await exists(cargoPath)) return [];

  return [{
    name: 'run',
    command: 'cargo run',
    source: 'Cargo.toml',
    priority: PRIORITY.START,
  }];
}

/**
 * Detect go.mod (Go projects)
 */
async function detectGoRun(dirPath: string): Promise<RunConfig[]> {
  const goModPath = path.join(dirPath, 'go.mod');
  if (!await exists(goModPath)) return [];

  return [{
    name: 'run',
    command: 'go run .',
    source: 'go.mod',
    priority: PRIORITY.START,
  }];
}

/**
 * Detect Python projects (pyproject.toml or setup.py)
 */
async function detectPythonRun(dirPath: string): Promise<RunConfig[]> {
  const hasPyproject = await exists(path.join(dirPath, 'pyproject.toml'));
  const hasSetupPy = await exists(path.join(dirPath, 'setup.py'));

  if (!hasPyproject && !hasSetupPy) return [];

  const configs: RunConfig[] = [];
  const source = hasPyproject ? 'pyproject.toml' : 'pyproject.toml';

  // Check for common entry points
  const mainPy = path.join(dirPath, 'main.py');
  const appPy = path.join(dirPath, 'app.py');

  if (await exists(mainPy)) {
    configs.push({
      name: 'main.py',
      command: 'python main.py',
      source,
      priority: PRIORITY.START,
    });
  }

  if (await exists(appPy)) {
    configs.push({
      name: 'app.py',
      command: 'python app.py',
      source,
      priority: PRIORITY.START,
    });
  }

  return configs;
}

/**
 * Detect Docker Compose
 */
async function detectDockerCompose(dirPath: string): Promise<RunConfig[]> {
  const composePath = path.join(dirPath, 'docker-compose.yml');
  const composeAltPath = path.join(dirPath, 'docker-compose.yaml');

  if (!await exists(composePath) && !await exists(composeAltPath)) return [];

  return [{
    name: 'docker-compose up',
    command: 'docker-compose up',
    source: 'docker-compose.yml',
    priority: PRIORITY.START,
  }];
}

/**
 * Detect all run configurations for a project
 */
export async function detectRunConfigs(dirPath: string): Promise<RunConfig[]> {
  const results = await Promise.all([
    detectPackageJsonScripts(dirPath),
    detectMakefileTargets(dirPath),
    detectCargoRun(dirPath),
    detectGoRun(dirPath),
    detectPythonRun(dirPath),
    detectDockerCompose(dirPath),
  ]);

  // Flatten and sort by priority
  const allConfigs = results.flat();
  allConfigs.sort((a, b) => a.priority - b.priority);

  return allConfigs;
}
