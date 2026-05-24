#!/usr/bin/env bash
# Quick checks before `docker compose build` (Artix/OpenRC).
set -euo pipefail

ok=true

say() { printf '%s\n' "$*"; }
fail() { say "FAIL: $*"; ok=false; }
pass() { say "OK:  $*"; }

if ! command -v docker >/dev/null 2>&1; then
  fail "docker CLI not installed (pacman -S docker docker-compose docker-openrc docker-buildx)"
  exit 1
fi

if [[ ! -S /var/run/docker.sock ]]; then
  fail "docker.sock missing — daemon not running"
  say "  Artix/OpenRC:"
  say "    sudo pacman -S docker-openrc   # if rc-service docker: does not exist"
  say "    sudo rc-update add docker default"
  say "    sudo rc-service docker start"
  say "  Or one-off: sudo dockerd"
else
  pass "docker.sock present"
fi

in_docker_group() {
  getent group docker 2>/dev/null | grep -qE '[,:]'"$USER"'(,|$)'
}

if docker info >/dev/null 2>&1; then
  pass "docker info"
elif in_docker_group; then
  fail "docker.sock permission denied (group not active in this shell)"
  say "  You are in group 'docker' but this terminal started before usermod."
  say "  Run: newgrp docker"
  say "  Or: sg docker -c 'npm run docker:build'"
else
  fail "cannot talk to daemon (permission or dockerd stopped)"
  say "  sudo usermod -aG docker \"$USER\" && newgrp docker"
fi

if docker buildx version >/dev/null 2>&1; then
  pass "docker buildx"
else
  fail "buildx plugin missing"
  say "  sudo pacman -S docker-buildx"
fi

if docker compose version >/dev/null 2>&1; then
  pass "docker compose"
else
  fail "docker compose plugin missing (pacman -S docker-compose)"
fi

$ok || exit 1
say ""
say "Ready: npm run docker:build && npm run docker:up"
