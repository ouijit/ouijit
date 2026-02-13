#!/bin/bash
set -euo pipefail

LIMA_VERSION="2.0.3"
RESOURCES="$(cd "$(dirname "$0")/.." && pwd)/resources"
DEST="$RESOURCES/bin"
SHARE_DEST="$RESOURCES/share/lima"

OS="$(uname -s)"   # Darwin or Linux
ARCH="$(uname -m)" # arm64 or x86_64

# Lima only supports macOS and Linux
if [ "$OS" != "Darwin" ] && [ "$OS" != "Linux" ]; then
  echo "Skipping limactl download: unsupported platform ($OS)"
  exit 0
fi

# Skip if already downloaded
if [ -x "$DEST/limactl" ] && "$DEST/limactl" --version 2>/dev/null | grep -q "$LIMA_VERSION" && [ -d "$SHARE_DEST" ]; then
  echo "limactl $LIMA_VERSION already present"
  exit 0
fi

URL="https://github.com/lima-vm/lima/releases/download/v${LIMA_VERSION}/lima-${LIMA_VERSION}-${OS}-${ARCH}.tar.gz"

echo "Downloading limactl v${LIMA_VERSION} (${OS}/${ARCH})..."
mkdir -p "$DEST" "$SHARE_DEST"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
if ! curl -fSL "$URL" | tar xz -C "$TMPDIR"; then
  echo "Error: failed to download limactl"
  exit 1
fi
mv "$TMPDIR/bin/limactl" "$DEST/limactl"
chmod 755 "$DEST/limactl"
cp "$TMPDIR"/share/lima/lima-guestagent.*.gz "$SHARE_DEST/"
echo "limactl v${LIMA_VERSION} installed to $DEST/limactl"
echo "Guest agents installed to $SHARE_DEST/"
