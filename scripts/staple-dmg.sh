#!/usr/bin/env bash
# Staple the notarization ticket to a DMG the build left unstapled, then replace
# the copy already uploaded to the release. Stapling fetches the ticket from
# Apple's CloudKit, which can drop connections for minutes at a time.
#
# Usage: TAG=v1.2.3 ./scripts/staple-dmg.sh [path/to/file.dmg]
set -euo pipefail

DMG="${1:-}"
if [ -z "$DMG" ]; then
  DMG=$(find out/make -name "*.dmg" -type f | head -1 || true)
fi
if [ -z "$DMG" ] || [ ! -f "$DMG" ]; then
  echo "No DMG found to staple (looked under out/make/)"
  exit 1
fi

if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
  echo "$DMG is already stapled"
  exit 0
fi

delay=30
for attempt in 1 2 3 4 5 6 7 8; do
  if xcrun stapler staple -v "$DMG"; then
    gh release upload "$TAG" "$DMG" --clobber
    exit 0
  fi
  echo "Staple attempt $attempt failed; retrying in ${delay}s"
  sleep "$delay"
  delay=$(( delay * 2 > 300 ? 300 : delay * 2 ))
done

echo "Could not staple $DMG"
exit 1
