#!/usr/bin/env bash
# Run `docker compose` with active `docker` group (handles post-usermod shells).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

quoted_args() {
  local out=() a
  for a in "$@"; do
    printf -v a '%q' "$a"
    out+=("$a")
  done
  printf '%s' "${out[*]}"
}

run_compose() {
  docker compose "$@"
}

run_via_sg() {
  local cmd="docker compose $(quoted_args "$@")"
  exec sg docker -c "$cmd"
}

if docker info >/dev/null 2>&1; then
  run_compose "$@"
elif getent group docker 2>/dev/null | grep -qE '[,:]'"$USER"'(,|$)'; then
  run_via_sg "$@"
else
  echo "permission denied: /var/run/docker.sock" >&2
  echo "  sudo usermod -aG docker \"$USER\"" >&2
  echo "  then: newgrp docker   (or log out and back in)" >&2
  exit 1
fi
