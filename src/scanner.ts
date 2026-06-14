import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { nativeImage } from 'electron';
import type { Project } from './types';
import { getDatabase } from './db/database';
import { ProjectRepo } from './db/repos/projectRepo';
import { getLogger } from './logger';

const scannerLog = getLogger().scope('scanner');

export type { Project };

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
  if ((await exists(path.join(dirPath, 'pyproject.toml'))) || (await exists(path.join(dirPath, 'setup.py')))) {
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
 * Trims fully-transparent border pixels so macOS-style app icons (which include
 * built-in padding) render at the same visual size as identicons.
 */
function trimTransparentBorder(image: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = image.getSize();
  if (width === 0 || height === 0) return image;

  const bitmap = image.toBitmap();
  if (bitmap.length < width * height * 4) return image;

  const alphaThreshold = 8;
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = bitmap[(y * width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (bottom < 0 || right < 0) return image;

  const cropW = right - left + 1;
  const cropH = bottom - top + 1;
  if (cropW === width && cropH === height) return image;

  return image.crop({ x: left, y: top, width: cropW, height: cropH });
}

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
          const trimmed = trimTransparentBorder(image);
          // Resize to 96x96 for consistent display (2x for retina)
          const resized = trimmed.resize({ width: 96, height: 96, quality: 'best' });
          return resized.toDataURL();
        }
      } catch (error) {
        scannerLog.warn('failed to load icon', {
          path: iconPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return undefined;
}

/**
 * Creates a Project object from a directory path
 */
async function createProject(dirPath: string, iconColor?: string): Promise<Project> {
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
    iconColor,
  };
}

/**
 * Returns all manually-added projects enriched with metadata.
 * Queries the DB for added project paths, filters to those still on disk,
 * and builds full Project objects with language/description/icon metadata.
 */
export async function getProjectList(): Promise<Project[]> {
  const db = getDatabase();
  const projectRepo = new ProjectRepo(db);
  const rows = projectRepo.getAll();

  const projects: Project[] = [];
  for (const row of rows) {
    if (await exists(row.path)) {
      const project = await createProject(row.path, row.icon_color ?? undefined);
      projects.push(project);
    }
  }

  return projects;
}
