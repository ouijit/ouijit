import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface Project {
  name: string;
  path: string;
  hasGit: boolean;
  hasClaude: boolean;
  lastModified: Date;
  description?: string;
  language?: string;
  iconPath?: string;
}

const PROJECT_DIRECTORIES = [
  '~/Projects',
  '~/Developer',
  '~/dev',
  '~/code',
  '~/repos',
  '~/workspace',
];

const MAX_SCAN_DEPTH = 2;

/**
 * Expands ~ to the user's home directory
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Checks if a path exists
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
 * Checks if a directory is a project (contains .git, .claude, or CLAUDE.md)
 */
async function isProject(dirPath: string): Promise<boolean> {
  const hasGitDir = await exists(path.join(dirPath, '.git'));
  const hasClaudeDir = await exists(path.join(dirPath, '.claude'));
  const hasClaudeMd = await exists(path.join(dirPath, 'CLAUDE.md'));

  return hasGitDir || hasClaudeDir || hasClaudeMd;
}

/**
 * Detects the primary programming language of a project
 */
async function detectLanguage(dirPath: string): Promise<string | undefined> {
  // Check for language-specific files in priority order
  if (await exists(path.join(dirPath, 'Cargo.toml'))) {
    return 'Rust';
  }
  if (await exists(path.join(dirPath, 'go.mod'))) {
    return 'Go';
  }
  if (await exists(path.join(dirPath, 'pyproject.toml')) || await exists(path.join(dirPath, 'setup.py'))) {
    return 'Python';
  }
  if (await exists(path.join(dirPath, 'package.json'))) {
    // Check for TypeScript
    if (await exists(path.join(dirPath, 'tsconfig.json'))) {
      return 'TypeScript';
    }
    return 'JavaScript';
  }

  return undefined;
}

/**
 * Tries to read the description from package.json
 */
async function getDescription(dirPath: string): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(dirPath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    return packageJson.description || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Common icon file names to look for
 */
const ICON_FILES = [
  'icon.png',
  'icon.jpg',
  'icon.svg',
  'app-icon.png',
  'app-icon.svg',
  'logo.png',
  'logo.jpg',
  'logo.svg',
  'favicon.ico',
  'favicon.png',
  'favicon.svg',
  '.icon.png',
  'assets/icon.png',
  'assets/logo.png',
  'public/favicon.ico',
  'public/favicon.png',
  'public/logo.png',
  'src/assets/icon.png',
  'src/assets/logo.png',
  'resources/icon.png',
  'build/icon.png',
];

/**
 * Finds an icon file for the project
 */
async function findIconPath(dirPath: string): Promise<string | undefined> {
  for (const iconFile of ICON_FILES) {
    const iconPath = path.join(dirPath, iconFile);
    if (await exists(iconPath)) {
      return iconPath;
    }
  }
  return undefined;
}

/**
 * Creates a Project object from a directory path
 */
async function createProject(dirPath: string): Promise<Project> {
  const stats = await fs.stat(dirPath);
  const hasGit = await exists(path.join(dirPath, '.git'));
  const hasClaudeDir = await exists(path.join(dirPath, '.claude'));
  const hasClaudeMd = await exists(path.join(dirPath, 'CLAUDE.md'));

  return {
    name: path.basename(dirPath),
    path: dirPath,
    hasGit,
    hasClaude: hasClaudeDir || hasClaudeMd,
    lastModified: stats.mtime,
    description: await getDescription(dirPath),
    language: await detectLanguage(dirPath),
    iconPath: await findIconPath(dirPath),
  };
}

/**
 * Recursively scans a directory for projects
 */
async function scanDirectory(dirPath: string, depth: number = 0): Promise<Project[]> {
  const projects: Project[] = [];

  if (depth > MAX_SCAN_DEPTH) {
    return projects;
  }

  try {
    // Check if current directory is a project
    if (await isProject(dirPath)) {
      const project = await createProject(dirPath);
      projects.push(project);
      // Don't scan deeper into projects
      return projects;
    }

    // If not a project and we can go deeper, scan subdirectories
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden directories and common non-project directories
      if (entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'vendor' ||
          entry.name === 'target' ||
          entry.name === 'dist' ||
          entry.name === 'build') {
        continue;
      }

      if (entry.isDirectory()) {
        const subDirPath = path.join(dirPath, entry.name);
        const subProjects = await scanDirectory(subDirPath, depth + 1);
        projects.push(...subProjects);
      }
    }
  } catch (error) {
    // Skip inaccessible directories
    console.warn(`Unable to scan directory: ${dirPath}`, error);
  }

  return projects;
}

/**
 * Scans predefined directories for projects
 */
export async function scanForProjects(): Promise<Project[]> {
  const allProjects: Project[] = [];

  for (const dir of PROJECT_DIRECTORIES) {
    const expandedPath = expandTilde(dir);

    if (await exists(expandedPath)) {
      const projects = await scanDirectory(expandedPath);
      allProjects.push(...projects);
    }
  }

  // Sort by last modified date (most recent first)
  allProjects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

  return allProjects;
}
