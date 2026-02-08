#!/bin/bash
set -euo pipefail

LIMA_VERSION="2.0.3"
DEST="$(cd "$(dirname "$0")/.." && pwd)/resources/bin"

# Skip if already downloaded
if [ -x "$DEST/limactl" ] && "$DEST/limactl" --version 2>/dev/null | grep -q "$LIMA_VERSION"; then
  echo "limactl $LIMA_VERSION already present"
  exit 0
fi

OS="$(uname -s)"   # Darwin or Linux
ARCH="$(uname -m)" # arm64 or x86_64

URL="https://github.com/lima-vm/lima/releases/download/v${LIMA_VERSION}/lima-${LIMA_VERSION}-${OS}-${ARCH}.tar.gz"

echo "Downloading limactl v${LIMA_VERSION} (${OS}/${ARCH})..."
mkdir -p "$DEST"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
curl -fSL "$URL" | tar xz -C "$TMPDIR"
mv "$TMPDIR/bin/limactl" "$DEST/limactl"
chmod 755 "$DEST/limactl"
echo "limactl v${LIMA_VERSION} installed to $DEST/limactl"
