#!/bin/bash
# Validation deployment startup — sources .validation.env for the read-only
# database connection string.  This script is NOT committed; .validation.env
# is gitignored and contains the SELECT-only role credentials.
set -e

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$WORKSPACE_DIR/.validation.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "[validation] ERROR: $ENV_FILE not found — cannot start read-only validation server"
  exit 1
fi

# Load VALIDATION_READONLY_DATABASE_URL (export all vars defined in the file)
set -a
# shellcheck source=../.validation.env
source "$ENV_FILE"
set +a

echo "[validation] Loaded read-only connection from .validation.env"
echo "[validation] Role: $(echo "$VALIDATION_READONLY_DATABASE_URL" | sed 's|postgresql://||' | cut -d: -f1)"
echo "[validation] Starting production bundle on port 5099..."

exec env \
  NODE_ENV=production \
  PORT=5099 \
  DATABASE_URL="$VALIDATION_READONLY_DATABASE_URL" \
  ROLLBACK_FIRST_BOOT_READ_ONLY=true \
  ROLLBACK_VALIDATION_READ_ONLY=true \
  RUN_STARTUP_MIGRATIONS=false \
  ALLOW_DESTRUCTIVE_SEED=false \
  PRODUCTION_READONLY_MODE=true \
  ENABLE_BACKGROUND_JOBS=false \
  SESSION_SECRET="$SESSION_SECRET" \
  node dist/index.cjs
