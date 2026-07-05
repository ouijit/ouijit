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

# Skip if already downloaded
if [ -x "$DEST/nono" ] && "$DEST/nono" --version 2>/dev/null | grep -q "$NONO_VERSION"; then
  echo "nono $NONO_VERSION already present"
  exit 0
fi

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
