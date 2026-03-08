#!/bin/bash
# Delete the dev SQLite database so it's recreated with current migrations on next launch.

set -e

case "$(uname)" in
  Darwin) db_dir="$HOME/Library/Application Support/ouijit-dev" ;;
  *)      db_dir="${XDG_CONFIG_HOME:-$HOME/.config}/ouijit-dev" ;;
esac

found=0
for ext in "" "-wal" "-shm"; do
  f="$db_dir/ouijit.db$ext"
  if [ -f "$f" ]; then
    rm "$f"
    found=1
  fi
done

if [ "$found" -eq 1 ]; then
  echo "Dev DB deleted — will be recreated on next launch."
else
  echo "No dev DB found at $db_dir"
fi
