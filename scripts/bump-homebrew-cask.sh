#!/usr/bin/env bash
# Point the Homebrew cask at a published release: its version and the sha256 of
# each architecture's DMG, as GitHub records them for the uploaded asset.
#
# Usage: GH_TOKEN=... ./scripts/bump-homebrew-cask.sh v1.2.3 path/to/Casks/ouijit.rb
set -euo pipefail

TAG="$1"
CASK="$2"
REPO="${GITHUB_REPOSITORY:-ouijit/ouijit}"
VERSION="${TAG#v}"

digest() {
  gh api "repos/$REPO/releases/tags/$TAG" \
    --jq ".assets[] | select(.name == \"ouijit-darwin-$1.dmg\") | .digest // empty" | sed 's/^sha256://'
}

ARM=$(digest arm64)
INTEL=$(digest x64)
for sha in "$ARM" "$INTEL"; do
  if ! [[ "$sha" =~ ^[0-9a-f]{64}$ ]]; then
    echo "No sha256 for both DMGs on $TAG" >&2
    exit 1
  fi
done

perl -0pi -e "
  s/^  version \"[^\"]*\"/  version \"$VERSION\"/m;
  s/arm:   \"[0-9a-f]{64}\"/arm:   \"$ARM\"/;
  s/intel: \"[0-9a-f]{64}\"/intel: \"$INTEL\"/;
" "$CASK"

grep -q "version \"$VERSION\"" "$CASK" && grep -q "$ARM" "$CASK" && grep -q "$INTEL" "$CASK" || {
  echo "Cask at $CASK did not take the new version and checksums" >&2
  exit 1
}
echo "Cask now at $VERSION (arm64 $ARM, x64 $INTEL)"
