#!/bin/bash
set -e
npm install
# db:push intentionally excluded — drizzle-kit push requires an interactive TTY
# and will always fail in CI. Schema changes are applied via the Replit Publish flow.
# Ensure test fixture user exists with the expected password
npx tsx scripts/seed-viewer-user.ts
# Push the latest merged commit to GitHub.
# Requires GitHub HTTPS credentials to be configured (e.g. via a GITHUB_TOKEN-based
# credential helper or Replit's GitHub integration). If credentials are not available
# this step will exit non-zero with a clear git error — intentional per set -e above.
echo "Pushing to GitHub (origin main)..."
git push origin main
echo "GitHub push complete."
