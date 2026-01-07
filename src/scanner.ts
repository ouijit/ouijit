import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { nativeImage } from 'electron';

export interface Project {
  name: string;
  path: string;
  hasGit: boolean;
  hasClaude: boolean;
  lastModified: Date;
  description?: string;
  language?: string;
  iconDataUrl?: string;
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
  // macOS icons - various locations
  'icon.icns',
  'icons.icns',
  'src/icon.icns',
  'src/images/icon.icns',
  'src/assets/icon.icns',
  'resources/icon.icns',
  'build/icon.icns',
  'build/icons.icns',
  'build/darwin/icon.icns',
  'build/darwin/icons.icns',
  'assets/icon.icns',
  'assets/icons.icns',
  'electron/icon.icns',
  'images/icon.icns',
  // Windows icons
  'icon.ico',
  'icons.ico',
  'src/icon.ico',
  'src/images/icon.ico',
  'resources/icon.ico',
  'build/icon.ico',
  'assets/icon.ico',
  // Standard image icons
  'icon.png',
  'icon.jpg',
  'icon.svg',
  'src/images/icon.png',
  'src/images/logo.png',
  'app-icon.png',
  'app-icon.svg',
  'logo.png',
  'logo.jpg',
  'logo.svg',
  // Electron Forge / Electron Builder locations
  'resources/icon.png',
  'resources/icons/icon.png',
  'build/icons/icon.png',
  'buildResources/icon.png',
  'buildResources/icon.icns',
  // Web/general locations
  'favicon.ico',
  'favicon.png',
  'favicon.svg',
  'assets/icon.png',
  'assets/logo.png',
  'public/favicon.ico',
  'public/favicon.png',
  'public/logo.png',
  'public/icon.png',
  'src/assets/icon.png',
  'src/assets/logo.png',
  'static/icon.png',
  'static/logo.png',
  'images/icon.png',
  'images/logo.png',
];

/**
 * Finds an icon file and converts it to a data URL
 */
async function getIconDataUrl(dirPath: string): Promise<string | undefined> {
  for (const iconFile of ICON_FILES) {
    const iconPath = path.join(dirPath, iconFile);
    if (await exists(iconPath)) {
      try {
        const image = nativeImage.createFromPath(iconPath);
        if (!image.isEmpty()) {
          // Resize to 96x96 for consistent display (2x for retina)
          const resized = image.resize({ width: 96, height: 96, quality: 'best' });
          return resized.toDataURL();
        }
      } catch (error) {
        console.warn(`Failed to load icon: ${iconPath}`, error);
      }
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
    iconDataUrl: await getIconDataUrl(dirPath),
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
