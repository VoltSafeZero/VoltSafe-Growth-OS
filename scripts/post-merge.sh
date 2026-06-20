#!/bin/bash
set -e
npm install
# db:push intentionally excluded — drizzle-kit push requires an interactive TTY
# and will always fail in CI. Schema changes are applied via the Replit Publish flow.
# Ensure test fixture user exists with the expected password
npx tsx scripts/seed-viewer-user.ts
# Push the latest merged commit to GitHub using GITHUB_TOKEN for non-interactive auth.
# Uses token-embedded URL to bypass Replit's GIT_ASKPASS interceptor.
# No pull/rebase — commits always flow local → GitHub in this repo, so GitHub
# is always behind (fast-forward push). A non-fast-forward means someone pushed
# directly to GitHub; log it clearly rather than crashing.
echo "Pushing to GitHub (origin main)..."
if [ -n "$GITHUB_TOKEN" ]; then
  REMOTE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/VoltSafeZero/VoltSafe-Growth-OS.git"
  git push "$REMOTE_URL" main && echo "GitHub push complete." \
    || echo "GitHub push failed (non-fast-forward?) — push manually if needed."
else
  echo "GitHub push skipped — GITHUB_TOKEN secret not set."
fi
