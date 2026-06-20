#!/bin/bash
set -e
npm install
# db:push intentionally excluded — drizzle-kit push requires an interactive TTY
# and will always fail in CI. Schema changes are applied via the Replit Publish flow.
# Ensure test fixture user exists with the expected password
npx tsx scripts/seed-viewer-user.ts
# Push the latest merged commit to GitHub using GITHUB_TOKEN for non-interactive auth.
echo "Pushing to GitHub (origin main)..."
if [ -n "$GITHUB_TOKEN" ]; then
  git config credential.helper \
    '!f() { echo "username=x-access-token"; echo "password=$GITHUB_TOKEN"; }; f'
  git push origin main
  echo "GitHub push complete."
else
  echo "GitHub push skipped — GITHUB_TOKEN secret not set."
fi
