#!/usr/bin/env bash
# Read-only checks for the Docker host intended to run SnowLuma.
set -u
err=0
printf 'architecture: %s\n' "$(uname -m)"
free -m | head -n 3
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo 'Docker daemon: available'
  if docker compose version >/dev/null 2>&1; then
    echo 'Docker Compose: available'
  else
    echo 'Docker Compose: missing'
    err=1
  fi
else
  echo 'Docker daemon: UNAVAILABLE'
  err=1
fi
for port in 3000 3001 5099 6081; do
  if command -v ss >/dev/null 2>&1 && ss -H -lnt "( sport = :$port )" 2>/dev/null | grep -q .; then
    printf 'port %s: OCCUPIED\n' "$port"
    err=1
  else
    printf 'port %s: free\n' "$port"
  fi
done
exit "$err"
