#!/bin/bash
#
# Promote a soaked prerelease to a "live" release so auto-updaters pick it up.
#
# Releases are published as prereleases (see forge.config.ts) and stay invisible
# to the auto-updater until promoted. Run this after a few days of soaking with
# no reported regressions.
#
# Usage: ./scripts/promote-release.sh v1.0.41

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <tag>"
  echo "Example: $0 v1.0.41"
  exit 1
fi

TAG="$1"

if ! gh release view "$TAG" >/dev/null 2>&1; then
  echo "Error: release $TAG not found." >&2
  exit 1
fi

echo "Promoting $TAG → live (clearing prerelease flag, marking as latest)..."
gh release edit "$TAG" --prerelease=false --latest

echo "Done. Auto-updaters will pick up $TAG within their next check (≤1 hour)."
