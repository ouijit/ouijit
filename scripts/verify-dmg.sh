#!/usr/bin/env bash
# Verify the built DMG would pass Gatekeeper on a user's machine.
# Fails loudly if signing or notarization is missing.
#
# Usage: ./scripts/verify-dmg.sh [path/to/file.dmg]
#        (with no arg, finds the first .dmg under out/make/)
set -euo pipefail

DMG="${1:-}"
if [ -z "$DMG" ]; then
  DMG=$(find out/make -name "*.dmg" -type f | head -1 || true)
fi
if [ -z "$DMG" ] || [ ! -f "$DMG" ]; then
  echo "No DMG found to verify (looked under out/make/)"
  exit 1
fi

echo "Verifying $DMG"

# Gatekeeper acceptance: emulates what happens when the user double-clicks
# a downloaded DMG. Rejects (non-zero exit) if signing or notarization is missing.
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"

# Stapler validation: confirms the notarization ticket is actually attached to
# the file so the user gets the green light even offline.
xcrun stapler validate "$DMG"

echo "DMG verified: signed, notarized, stapled."
