/**
 * Per-task bind-mount overlay for sandboxed Lima tasks.
 *
 * Enumerates every gitignored path in the project via `git ls-files` and
 * emits guest-side bash that creates an overlay directory on the VM's
 * local ext4 and bind-mounts an empty placeholder over each path. Both
 * directory and file masks are supported — directories mask whole trees
 * (darwin-arm64 `node_modules` / `target` / `.venv`), files mask secrets
 * like `.env`, `.npmrc`, `config/secrets.yml`.
 */
import { execFile, type ExecFileOptions } from 'node:child_process';
import { getLogger } from '../logger';

const overlayLog = getLogger().scope('overlay');

/**
 * Promise wrapper around `execFile` that always resolves to
 * `{ stdout, stderr }` strings. Written manually (rather than using
 * `util.promisify`) so tests can mock `execFile` with a plain
 * callback-style function without needing to preserve
 * `util.promisify.custom`.
 */
function execFileAsync(
  file: string,
  args: string[],
  opts: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({
        stdout: typeof stdout === 'string' ? stdout : stdout.toString('utf8'),
        stderr: typeof stderr === 'string' ? stderr : stderr.toString('utf8'),
      });
    });
  });
}

function shEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

export interface MaskEntry {
  /** Repo-root-relative, forward-slash. Never starts with `/`, never contains `..`. */
  relPath: string;
  type: 'file' | 'directory';
}

/**
 * Enumerate every gitignored path in the project using git's own matcher.
 *
 * `--directory` collapses fully-ignored directories to just the dir name
 * (trailing slash) so we don't descend into `node_modules` etc. `-z`
 * null-delimits output so spaces and newlines in filenames are safe.
 *
 * Delegates all gitignore semantics — negations, nested `.gitignore`,
 * `core.excludesFile`, globs — to git itself. Returns [] on any failure
 * (missing git, not a repo, perms); the caller treats empty as "nothing
 * to mask" and logs a warning.
 */
export async function listMaskedPaths(projectPath: string): Promise<MaskEntry[]> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      'git',
      ['-C', projectPath, 'ls-files', '-o', '-i', '--exclude-standard', '--directory', '-z'],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (error) {
    overlayLog.warn('git ls-files failed — no sandbox masks applied', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const masks: MaskEntry[] = [];
  for (const raw of stdout.split('\0')) {
    if (!raw) continue;
    if (raw.startsWith('/') || raw.includes('..')) continue;

    if (raw.endsWith('/')) {
      masks.push({ relPath: raw.slice(0, -1), type: 'directory' });
    } else {
      masks.push({ relPath: raw, type: 'file' });
    }
  }
  return masks;
}

/**
 * Build bash that creates a per-task overlay on the guest's local ext4
 * and bind-mounts an empty placeholder over each masked path in the
 * worktree. Supports both directory masks (mkdir + bind) and file masks
 * (touch empty placeholder + bind). Idempotent: re-running for an
 * existing task is a no-op.
 *
 * Best-effort by design — any failure logs to stderr and continues so
 * the user still gets a working shell. Mounts persist for the life of
 * the task and are reclaimed by `buildOverlayCleanup` on task delete.
 *
 * Returns an empty string when there are no masks.
 */
export function buildOverlayBindMountSetup(opts: { worktreePath: string; taskId: number; masks: MaskEntry[] }): string {
  if (opts.masks.length === 0) return '';
  const worktree = shEscape(opts.worktreePath);
  const task = shEscape(String(opts.taskId));
  // Single-char type prefix + space + path. Quoted heredoc disables expansion.
  const maskList = opts.masks.map((m) => `${m.type === 'directory' ? 'd' : 'f'} ${m.relPath}`).join('\n');
  return `_ouijit_overlay_setup() {
  local WORKTREE=${worktree}
  local TASK=${task}
  local OVERLAY_ROOT="/var/lib/ouijit/overlays/T-$TASK"

  if ! sudo -n true 2>/dev/null; then
    echo "ouijit: sandbox overlay skipped (passwordless sudo unavailable)" >&2
    return 0
  fi

  sudo mkdir -p "$OVERLAY_ROOT" || { echo "ouijit: overlay mkdir failed" >&2; return 0; }

  local MASKS
  MASKS=$(cat <<'OUIJIT_MASKS_EOF'
${maskList}
OUIJIT_MASKS_EOF
)

  # Sidecar files for cleanup on task delete — cleanup umounts then rm -rf.
  # Store raw paths in .paths (strip type prefix); umount works on file and dir alike.
  printf '%s\\n' "$WORKTREE" | sudo tee "$OVERLAY_ROOT/.worktree" >/dev/null
  printf '%s\\n' "$MASKS" | awk '{ $1=""; sub(/^ /,""); print }' | sudo tee "$OVERLAY_ROOT/.paths" >/dev/null

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local type="\${line%% *}"
    local rel="\${line#* }"
    local overlay="$OVERLAY_ROOT/$rel"
    local target="$WORKTREE/$rel"

    if [ "$type" = "d" ]; then
      sudo mkdir -p "$overlay" "$target" 2>/dev/null || {
        echo "ouijit: overlay mkdir $rel failed" >&2
        continue
      }
    else
      # File mask: ensure parent dirs exist, then create empty placeholder
      # and empty target (Linux rejects mount --bind onto a non-existent target).
      sudo mkdir -p "$(dirname "$overlay")" "$(dirname "$target")" 2>/dev/null || {
        echo "ouijit: overlay parent mkdir $rel failed" >&2
        continue
      }
      sudo touch "$overlay" "$target" 2>/dev/null || {
        echo "ouijit: overlay touch $rel failed" >&2
        continue
      }
    fi

    if ! mountpoint -q "$target"; then
      sudo mount --bind "$overlay" "$target" 2>/dev/null || echo "ouijit: bind mount $rel failed" >&2
    fi
  done <<< "$MASKS"
}
_ouijit_overlay_setup
unset -f _ouijit_overlay_setup
`;
}

/**
 * Build bash that umounts every bind mount belonging to a task overlay
 * and removes the overlay directory. Reads the worktree path and path
 * list from sidecar files written by `buildOverlayBindMountSetup`, then
 * falls back to scanning `/proc/self/mountinfo` for any mounts whose
 * source still references the overlay (handles older overlays without
 * sidecars or partial state).
 */
export function buildOverlayCleanup(taskId: number): string {
  const task = shEscape(String(taskId));
  return `set +e
TASK=${task}
OVERLAY_ROOT="/var/lib/ouijit/overlays/T-$TASK"
[ -d "$OVERLAY_ROOT" ] || exit 0

if [ -f "$OVERLAY_ROOT/.worktree" ] && [ -f "$OVERLAY_ROOT/.paths" ]; then
  WORKTREE=$(cat "$OVERLAY_ROOT/.worktree")
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    sudo umount "$WORKTREE/$rel" 2>/dev/null
  done < "$OVERLAY_ROOT/.paths"
fi

# Belt-and-suspenders: umount anything still pointing into this overlay.
awk -v root="$OVERLAY_ROOT/" '$4 ~ "^"root {print $5}' /proc/self/mountinfo 2>/dev/null \\
  | while IFS= read -r mp; do
      [ -n "$mp" ] && sudo umount "$mp" 2>/dev/null
    done

sudo rm -rf "$OVERLAY_ROOT"
`;
}
