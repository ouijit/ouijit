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
 * `core.excludesFile`, globs — to git itself.
 *
 * **Throws on hard failures** (git missing, path not a repo, permissions,
 * maxBuffer overflow). An empty return means git succeeded and found
 * nothing to ignore — that's a legitimate state the caller should still
 * surface loudly, but it's semantically different from "enumeration
 * failed" and the caller needs to distinguish them.
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
    const message = error instanceof Error ? error.message : String(error);
    overlayLog.error('git ls-files failed — sandbox masking cannot run', { projectPath, error: message });
    throw new Error(`listMaskedPaths: git ls-files failed for ${projectPath}: ${message}`);
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
  // The sandbox user has NO broad sudo — only NOPASSWD access to
  // /usr/local/sbin/ouijit-overlay-helper. We stage the sidecar files
  // via that helper (it runs as root, so it can write into
  // /var/lib/ouijit). If the VM image wasn't rebuilt with the helper,
  // sudo -n prompts/fails and we refuse to spawn — identical fail-closed
  // behavior to the previous inline mount approach.
  return `_ouijit_overlay_setup() {
  local WORKTREE=${worktree}
  local TASK=${task}
  local OVERLAY_ROOT="/var/lib/ouijit/overlays/T-$TASK"
  local HELPER="/usr/local/sbin/ouijit-overlay-helper"

  if [ ! -x "$HELPER" ]; then
    printf '\\n\\033[1;97;41m  SANDBOX ISOLATION FAILED  \\033[0m\\n' >&2
    printf '\\033[1;31m  ouijit: overlay helper is missing (%s).\\n' "$HELPER" >&2
    printf '  ouijit: recreate the sandbox VM so cloud-init installs it.\\033[0m\\n\\n' >&2
    return 1
  fi

  # Reachability probe: prove sudo is available non-interactively.
  # A password prompt here means the narrow sudoers rule isn't in place.
  if ! sudo -n true 2>/dev/null; then
    printf '\\n\\033[1;97;41m  SANDBOX ISOLATION FAILED  \\033[0m\\n' >&2
    printf '\\033[1;31m  ouijit: passwordless sudo is unavailable in this VM.\\n' >&2
    printf '  ouijit: refusing to start a sandboxed terminal.\\033[0m\\n\\n' >&2
    return 1
  fi

  # Stage sidecar files via the helper's parent dir, which we need root
  # to create. The helper bootstraps the root itself on first run by
  # creating \${OVERLAY_ROOT} when missing.
  local MASKS
  MASKS=$(cat <<'OUIJIT_MASKS_EOF'
${maskList}
OUIJIT_MASKS_EOF
)

  local tmp_spec
  tmp_spec=$(mktemp) || {
    printf '\\n\\033[1;97;41m  SANDBOX ISOLATION FAILED  \\033[0m\\n' >&2
    return 1
  }
  printf '%s\\n' "$MASKS" > "$tmp_spec"

  # Helper writes overlay root + sidecars; we pipe worktree + spec via
  # a short heredoc invocation that's explicit about what's being fed.
  if ! sudo -n "$HELPER" --install "$TASK" "$WORKTREE" < "$tmp_spec"; then
    rm -f "$tmp_spec"
    printf '\\n\\033[1;97;41m  SANDBOX ISOLATION FAILED  \\033[0m\\n' >&2
    printf '\\033[1;31m  ouijit: overlay helper refused to stage mounts.\\n' >&2
    printf '  ouijit: refusing to start a sandboxed terminal.\\033[0m\\n\\n' >&2
    return 1
  fi
  rm -f "$tmp_spec"

  # Apply mounts from the staged spec.
  if ! sudo -n "$HELPER" "$TASK"; then
    printf '\\n\\033[1;97;41m  SANDBOX ISOLATION FAILED  \\033[0m\\n' >&2
    printf '\\033[1;31m  ouijit: overlay helper failed to apply mounts.\\n' >&2
    printf '  ouijit: refusing to start a partially-isolated sandboxed terminal.\\033[0m\\n\\n' >&2
    return 1
  fi

  local TOTAL
  TOTAL=$(grep -c '^' < "$OVERLAY_ROOT/.spec" 2>/dev/null || echo 0)
  printf '\\n\\033[1;97;42m  SANDBOX ISOLATION ACTIVE  \\033[0m  %d paths masked\\n\\n' "$TOTAL" >&2
  return 0
}
_ouijit_overlay_setup
_OUIJIT_OVERLAY_RC=$?
unset -f _ouijit_overlay_setup
if [ "$_OUIJIT_OVERLAY_RC" -ne 0 ]; then
  unset _OUIJIT_OVERLAY_RC
  exit 1
fi
unset _OUIJIT_OVERLAY_RC
`;
}

/**
 * Build a yellow ANSI banner that prints to stderr when git ls-files
 * succeeded but returned zero gitignored paths. This is the one
 * proceed-with-warning state: the worktree has no secrets/artifacts to
 * isolate, so running the sandbox shell is legitimate, but the user
 * should see that nothing was masked in case their .gitignore is
 * incomplete. Consumed by spawn.ts and prepended to the shell's
 * innerCmd so the user sees the warning immediately at terminal start.
 *
 * Hard enumeration failures (git missing, not a repo, etc.) are
 * handled in spawn.ts: the spawn returns {success: false} and the
 * shell never starts. There's no banner for that case because there's
 * no terminal to print it into.
 */
export function buildSandboxNoMatchesBanner(): string {
  return [
    `printf '\\n\\033[1;30;43m  SANDBOX NO PATHS TO ISOLATE  \\033[0m\\n' >&2`,
    `printf '\\033[1;33m  ouijit: no gitignored paths were found in this worktree.\\n' >&2`,
    `printf '  ouijit: verify your .gitignore covers the files you want hidden.\\033[0m\\n\\n' >&2`,
    '',
  ].join('\n');
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
  // Delegate to the privileged helper. The sandbox user no longer has
  // blanket sudo, so direct `sudo umount` would fail. The helper owns
  // both unmount and rm-rf.
  return `set +e
HELPER="/usr/local/sbin/ouijit-overlay-helper"
if [ -x "$HELPER" ]; then
  sudo -n "$HELPER" --cleanup ${task} 2>/dev/null
fi
`;
}
