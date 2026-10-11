#!/usr/bin/env bash
# Restore the SQLite DBs from the `data` branch (gzipped, one commit, force-pushed by data-push.sh).
set -euo pipefail
mkdir -p data
if ! git fetch --depth=1 origin data 2>/dev/null; then
  echo "[data] no data branch yet"; exit 0
fi
for f in nuno contrast; do
  if git cat-file -e "origin/data:$f.sqlite.gz" 2>/dev/null; then
    git show "origin/data:$f.sqlite.gz" | gunzip > "data/$f.sqlite"
    echo "[data] restored data/$f.sqlite ($(stat -c %s "data/$f.sqlite") bytes)"
  fi
done
