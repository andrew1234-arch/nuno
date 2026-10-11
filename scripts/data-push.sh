#!/usr/bin/env bash
# Replace the `data` branch with one commit holding the gzipped DBs. Force-push keeps the repo small:
# only the latest state is kept, the history lives in docs/PROGRESS.md and the on-chain snapshots.
set -euo pipefail
tmp=$(mktemp -d)
entries=""
for f in nuno contrast; do
  [ -f "data/$f.sqlite" ] || continue
  gzip -9 -c "data/$f.sqlite" > "$tmp/$f.sqlite.gz"
  blob=$(git hash-object -w "$tmp/$f.sqlite.gz")
  entries+=$(printf '100644 blob %s\t%s.sqlite.gz\\n' "$blob" "$f")
done
tree=$(printf "$entries" | git mktree)
commit=$(git -c user.name="nuno-bot" -c user.email="nuno-bot@users.noreply.github.com" commit-tree "$tree" -m "data: ${1:-update} $(date -u +%FT%TZ)")
git push -f origin "$commit:refs/heads/data"
rm -rf "$tmp"
echo "[data] pushed $commit"
