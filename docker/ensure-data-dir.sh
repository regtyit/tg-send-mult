#!/usr/bin/env bash
# Docker build context must include ./data with at least one file (empty dirs are omitted).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/data"
mkdir -p "$DATA"
if [[ ! -f "$DATA/.keep" ]]; then
  printf '%s\n' 'Place import files here before: npm run docker:build' >"$DATA/.keep"
fi
if [[ -z "$(find "$DATA" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
  echo "error: $DATA is empty. Docker cannot COPY an empty folder." >&2
  echo "  Add import files (tdata, JSON) or keep data/.keep in the repo." >&2
  exit 1
fi
