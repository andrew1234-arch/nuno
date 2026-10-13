#!/usr/bin/env bash
# Build the static site from the current export and deploy it to Vercel (production).
# Needs a logged-in Vercel CLI (`npx vercel login`) or VERCEL_TOKEN. The project link (org and project ids)
# is kept in .vercel/project.json at the repo root, so the build output folder can be wiped freely.
set -euo pipefail
cd "$(dirname "$0")/.."
CLI="npx -y vercel@63.1.2"
TOKEN_ARGS=()
[ -n "${VERCEL_TOKEN:-}" ] && TOKEN_ARGS=(--token "$VERCEL_TOKEN")
if [ ! -f .vercel/project.json ]; then
  # First run: create (or reuse) the project named "nuno" and remember its ids.
  tmp=$(mktemp -d)
  (cd "$tmp" && $CLI link --yes --project "${VERCEL_PROJECT_NAME:-nuno}" "${TOKEN_ARGS[@]}" >/dev/null)
  mkdir -p .vercel && cp "$tmp/.vercel/project.json" .vercel/project.json && rm -rf "$tmp"
fi
export VERCEL_ORG_ID=$(node -p 'require("./.vercel/project.json").orgId')
export VERCEL_PROJECT_ID=$(node -p 'require("./.vercel/project.json").projectId')
NEXT_PUBLIC_SITE_URL="${SITE_URL:-}" LOGOS_CACHE_URL="" pnpm web:build
cp -r site/api apps/web/out/api
cp apps/web/vercel.json apps/web/out/vercel.json
$CLI deploy apps/web/out --prod --yes --archive=tgz "${TOKEN_ARGS[@]}"
echo "ids for GitHub secrets: VERCEL_ORG_ID=$VERCEL_ORG_ID VERCEL_PROJECT_ID=$VERCEL_PROJECT_ID"
