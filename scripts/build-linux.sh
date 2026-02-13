#!/bin/bash
#
# Build Ouijit for Linux x64 from macOS
#
# This script cross-compiles native modules (node-pty) and downloads
# Linux-specific binaries (limactl) into a staging directory, then
# packages the app. The forge afterCopy hook picks up staged binaries
# via OUIJIT_CROSS_STAGING so everything is bundled correctly in one pass.
#
# Flow:
#   1. Stage: cross-compile node-pty, download Linux limactl
#   2. Package: electron-forge packages with staged binaries
#   3. Archive: zip the output
#
# Prerequisites:
#   - Lima (brew install lima)
#   - Node.js 20+
#
# Usage:
#   npm run make:linux
#   # or
#   ./scripts/build-linux.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LIMA_VM="ouijit-linux-builder"
LIMA_VERSION="2.0.3"
STAGING="${PROJECT_DIR}/out/linux-staging"

echo "==> Building Ouijit for Linux x64"

# Check prerequisites
if ! command -v limactl &> /dev/null; then
    echo "Error: Lima is not installed. Install with: brew install lima"
    exit 1
fi

# Clean staging directory
rm -rf "$STAGING"
mkdir -p "$STAGING"/{node_modules,bin,share/lima}

# ─── Step 1: Stage Linux-specific binaries ───────────────────────────

# 1a. Download Linux limactl
echo "==> Downloading Linux limactl v${LIMA_VERSION}..."
LIMA_URL="https://github.com/lima-vm/lima/releases/download/v${LIMA_VERSION}/lima-${LIMA_VERSION}-Linux-x86_64.tar.gz"
LIMA_TMP="$(mktemp -d)"
trap 'rm -rf "$LIMA_TMP"' EXIT
curl -fSL "$LIMA_URL" | tar xz -C "$LIMA_TMP"
cp "$LIMA_TMP/bin/limactl" "$STAGING/bin/limactl"
chmod 755 "$STAGING/bin/limactl"
cp "$LIMA_TMP"/share/lima/lima-guestagent.*.gz "$STAGING/share/lima/"
rm -rf "$LIMA_TMP"
trap - EXIT
echo "    Staged limactl and guest agents"

# 1b. Ensure Lima builder VM is running
if ! limactl list -q | grep -q "^${LIMA_VM}$"; then
    echo "==> Creating Lima VM '${LIMA_VM}'..."
    limactl create --name="${LIMA_VM}" --cpus=4 --memory=8 template:default
fi
if ! limactl list --json | grep -q "\"name\":\"${LIMA_VM}\".*\"status\":\"Running\""; then
    echo "==> Starting Lima VM..."
    limactl start "${LIMA_VM}"
fi

echo "==> Installing build dependencies in Lima VM..."
limactl shell "${LIMA_VM}" -- bash -c "
    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs build-essential
    fi
    if ! command -v qemu-x86_64 &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y qemu-user-static binfmt-support zip
        sudo update-binfmts --enable
    fi
"

# 1c. Cross-compile node-pty for Linux x64 via Docker
echo "==> Cross-compiling node-pty for Linux x64..."
limactl shell "${LIMA_VM}" -- bash -c "
    rm -rf /tmp/node-pty-x64
    mkdir -p /tmp/node-pty-x64
    nerdctl run --rm --platform linux/amd64 \
        -v /tmp/node-pty-x64:/workspace \
        -w /workspace \
        node:20 \
        bash -c 'npm init -y && npm install node-pty'
"

# Copy cross-compiled node-pty into staging
echo "==> Staging cross-compiled node-pty..."
limactl copy -r "${LIMA_VM}":/tmp/node-pty-x64/node_modules/node-pty "$STAGING/node_modules/node-pty"

# ─── Step 2: Package with staged binaries ────────────────────────────

echo "==> Packaging app for Linux x64..."
cd "$PROJECT_DIR"
OUIJIT_CROSS_STAGING="$STAGING" npm run package -- --platform=linux --arch=x64

# ─── Step 3: Archive ─────────────────────────────────────────────────

echo "==> Creating zip archive..."
cd "${PROJECT_DIR}/out"
rm -f ouijit-linux-x64.zip
zip -r ouijit-linux-x64.zip ouijit-linux-x64

echo ""
echo "==> Build complete!"
echo "    Output: out/ouijit-linux-x64.zip"
echo ""
echo "    To verify binaries:"
echo "    file out/ouijit-linux-x64/resources/app/node_modules/node-pty/build/Release/pty.node"
echo "    file out/ouijit-linux-x64/resources/bin/limactl"
