import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { stringify, parse, Document, Scalar } from 'yaml';
import { getInstanceName } from './manager';
import { buildProjectMounts } from './config';
import { getLogger } from '../logger';
import { getUserDataPath } from '../paths';

const configLog = getLogger().scope('limaConfig');

/** Directory within Electron userData where sandbox YAML configs are stored */
function getConfigDir(): string {
  return path.join(getUserDataPath(), 'sandbox-configs');
}

/** Get the YAML config file path for a project */
export function getConfigPath(projectPath: string): string {
  const instanceName = getInstanceName(projectPath);
  return path.join(getConfigDir(), `${instanceName}.yaml`);
}

/** Check if a config file exists for this project */
export async function configExists(projectPath: string): Promise<boolean> {
  try {
    await fs.access(getConfigPath(projectPath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Overlay helper script installed at /usr/local/sbin/ouijit-overlay-helper.
 * The only command the sandbox user is allowed to run as root. It reads
 * sidecar files written by the host-issued overlay setup and mounts each
 * masked path as an empty bind mount, then drops privileges — the user
 * cannot umount or otherwise manipulate the overlays afterwards because
 * sudo is scoped to this helper alone.
 *
 * Expected layout (written by the unprivileged shell before invoking us):
 *   /var/lib/ouijit/overlays/T-<taskId>/.worktree  (single line: worktree path)
 *   /var/lib/ouijit/overlays/T-<taskId>/.spec      (one "d <rel>" or "f <rel>" per line)
 */
export const OVERLAY_HELPER_SCRIPT = `#!/bin/bash
# Ouijit overlay helper — runs as root via /etc/sudoers.d/99-ouijit.
# Sub-commands:
#   --install <task> <worktree>   create overlay root + write sidecars from stdin
#   --cleanup <task>              umount everything for a task and remove overlay root
#   <task>                        apply mounts from the staged sidecars
set -u
umask 077

OVERLAY_PARENT="/var/lib/ouijit/overlays"

if [ "\${1:-}" = "--cleanup" ]; then
  TASK="\${2:-}"
  if [[ ! "$TASK" =~ ^[0-9]+$ ]]; then
    echo "ouijit-overlay-helper: invalid task id" >&2
    exit 2
  fi
  OVERLAY_ROOT="$OVERLAY_PARENT/T-$TASK"
  [ -d "$OVERLAY_ROOT" ] || exit 0

  # Legacy sidecar layout: .paths (no type prefix). Newer .spec has
  # "d|f <rel>". Handle both so older overlays still clean up.
  WORKTREE=""
  [ -f "$OVERLAY_ROOT/.worktree" ] && WORKTREE=$(head -1 "$OVERLAY_ROOT/.worktree")
  if [ -n "$WORKTREE" ]; then
    if [ -f "$OVERLAY_ROOT/.spec" ]; then
      while IFS= read -r line; do
        rel="\${line#* }"
        [ -n "$rel" ] && umount "$WORKTREE/$rel" 2>/dev/null
      done < "$OVERLAY_ROOT/.spec"
    elif [ -f "$OVERLAY_ROOT/.paths" ]; then
      while IFS= read -r rel; do
        [ -n "$rel" ] && umount "$WORKTREE/$rel" 2>/dev/null
      done < "$OVERLAY_ROOT/.paths"
    fi
  fi

  # Belt-and-suspenders: umount any mount still pointing at the overlay.
  awk -v root="$OVERLAY_ROOT/" '$4 ~ "^"root {print $5}' /proc/self/mountinfo 2>/dev/null \\
    | while IFS= read -r mp; do
        [ -n "$mp" ] && umount "$mp" 2>/dev/null
      done

  rm -rf "$OVERLAY_ROOT"
  exit 0
fi

if [ "\${1:-}" = "--install" ]; then
  TASK="\${2:-}"
  WORKTREE="\${3:-}"
  if [[ ! "$TASK" =~ ^[0-9]+$ ]]; then
    echo "ouijit-overlay-helper: invalid task id" >&2
    exit 2
  fi
  case "$WORKTREE" in
    *'..'*|'') echo "ouijit-overlay-helper: bad worktree" >&2; exit 5;;
    /*) :;;
    *) echo "ouijit-overlay-helper: worktree must be absolute" >&2; exit 5;;
  esac
  OVERLAY_ROOT="$OVERLAY_PARENT/T-$TASK"
  mkdir -p "$OVERLAY_ROOT"
  printf '%s\\n' "$WORKTREE" > "$OVERLAY_ROOT/.worktree"
  # Read spec from stdin. Validate each line — only 'd <rel>' or
  # 'f <rel>' with no leading slash and no .. segments.
  : > "$OVERLAY_ROOT/.spec"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    type="\${line%% *}"
    rel="\${line#* }"
    case "$type" in d|f) :;; *) continue;; esac
    case "$rel" in /*|*'..'*) continue;; esac
    printf '%s %s\\n' "$type" "$rel" >> "$OVERLAY_ROOT/.spec"
  done
  exit 0
fi

TASK="\${1:-}"
if [[ ! "$TASK" =~ ^[0-9]+$ ]]; then
  echo "ouijit-overlay-helper: invalid task id" >&2
  exit 2
fi

OVERLAY_ROOT="$OVERLAY_PARENT/T-$TASK"
WORKTREE_FILE="$OVERLAY_ROOT/.worktree"
SPEC_FILE="$OVERLAY_ROOT/.spec"
if [ ! -f "$WORKTREE_FILE" ] || [ ! -f "$SPEC_FILE" ]; then
  echo "ouijit-overlay-helper: missing .worktree or .spec — run --install first" >&2
  exit 4
fi

WORKTREE=$(head -1 "$WORKTREE_FILE")
case "$WORKTREE" in
  *'..'*|'') echo "ouijit-overlay-helper: suspicious worktree path" >&2; exit 5;;
  /*) :;;
  *) echo "ouijit-overlay-helper: worktree must be absolute" >&2; exit 5;;
esac

INVOKER_UID=\${SUDO_UID:-$UID}
INVOKER_GID=\${SUDO_GID:-$(id -g)}

TOTAL=0; OK=0; FAIL=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  TOTAL=$((TOTAL+1))
  type="\${line%% *}"
  rel="\${line#* }"
  case "$rel" in
    *'..'*|/*) FAIL=$((FAIL+1)); echo "ouijit-overlay-helper: reject rel $rel" >&2; continue;;
  esac
  overlay="$OVERLAY_ROOT/$rel"
  target="$WORKTREE/$rel"

  if [ "$type" = "d" ]; then
    mkdir -p "$overlay" "$target" || { FAIL=$((FAIL+1)); continue; }
    chown "$INVOKER_UID:$INVOKER_GID" "$overlay" 2>/dev/null || true
  elif [ "$type" = "f" ]; then
    mkdir -p "$(dirname "$overlay")" "$(dirname "$target")" || { FAIL=$((FAIL+1)); continue; }
    touch "$overlay" "$target" || { FAIL=$((FAIL+1)); continue; }
    chown "$INVOKER_UID:$INVOKER_GID" "$overlay" 2>/dev/null || true
  else
    FAIL=$((FAIL+1))
    continue
  fi

  if mountpoint -q "$target"; then
    OK=$((OK+1))
  elif mount --bind "$overlay" "$target"; then
    # Once set up the sandbox user cannot umount (no sudo for umount)
    # and cannot layer new mounts — the helper is the only privileged
    # path, and it won't unmount on their behalf.
    mount --make-private "$target" 2>/dev/null || true
    OK=$((OK+1))
  else
    FAIL=$((FAIL+1))
  fi
done < "$SPEC_FILE"

if [ "$FAIL" -gt 0 ] || [ "$OK" -eq 0 ]; then
  echo "ouijit-overlay-helper: $OK/$TOTAL mounted, $FAIL failed" >&2
  exit 6
fi
exit 0
`;

/** Provision script body — runs as root during cloud-init. */
const PROVISION_SCRIPT = `#!/bin/bash
set -eux -o pipefail

# Base packages (unchanged from earlier image).
apt-get update
apt-get install -y bash git curl wget nodejs npm python3 build-essential

# Scope sudo: Lima's default lima-sudoers grants NOPASSWD ALL. We
# narrow it to the single overlay helper. Any other sudo the sandbox
# user tries (including \`sudo umount\` to reveal a masked secret)
# requires a password they don't have.
install -o root -g root -m 0755 /dev/stdin /usr/local/sbin/ouijit-overlay-helper <<'OUIJIT_HELPER_EOF'
${OVERLAY_HELPER_SCRIPT}OUIJIT_HELPER_EOF

# Replace Lima's sudoers grant. visudo -cf validates before install.
cat > /tmp/99-ouijit.sudoers <<'OUIJIT_SUDO_EOF'
# Narrow sudo for sandboxed sessions — overlay helper only. Lima
# installs a broader NOPASSWD rule; this file overrides it.
%sudo ALL=(root) NOPASSWD: /usr/local/sbin/ouijit-overlay-helper *
Defaults:%sudo !env_reset
OUIJIT_SUDO_EOF
if visudo -cf /tmp/99-ouijit.sudoers >/dev/null 2>&1; then
  install -o root -g root -m 0440 /tmp/99-ouijit.sudoers /etc/sudoers.d/99-ouijit
  # Strip any broader NOPASSWD:ALL grant from cloud-init / lima layers.
  # Lima and cloud-init each install their own files under /etc/sudoers.d
  # with unpredictable names; scan /etc/sudoers itself plus everything
  # in /etc/sudoers.d except our rule, then re-validate with visudo so
  # a botched edit doesn't lock sudo out.
  strip_targets="/etc/sudoers"
  for f in /etc/sudoers.d/*; do
    [ -f "$f" ] || continue
    # Skip our own file — we just installed it with exactly this suffix.
    case "$f" in */99-ouijit) continue;; esac
    strip_targets="$strip_targets $f"
  done
  for f in $strip_targets; do
    [ -f "$f" ] || continue
    if grep -qE '^[^#]*NOPASSWD:[[:space:]]*ALL' "$f" 2>/dev/null; then
      sed -i.ouijit-bak -E '/^[^#]*NOPASSWD:[[:space:]]*ALL/d' "$f"
      if ! visudo -cf "$f" >/dev/null 2>&1; then
        mv "$f.ouijit-bak" "$f"
      else
        rm -f "$f.ouijit-bak"
      fi
    fi
  done
fi
rm -f /tmp/99-ouijit.sudoers
`;

/** Generate a platform-appropriate default Lima YAML config */
export function generateDefaultConfig(): string {
  const isMac = os.platform() === 'darwin';

  const config: Record<string, unknown> = {
    cpus: 2,
    memory: '4GiB',
    disk: '50GiB',
    images: [
      {
        location: 'https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-arm64.img',
        arch: 'aarch64',
      },
      {
        location: 'https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img',
        arch: 'x86_64',
      },
    ],
    provision: [
      {
        mode: 'system',
        // Placeholder replaced below with a literal-block scalar — the
        // stringifier picks a folded (`>`) style otherwise and folds
        // newlines in the bash script into spaces, which corrupts it.
        script: '__OUIJIT_PROVISION_PLACEHOLDER__',
      },
    ],
    networks: isMac ? [{ vzNAT: true }] : [],
    ssh: { loadDotSSHPubKeys: true },
  };

  const doc = new Document(config);
  // Walk to provision[0].script and force literal-block style so the
  // shell script round-trips verbatim.
  const provision = doc.get('provision', true) as unknown as { items: { get: (k: string, keep: boolean) => Scalar }[] };
  const scriptScalar = provision.items[0].get('script', true) as Scalar;
  scriptScalar.value = PROVISION_SCRIPT;
  scriptScalar.type = Scalar.BLOCK_LITERAL;

  return doc.toString();
}

/** Read the user's raw YAML config for a project. Returns null if no file exists. */
export async function readUserConfig(projectPath: string): Promise<string | null> {
  try {
    return await fs.readFile(getConfigPath(projectPath), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write the user's YAML config for a project.
 * Creates the sandbox-configs directory if it doesn't exist.
 */
export async function writeUserConfig(projectPath: string, yaml: string): Promise<void> {
  const configPath = getConfigPath(projectPath);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, yaml, 'utf-8');
  configLog.info('wrote sandbox config', { projectPath, configPath });
}

/** Delete the config file for a project */
export async function deleteConfig(projectPath: string): Promise<void> {
  try {
    await fs.unlink(getConfigPath(projectPath));
    configLog.info('deleted sandbox config', { projectPath });
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Ensure a default config exists for a project. Creates one if missing.
 * Returns the user config YAML string.
 */
export async function ensureConfig(projectPath: string): Promise<string> {
  const existing = await readUserConfig(projectPath);
  if (existing !== null) return existing;

  const defaultYaml = generateDefaultConfig();
  await writeUserConfig(projectPath, defaultYaml);
  return defaultYaml;
}

/**
 * Resolve ${VAR_NAME} references in a string from process.env.
 * Returns the resolved string and a list of unresolved variable names.
 */
export function resolveEnvVars(input: string): { resolved: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const resolved = input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)}/g, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      unresolved.push(varName);
      return '';
    }
    return value;
  });
  return { resolved, unresolved };
}

/**
 * Merge Ouijit-managed fields into a user config to produce the final Lima YAML.
 * Protected fields (vmType, mounts for project/worktree) are injected/appended.
 */
export function mergeConfig(userYaml: string, projectPath: string): string {
  const isMac = os.platform() === 'darwin';
  const userDoc = (parse(userYaml) as Record<string, unknown>) ?? {};

  // Inject protected fields
  userDoc.vmType = isMac ? 'vz' : 'qemu';

  // Merge mounts: user mounts + project mounts (project mounts always appended)
  const projectMounts = buildProjectMounts(projectPath).map((m) => ({
    location: m.hostPath,
    mountPoint: m.guestPath,
    writable: m.writable,
  }));
  const userMounts = Array.isArray(userDoc.mounts) ? (userDoc.mounts as Record<string, unknown>[]) : [];
  userDoc.mounts = [...userMounts, ...projectMounts];

  return stringify(userDoc);
}

/**
 * Get the full merged config for display in the editor.
 * Shows user fields + Ouijit-managed fields with comments.
 */
export async function getMergedConfigForDisplay(projectPath: string): Promise<string> {
  const isMac = os.platform() === 'darwin';
  const userYaml = await ensureConfig(projectPath);
  const userDoc = (parse(userYaml) as Record<string, unknown>) ?? {};

  // Serialize user fields as-is
  const userSection = stringify(userDoc);

  // Build the managed fields section
  const projectMounts = buildProjectMounts(projectPath).map((m) => ({
    location: m.hostPath,
    mountPoint: m.guestPath,
    writable: m.writable,
  }));
  const managedDoc: Record<string, unknown> = {
    vmType: isMac ? 'vz' : 'qemu',
    mounts: [...(Array.isArray(userDoc.mounts) ? (userDoc.mounts as Record<string, unknown>[]) : []), ...projectMounts],
  };
  const managedSection = stringify(managedDoc);

  return [
    userSection.trimEnd(),
    '',
    '# ── Ouijit-managed (injected at VM creation) ──',
    managedSection.trimEnd(),
    '',
  ].join('\n');
}

/**
 * Build the final YAML string for limactl create.
 * Merges user config with Ouijit fields and resolves env vars.
 */
export async function buildFinalConfig(projectPath: string): Promise<{ yaml: string; warnings: string[] }> {
  const userYaml = await ensureConfig(projectPath);
  const merged = mergeConfig(userYaml, projectPath);
  const { resolved, unresolved } = resolveEnvVars(merged);

  const warnings: string[] = [];
  if (unresolved.length > 0) {
    const msg = `Unresolved environment variables: ${unresolved.join(', ')}`;
    configLog.warn(msg, { projectPath, unresolved });
    warnings.push(msg);
  }

  return { yaml: resolved, warnings };
}

/**
 * Validate that a YAML string is syntactically valid.
 * Returns null if valid, or an error message if invalid.
 */
export function validateYaml(yaml: string): string | null {
  try {
    parse(yaml);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid YAML';
  }
}
