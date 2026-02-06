import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { nativeImage } from 'electron';
import type { Project } from './types';

export type { Project };

const PROJECT_DIRECTORIES = [
  '~/Projects',
  '~/Developer',
  '~/dev',
  '~/code',
  '~/repos',
  '~/workspace',
  '~/Ouijit/imports',
  '~/Ouijit/projects',
];

const ADDED_PROJECTS_FILE = path.join(os.homedir(), 'Ouijit', 'added-projects.json');

/**
 * Get list of manually added project paths
 */
export async function getAddedProjects(): Promise<string[]> {
  try {
    const content = await fs.readFile(ADDED_PROJECTS_FILE, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

/**
 * Save list of manually added project paths
 */
async function saveAddedProjects(projects: string[]): Promise<void> {
  const dir = path.dirname(ADDED_PROJECTS_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(ADDED_PROJECTS_FILE, JSON.stringify({ projects }, null, 2), 'utf-8');
}

/**
 * Add a project folder to the persisted list
 */
export async function addProject(folderPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify the path exists
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) {
      return { success: false, error: 'Path is not a directory' };
    }

    const projects = await getAddedProjects();
    if (!projects.includes(folderPath)) {
      projects.push(folderPath);
      await saveAddedProjects(projects);
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Remove a project folder from the persisted list
 */
export async function removeProject(folderPath: string): Promise<{ success: boolean }> {
  const projects = await getAddedProjects();
  const filtered = projects.filter(p => p !== folderPath);
  await saveAddedProjects(filtered);
  return { success: true };
}

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
 * Checks if a directory is a project (contains .git, .claude, CLAUDE.md, or .ouijit-import.json)
 */
async function isProject(dirPath: string): Promise<boolean> {
  const hasGitDir = await exists(path.join(dirPath, '.git'));
  const hasClaudeDir = await exists(path.join(dirPath, '.claude'));
  const hasClaudeMd = await exists(path.join(dirPath, 'CLAUDE.md'));
  const hasOuijitImport = await exists(path.join(dirPath, '.ouijit-import.json'));

  return hasGitDir || hasClaudeDir || hasClaudeMd || hasOuijitImport;
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
  'src/assets/icons/icon.png',
  'src/assets/icons/icon.icns',
  'src/assets/icons/icon.ico',
  'src/assets/icons/logo.png',
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

  const [description, language, iconDataUrl] = await Promise.all([
    getDescription(dirPath),
    detectLanguage(dirPath),
    getIconDataUrl(dirPath),
  ]);

  return {
    name: path.basename(dirPath),
    path: dirPath,
    hasGit,
    hasClaude: hasClaudeDir || hasClaudeMd,
    lastModified: stats.mtime,
    description,
    language,
    iconDataUrl,
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
  const seenPaths = new Set<string>();

  // First, add manually added projects (they take priority)
  const addedPaths = await getAddedProjects();
  for (const projectPath of addedPaths) {
    if (await exists(projectPath) && !seenPaths.has(projectPath)) {
      seenPaths.add(projectPath);
      const project = await createProject(projectPath);
      allProjects.push(project);
    }
  }

  // Scan all predefined directories in parallel
  const scanResults = await Promise.all(
    PROJECT_DIRECTORIES.map(async (dir) => {
      const expandedPath = expandTilde(dir);
      if (await exists(expandedPath)) {
        return scanDirectory(expandedPath);
      }
      return [];
    })
  );

  for (const projects of scanResults) {
    for (const project of projects) {
      if (!seenPaths.has(project.path)) {
        seenPaths.add(project.path);
        allProjects.push(project);
      }
    }
  }

  // Sort by last modified date (most recent first)
  allProjects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

  return allProjects;
}
