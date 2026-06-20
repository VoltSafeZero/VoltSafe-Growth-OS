#!/bin/bash
set -e
npm install
# db:push intentionally excluded — drizzle-kit push requires an interactive TTY
# and will always fail in CI. Schema changes are applied via the Replit Publish flow.
# Ensure test fixture user exists with the expected password
npx tsx scripts/seed-viewer-user.ts
# Push the latest merged commit to GitHub.
# Non-fatal: GitHub HTTPS credentials are not yet configured (Task #28 will wire
# up a GITHUB_TOKEN-based credential helper). Until then the push is skipped
# gracefully so future merges don't fail post-merge setup.
echo "Pushing to GitHub (origin main)..."
git push origin main && echo "GitHub push complete." || echo "GitHub push skipped — credentials not yet configured (see Task #28)."
