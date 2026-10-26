#!/usr/bin/env bash
# Run as a dedicated unprivileged user. DSH must already be installed.
set -euo pipefail
DSH_BIN="$(printenv DSH_BIN || echo dsh)"
DSH_PORT="$(printenv DSH_PORT || echo 3180)"
DSH_HOST="$(printenv DSH_HOST || echo 127.0.0.1)"
if [ -z "$(printenv AURABOT_DATA_DIR || true)" ]; then AURABOT_DATA_DIR="$HOME/.dsh/plugins-data/aurabot"; fi
if [ -z "$(printenv AURABOT_WORKSPACE || true)" ]; then AURABOT_WORKSPACE="$HOME/Aurabot/qq-chats"; fi
export AURABOT_DATA_DIR AURABOT_WORKSPACE
umask 077
mkdir -p "$AURABOT_DATA_DIR" "$AURABOT_WORKSPACE"
exec "$DSH_BIN" web --host "$DSH_HOST" --port "$DSH_PORT" --no-open
