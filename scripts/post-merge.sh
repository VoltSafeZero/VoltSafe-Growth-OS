#!/bin/bash
set -e
npm install
# db:push intentionally excluded — drizzle-kit push requires an interactive TTY
# and will always fail in CI. Schema changes are applied via the Replit Publish flow.
# Ensure test fixture user exists with the expected password
npx tsx scripts/seed-viewer-user.ts
