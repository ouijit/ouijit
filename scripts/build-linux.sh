#!/bin/bash
#
# Build Ouijit for Linux x64 from macOS
#
# This script uses Lima + Docker to build native Linux x64 binaries for node-pty,
# since cross-compilation of native Node modules is not supported.
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

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LIMA_VM="ouijit-linux-builder"

echo "==> Building Ouijit for Linux x64"

# Check prerequisites
if ! command -v limactl &> /dev/null; then
    echo "Error: Lima is not installed. Install with: brew install lima"
    exit 1
fi

# Check if Lima VM exists, create if not
if ! limactl list -q | grep -q "^${LIMA_VM}$"; then
    echo "==> Creating Lima VM '${LIMA_VM}'..."
    limactl create --name="${LIMA_VM}" --cpus=4 --memory=8 template:default
fi

# Start Lima VM if not running
if ! limactl list --json | grep -q "\"name\":\"${LIMA_VM}\".*\"status\":\"Running\""; then
    echo "==> Starting Lima VM..."
    limactl start "${LIMA_VM}"
fi

# Install dependencies in Lima VM
echo "==> Installing build dependencies in Lima VM..."
limactl shell "${LIMA_VM}" -- bash -c "
    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs build-essential
    fi

    # Install QEMU for x64 emulation
    if ! command -v qemu-x86_64 &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y qemu-user-static binfmt-support zip
        sudo update-binfmts --enable
    fi
"

# Build node-pty for x64 in Docker container
echo "==> Building node-pty for x64 in Docker..."
limactl shell "${LIMA_VM}" -- bash -c "
    rm -rf /tmp/node-pty-x64
    mkdir -p /tmp/node-pty-x64
    nerdctl run --rm --platform linux/amd64 \
        -v /tmp/node-pty-x64:/workspace \
        -w /workspace \
        node:20 \
        bash -c 'npm init -y && npm install node-pty'
"

# Package the app for Linux x64 (uses macOS for Vite build, which is faster)
echo "==> Packaging app for Linux x64..."
cd "$PROJECT_DIR"
npm run package -- --platform=linux --arch=x64

# Copy the x64 pty.node binary
echo "==> Replacing pty.node with x64 binary..."
limactl copy "${LIMA_VM}":/tmp/node-pty-x64/node_modules/node-pty/build/Release/pty.node \
    "${PROJECT_DIR}/out/ouijit-linux-x64/resources/app/node_modules/node-pty/build/Release/pty.node"

# Create the zip
echo "==> Creating zip archive..."
cd "${PROJECT_DIR}/out"
rm -f ouijit-linux-x64.zip
zip -r ouijit-linux-x64.zip ouijit-linux-x64

echo ""
echo "==> Build complete!"
echo "    Output: out/ouijit-linux-x64.zip"
echo ""
echo "    To verify the binary:"
echo "    file out/ouijit-linux-x64/resources/app/node_modules/node-pty/build/Release/pty.node"
