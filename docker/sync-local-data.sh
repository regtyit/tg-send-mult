#!/usr/bin/env bash
# Copy host Mongo/Valkey paths into docker bind-mount dirs (see docs/DOCKER.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VALKEY_SRC="${VALKEY_DUMP_SRC:-/var/lib/valkey/dump.rdb}"
VALKEY_DST="${ROOT}/docker/valkey-data"

mkdir -p "$VALKEY_DST"

copy_valkey() {
  if [[ ! -e "$VALKEY_SRC" ]]; then
    echo "valkey: skip — not found: $VALKEY_SRC"
    return 0
  fi
  if [[ -r "$VALKEY_SRC" ]]; then
    cp -f "$VALKEY_SRC" "$VALKEY_DST/dump.rdb"
  else
    echo "valkey: reading $VALKEY_SRC via sudo…"
    sudo cp -f "$VALKEY_SRC" "$VALKEY_DST/dump.rdb"
    sudo chown "$(id -u):$(id -g)" "$VALKEY_DST/dump.rdb"
  fi
  echo "valkey: → $VALKEY_DST/dump.rdb ($(wc -c < "$VALKEY_DST/dump.rdb") bytes)"
}

copy_valkey
echo "Done. Ensure .env has MONGO_DATA_DIR and VALKEY_DATA_DIR=./docker/valkey-data"
