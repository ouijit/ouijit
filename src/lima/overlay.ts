/**
 * Per-task bind-mount overlay for sandboxed Lima tasks.
 *
 * Parses the project's `.gitignore` to find bare directory entries and
 * emits guest-side bash that creates an overlay directory on the VM's
 * local ext4 and bind-mounts each ignored directory onto an empty
 * overlay. This isolates darwin-arm64 host `node_modules` / `target` /
 * `.venv` from the linux guest, avoiding native-module ABI mismatches
 * and slow-start copies.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

function shEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Parse the repo-root `.gitignore` and return the list of bare directory
 * names to bind-mount. Rejects globs, negations, nested paths, and
 * comments. Order-preserving dedupe.
 */
export async function parseIgnoredDirs(projectPath: string): Promise<string[]> {
  const gitignorePath = path.join(projectPath, '.gitignore');
  let contents: string;
  try {
    contents = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('!')) continue;
    if (/[*?[\]]/.test(line)) continue;
    const entry = line.replace(/^\//, '').replace(/\/$/, '');
    if (!entry) continue;
    if (entry.includes('/')) continue;
    dirs.push(entry);
  }
  return Array.from(new Set(dirs));
}

/**
 * Build bash that creates a per-task overlay directory on the guest's
 * local ext4, bind-mounts each gitignored directory from the worktree
 * onto it, and installs a trap to unmount on shell exit. Refcount lives
 * under flock on the guest so concurrent PTYs share mounts.
 *
 * Returns an empty string when there are no directories to isolate.
 */
export function buildOverlayBindMountSetup(opts: { worktreePath: string; taskId: number; dirs: string[] }): string {
  if (opts.dirs.length === 0) return '';
  const worktree = shEscape(opts.worktreePath);
  const task = shEscape(String(opts.taskId));
  // Quoted heredoc disables shell expansion — entries are safe even with $, `, quotes.
  const dirList = opts.dirs.join('\n');
  return `set -e
WORKTREE=${worktree}
TASK=${task}
OVERLAY_ROOT="/var/lib/ouijit/overlays/T-$TASK"
LOCK="$OVERLAY_ROOT/.lock"
COUNT="$OVERLAY_ROOT/.count"

# Sudo must be non-interactive or the rest of this script would hang.
sudo -n true 2>/dev/null || { echo "ouijit: sandbox requires passwordless sudo" >&2; exit 1; }

sudo mkdir -p "$OVERLAY_ROOT"
sudo touch "$LOCK" "$COUNT"

IGNORED_DIRS=$(cat <<'OUIJIT_IGNORED_DIRS_EOF'
${dirList}
OUIJIT_IGNORED_DIRS_EOF
)

(
  flock -x 9
  N=$(cat "$COUNT" 2>/dev/null || echo 0)
  echo $((N+1)) | sudo tee "$COUNT" >/dev/null
  while IFS= read -r dir; do
    [ -z "$dir" ] && continue
    overlay="$OVERLAY_ROOT/$dir"
    target="$WORKTREE/$dir"
    sudo mkdir -p "$overlay" "$target"
    mountpoint -q "$target" || sudo mount --bind "$overlay" "$target"
  done <<< "$IGNORED_DIRS"
) 9<"$LOCK"

_ouijit_overlay_cleanup() {
  (
    flock -x 9
    N=$(cat "$COUNT" 2>/dev/null || echo 0)
    N=$((N-1))
    echo $N | sudo tee "$COUNT" >/dev/null
    if [ "$N" -le 0 ]; then
      while IFS= read -r dir; do
        [ -z "$dir" ] && continue
        sudo umount "$WORKTREE/$dir" 2>/dev/null || true
      done <<< "$IGNORED_DIRS"
    fi
  ) 9<"$LOCK"
}
trap _ouijit_overlay_cleanup EXIT
`;
}
