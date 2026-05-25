#!/usr/bin/env bash
# One-shot: preflight → build image → start stack → wait for health → probe API.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say() { printf '%s\n' "$*"; }

if [[ ! -f .env ]]; then
  say "No .env found — copying from .env.example"
  say "  Edit .env: SESSION_KEY (64-char hex), API_BASIC_PASSWORD, optional TG_API_* / MONGO_DATA_DIR"
  cp .env.example .env
fi

say "=== Docker preflight ==="
bash docker/doctor.sh

say ""
say "=== Prepare data/ for image COPY ==="
bash docker/ensure-data-dir.sh

say ""
say "=== Build image (Node + Nuxt + Python/Telethon + TelethonFakeTLS) ==="
bash docker/compose.sh build

say ""
say "=== Start stack (mongo, valkey, api, worker, scheduler) ==="
bash docker/compose.sh up -d --wait

say ""
say "=== Wait for dashboard API ==="
ready=false
for _ in $(seq 1 45); do
  if curl -sf --max-time 2 http://127.0.0.1:3048/health >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done

if ! $ready; then
  say "WARN: http://127.0.0.1:3048/health not ready yet."
  say "  npm run docker:logs"
  say "  npm run docker:ps"
  exit 1
fi

say ""
say "Ready."
say "  Dashboard:  http://127.0.0.1:3048"
say "  Bull Board:   http://127.0.0.1:3048/admin/queues"
say "  Logs:         npm run docker:logs"
say "  Stop:         npm run docker:down"
