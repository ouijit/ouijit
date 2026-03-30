#!/bin/bash
#
# Test the update notification and "What's New" flows locally.
#
# Step 1: Packages at version 0.0.1 and launches — seeds lastSeenVersion.
# Step 2: Packages at version 1.0.20 and launches — should show "What's New" modal
#         and (on Linux) an "update available" toast.
#
# Uses isolated userData so production data is untouched.

set -euo pipefail

TEST_DATA="/tmp/ouijit-update-test"
ORIGINAL_VERSION=$(node -p "require('./package.json').version")

cleanup() {
  echo "Restoring version to $ORIGINAL_VERSION..."
  npm version "$ORIGINAL_VERSION" --no-git-tag-version --allow-same-version > /dev/null 2>&1
}
trap cleanup EXIT

echo "=== Step 1: Package at version 0.0.1 (seeds lastSeenVersion) ==="
rm -rf "$TEST_DATA"
npm version 0.0.1 --no-git-tag-version --allow-same-version > /dev/null 2>&1
npm run package -- --arch=arm64

echo ""
echo "Launching ouijit 0.0.1..."
echo "  → This seeds lastSeenVersion=0.0.1 in the test DB."
echo "  → On Linux, you should see an 'update available' toast."
echo "  → Close the app when ready to proceed."
echo ""
OUIJIT_TEST_USER_DATA="$TEST_DATA" open -W out/ouijit-darwin-arm64/ouijit.app

echo ""
echo "=== Step 2: Package at version 1.0.20 (triggers What's New) ==="
npm version 1.0.20 --no-git-tag-version --allow-same-version > /dev/null 2>&1
npm run package -- --arch=arm64

echo ""
echo "Launching ouijit 1.0.20..."
echo "  → The 'What's New' modal should appear with release notes."
echo "  → Close the app when done."
echo ""
OUIJIT_TEST_USER_DATA="$TEST_DATA" open -W out/ouijit-darwin-arm64/ouijit.app

echo ""
echo "=== Done! ==="
rm -rf "$TEST_DATA"
