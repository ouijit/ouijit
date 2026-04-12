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
 * names to bind-mount. Accepts plain entries (`node_modules`, `target/`,
 * `/.venv`) and recursive-glob shorthand for a single dir name
 * (`**​/node_modules`). Rejects negations, comments, other globs, and
 * nested paths. Order-preserving dedupe.
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
    let entry = line.replace(/^\//, '').replace(/\/$/, '');
    if (!entry) continue;
    // Accept `**/<name>` as `<name>` (only meaningful glob form for a bare dir).
    if (entry.startsWith('**/')) {
      entry = entry.slice(3);
    }
    if (/[*?[\]]/.test(entry)) continue;
    if (!entry || entry.includes('/')) continue;
    dirs.push(entry);
  }
  return Array.from(new Set(dirs));
}

/**
 * Build bash that creates a per-task overlay directory on the guest's
 * local ext4 and bind-mounts each gitignored directory from the worktree
 * onto it. Idempotent: re-running for an existing task is a no-op.
 *
 * Best-effort by design — any failure logs to stderr and continues so
 * the user still gets a working shell. Mounts persist for the life of
 * the task and are reclaimed by `buildOverlayCleanup` on task delete.
 *
 * Returns an empty string when there are no directories to isolate.
 */
export function buildOverlayBindMountSetup(opts: { worktreePath: string; taskId: number; dirs: string[] }): string {
  if (opts.dirs.length === 0) return '';
  const worktree = shEscape(opts.worktreePath);
  const task = shEscape(String(opts.taskId));
  // Quoted heredoc disables shell expansion — entries are safe even with $, `, quotes.
  const dirList = opts.dirs.join('\n');
  return `_ouijit_overlay_setup() {
  local WORKTREE=${worktree}
  local TASK=${task}
  local OVERLAY_ROOT="/var/lib/ouijit/overlays/T-$TASK"

  if ! sudo -n true 2>/dev/null; then
    echo "ouijit: sandbox overlay skipped (passwordless sudo unavailable)" >&2
    return 0
  fi

  sudo mkdir -p "$OVERLAY_ROOT" || { echo "ouijit: overlay mkdir failed" >&2; return 0; }

  local IGNORED_DIRS
  IGNORED_DIRS=$(cat <<'OUIJIT_IGNORED_DIRS_EOF'
${dirList}
OUIJIT_IGNORED_DIRS_EOF
)

  # Stash worktree path + dir list so cleanup on task delete can umount
  # before rm -rf, even after the host worktree directory is gone.
  printf '%s\\n' "$WORKTREE" | sudo tee "$OVERLAY_ROOT/.worktree" >/dev/null
  printf '%s\\n' "$IGNORED_DIRS" | sudo tee "$OVERLAY_ROOT/.dirs" >/dev/null

  while IFS= read -r dir; do
    [ -z "$dir" ] && continue
    local overlay="$OVERLAY_ROOT/$dir"
    local target="$WORKTREE/$dir"
    sudo mkdir -p "$overlay" "$target" 2>/dev/null || { echo "ouijit: overlay mkdir $dir failed" >&2; continue; }
    if ! mountpoint -q "$target"; then
      sudo mount --bind "$overlay" "$target" 2>/dev/null || echo "ouijit: bind mount $dir failed" >&2
    fi
  done <<< "$IGNORED_DIRS"
}
_ouijit_overlay_setup
unset -f _ouijit_overlay_setup
`;
}

/**
 * Build bash that umounts every bind mount belonging to a task overlay
 * and removes the overlay directory. Reads the worktree path and dir
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

if [ -f "$OVERLAY_ROOT/.worktree" ] && [ -f "$OVERLAY_ROOT/.dirs" ]; then
  WORKTREE=$(cat "$OVERLAY_ROOT/.worktree")
  while IFS= read -r dir; do
    [ -z "$dir" ] && continue
    sudo umount "$WORKTREE/$dir" 2>/dev/null
  done < "$OVERLAY_ROOT/.dirs"
fi

# Belt-and-suspenders: umount anything still pointing into this overlay.
awk -v root="$OVERLAY_ROOT/" '$4 ~ "^"root {print $5}' /proc/self/mountinfo 2>/dev/null \
  | while IFS= read -r mp; do
      [ -n "$mp" ] && sudo umount "$mp" 2>/dev/null
    done

sudo rm -rf "$OVERLAY_ROOT"
`;
}
