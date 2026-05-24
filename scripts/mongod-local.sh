#!/usr/bin/env bash
# Start local mongod for dev (Artix / manual install). See docs/SETUP_ARTIX.md
set -euo pipefail

USER_NAME="${USER:-regtyit}"
CONF="${MONGOD_CONF:-$HOME/var/mongodb/mongod.conf}"
DATA="$HOME/var/mongodb/data"
LOGS="$HOME/var/mongodb/logs"

if [[ ! -f "$CONF" ]]; then
  echo "Missing config: $CONF" >&2
  echo "Create dirs and mongod.conf — see docs/SETUP_ARTIX.md § MongoDB" >&2
  exit 1
fi

mkdir -p "$DATA" "$LOGS"

# After Docker Compose bind-mount, files are often owned by uid 999 (mongo image).
if [[ -e "$DATA/storage.bson" ]] && ! [[ -r "$DATA/storage.bson" ]]; then
  echo "MongoDB data is not readable by $USER_NAME (likely owned by uid 999 after Docker)." >&2
  echo "Fix once, then re-run this script:" >&2
  echo "  sudo chown -R $USER_NAME:$USER_NAME $DATA $LOGS" >&2
  exit 1
fi

if ss -tln 2>/dev/null | grep -q ':27017 '; then
  echo "Port 27017 already in use — mongod may already be running."
  exit 0
fi

echo "Starting mongod (config: $CONF)"
exec mongod --config "$CONF"
