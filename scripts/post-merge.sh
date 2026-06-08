#!/bin/bash
set -e
npm install
npm run db:push
# Ensure test fixture user exists with the expected password
npx tsx scripts/seed-viewer-user.ts
