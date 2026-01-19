import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import * as tar from 'tar';
import AdmZip from 'adm-zip';
import type { Project, OuijitManifest, ExportResult } from '../types';

/**
 * Patterns to exclude from the source tarball
 * These are common dependency/build directories that can be recreated
 */
const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'venv',
  '.venv',
  '__pycache__',
  '.pytest_cache',
  'target',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.nyc_output',
  '.turbo',
  '.svelte-kit',
  '.vercel',
  '.netlify',
];

const EXCLUDE_FILES = [
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '*.pyc',
  '*.pyo',
  '.env.local',
  '.env.*.local',
];

export interface ExportOptions {
  project: Project;
  outputPath: string;
  tagline?: string;
  createdBy?: string;
}

/**
 * Maps a language string to a runtime type
 */
function mapLanguageToRuntime(language?: string): OuijitManifest['runtime'] {
  const map: Record<string, OuijitManifest['runtime']> = {
    'TypeScript': 'node',
    'JavaScript': 'node',
    'Python': 'python',
    'Rust': 'rust',
    'Go': 'go',
  };
  return map[language || ''] || 'unknown';
}

/**
 * Gets git information from a project directory
 */
async function getGitInfo(projectPath: string): Promise<{ remoteUrl?: string; commitHash?: string } | null> {
  try {
    const opts = { cwd: projectPath, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'] };

    let commitHash: string | undefined;
    try {
      commitHash = execSync('git rev-parse HEAD', opts).toString().trim();
    } catch {
      // Not a git repo or no commits
    }

    let remoteUrl: string | undefined;
    try {
      remoteUrl = execSync('git remote get-url origin', opts).toString().trim();
    } catch {
      // No remote configured
    }

    if (!commitHash && !remoteUrl) {
      return null;
    }

    return { remoteUrl, commitHash };
  } catch {
    return null;
  }
}

/**
 * Calculates SHA256 checksum of a file
 */
async function calculateSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Checks if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads .gitignore patterns from a project
 */
async function getGitignorePatterns(projectPath: string): Promise<string[]> {
  const gitignorePath = path.join(projectPath, '.gitignore');
  try {
    const content = await fs.readFile(gitignorePath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Detects the runtime version from project files
 */
async function detectRuntimeVersion(project: Project): Promise<string | undefined> {
  const projectPath = project.path;

  // Check for .nvmrc or .node-version
  for (const file of ['.nvmrc', '.node-version']) {
    const filePath = path.join(projectPath, file);
    if (await fileExists(filePath)) {
      try {
        const version = await fs.readFile(filePath, 'utf8');
        return version.trim();
      } catch {
        // Ignore errors
      }
    }
  }

  // Check package.json engines
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (await fileExists(packageJsonPath)) {
    try {
      const content = await fs.readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(content);
      if (pkg.engines?.node) {
        return pkg.engines.node;
      }
    } catch {
      // Ignore errors
    }
  }

  return undefined;
}

/**
 * Creates a source tarball from a project, excluding dependencies and build artifacts
 */
async function createSourceTarball(projectPath: string, outputPath: string): Promise<void> {
  const gitignorePatterns = await getGitignorePatterns(projectPath);

  // Combine all exclusion patterns
  const excludePatterns = [...EXCLUDE_DIRS, ...gitignorePatterns];

  // Get all files in the project directory
  const entries = await fs.readdir(projectPath);

  // Filter out excluded directories
  const filesToInclude = entries.filter(entry => {
    // Always exclude these directories
    if (EXCLUDE_DIRS.includes(entry)) {
      return false;
    }
    // Check gitignore patterns (simple matching)
    for (const pattern of excludePatterns) {
      if (pattern === entry || pattern === `${entry}/`) {
        return false;
      }
    }
    return true;
  });

  await tar.create(
    {
      gzip: true,
      file: outputPath,
      cwd: projectPath,
      filter: (filePath: string) => {
        // Skip excluded files
        const basename = path.basename(filePath);
        if (EXCLUDE_FILES.some(pattern => {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(basename);
          }
          return pattern === basename;
        })) {
          return false;
        }

        // Skip excluded directories anywhere in path
        const parts = filePath.split(path.sep);
        for (const part of parts) {
          if (EXCLUDE_DIRS.includes(part)) {
            return false;
          }
        }

        return true;
      },
    },
    filesToInclude
  );
}

/**
 * Exports a project as a .ouijit file
 */
export async function exportProject(options: ExportOptions): Promise<ExportResult> {
  const { project, outputPath, tagline, createdBy } = options;
  const tempDir = path.join(os.tmpdir(), `ouijit-export-${Date.now()}`);

  try {
    await fs.mkdir(tempDir, { recursive: true });

    // 1. Create source tarball
    const sourceTarPath = path.join(tempDir, 'source.tar.gz');
    await createSourceTarball(project.path, sourceTarPath);

    // 2. Calculate checksum
    const checksum = await calculateSha256(sourceTarPath);

    // 3. Get git info if available
    const gitInfo = await getGitInfo(project.path);

    // 4. Detect runtime version
    const runtimeVersion = await detectRuntimeVersion(project);

    // 5. Create manifest
    const manifest: OuijitManifest = {
      version: 1,
      name: project.name,
      tagline,
      runtime: mapLanguageToRuntime(project.language),
      runtimeVersion,
      entrypoint: project.runConfigs?.[0]?.command,
      createdAt: new Date().toISOString(),
      createdBy,
      sourceRepo: gitInfo?.remoteUrl,
      sourceCommit: gitInfo?.commitHash,
      sourceChecksum: checksum,
    };

    // 6. Write manifest
    const manifestPath = path.join(tempDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    // 7. Create final .ouijit zip
    const zip = new AdmZip();
    zip.addLocalFile(manifestPath);
    zip.addLocalFile(sourceTarPath);

    // Debug: verify entries before writing
    const entries = zip.getEntries();
    console.log('Creating .ouijit with entries:', entries.map(e => e.entryName));

    zip.writeZip(outputPath);
    console.log('Wrote .ouijit to:', outputPath);

    const stats = await fs.stat(outputPath);

    return {
      success: true,
      outputPath,
      sizeBytes: stats.size,
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    // Cleanup temp dir
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
