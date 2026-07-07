#!/bin/bash
set -euo pipefail

NONO_VERSION="0.66.0"
RESOURCES="$(cd "$(dirname "$0")/.." && pwd)/resources"
DEST="$RESOURCES/bin"

OS="$(uname -s)"   # Darwin or Linux
ARCH="$(uname -m)" # arm64/aarch64 or x86_64

# nono publishes prebuilt binaries for macOS and Linux only, named by Rust
# target triple. Map uname's OS/ARCH onto the triple used in the asset name.
case "$OS" in
  Darwin) RUST_OS="apple-darwin" ;;
  Linux) RUST_OS="unknown-linux-gnu" ;;
  *)
    echo "Skipping nono download: unsupported platform ($OS)"
    exit 0
    ;;
esac
case "$ARCH" in
  arm64 | aarch64) RUST_ARCH="aarch64" ;;
  x86_64 | amd64) RUST_ARCH="x86_64" ;;
  *)
    echo "Skipping nono download: unsupported arch ($ARCH)"
    exit 0
    ;;
esac
TARGET="${RUST_ARCH}-${RUST_OS}"

# Download the binary unless the matching version is already present.
if [ -x "$DEST/nono" ] && "$DEST/nono" --version 2>/dev/null | grep -q "$NONO_VERSION"; then
  echo "nono $NONO_VERSION already present"
else
  URL="https://github.com/always-further/nono/releases/download/v${NONO_VERSION}/nono-v${NONO_VERSION}-${TARGET}.tar.gz"

  echo "Downloading nono v${NONO_VERSION} (${TARGET})..."
  mkdir -p "$DEST"

  TMPDIR="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR"' EXIT
  if ! curl -fSL "$URL" | tar xz -C "$TMPDIR"; then
    echo "Error: failed to download nono"
    exit 1
  fi
  mv "$TMPDIR/nono" "$DEST/nono"
  chmod 755 "$DEST/nono"
  echo "nono v${NONO_VERSION} installed to $DEST/nono"
fi

# Vendor the agent packs the union profile inherits (claude, codex, opencode,
# pi) so the first sandboxed launch needs no network. The `packages/` tree is
# bundled together with its `lockfile.json`: nono verifies every pack against
# the lockfile on each real `nono run` (artifact digests + the Sigstore trust
# bundle, all offline), and a pack directory with no lockfile entry is a hard
# error. The app installs each pack as a matched pair — directory plus its
# vendored lockfile entry. Packs are platform-independent JSON, so one
# vendored copy is valid on every OS. See src/sandbox/nono/profile.ts.
#
# `nono pull` also "wires" agent hooks into the invoking user's real config
# (~/.config/nono, ~/.claude, …). To keep postinstall from mutating a
# developer's machine, pull into a throwaway HOME and copy only the packages
# out; every side effect stays inside the temp dir and is discarded. The
# wiring_record in the vendored lockfile is emptied to match: the app's
# copy-install performs no wiring, and the record would otherwise bake this
# machine's paths into every install.
SHARE="$RESOURCES/share"
PACKS_DIR="$SHARE/nono/packages/always-further"
LOCKFILE="$SHARE/nono/packages/lockfile.json"
PACKS="claude codex opencode pi"
if [ -f "$LOCKFILE" ] && [ -d "$PACKS_DIR/claude" ] && [ -d "$PACKS_DIR/codex" ] && [ -d "$PACKS_DIR/opencode" ] && [ -d "$PACKS_DIR/pi" ]; then
  echo "nono agent packs already vendored"
else
  echo "Vendoring nono agent packs into $SHARE/nono/packages..."
  mkdir -p "$PACKS_DIR"
  PACKS_TMP="$(mktemp -d)"
  trap 'rm -rf "$PACKS_TMP"' EXIT
  for pack in $PACKS; do
    if env -u XDG_CONFIG_HOME HOME="$PACKS_TMP" "$DEST/nono" pull "always-further/$pack" --silent; then
      cp -R "$PACKS_TMP/.config/nono/packages/always-further/$pack" "$PACKS_DIR/"
    else
      echo "Warning: failed to vendor always-further/$pack; first launch will pull it at runtime"
    fi
  done
  TMP_LOCKFILE="$PACKS_TMP/.config/nono/packages/lockfile.json"
  if [ -f "$TMP_LOCKFILE" ]; then
    python3 - "$TMP_LOCKFILE" "$LOCKFILE" <<'PY'
import json, sys

src, dest = sys.argv[1], sys.argv[2]
with open(src) as f:
    lock = json.load(f)
# The vendored copy is installed without wiring; drop the temp-HOME paths.
for entry in lock.get("packages", {}).values():
    entry["wiring_record"] = []
with open(dest, "w") as f:
    json.dump(lock, f, indent=2)
    f.write("\n")
PY
  else
    echo "Warning: no lockfile produced; first launch will pull packs at runtime"
  fi
  rm -rf "$PACKS_TMP"
  trap - EXIT
fi
