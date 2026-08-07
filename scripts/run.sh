#!/usr/bin/env bash
# Build + run helper for the DevBox image.
set -euo pipefail

IMAGE="${IMAGE:-devbox}"
NAME="${NAME:-devbox}"
PORT="${PORT:-8080}"
WEB_USER="${WEB_USER:-user}"
VOLUME="${VOLUME:-devbox-workspace}"

cmd="${1:-run}"

case "$cmd" in
  build)
    docker build -t "$IMAGE" .
    ;;
  run)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker volume create "$VOLUME" >/dev/null
    docker run -d \
      --name "$NAME" \
      --privileged \
      --cgroupns=host \
      -p "${PORT}:8080" \
      -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
      -v "${VOLUME}:/workspace" \
      --tmpfs /run --tmpfs /run/lock --tmpfs /tmp \
      -e "WEB_USER=${WEB_USER}" \
      "$IMAGE"
    echo "DevBox up  ->  http://localhost:${PORT}"
    echo "First visit: set password at /ui/setup, then log in at /ui/login (user: ${WEB_USER})"
    ;;
  logs)
    docker logs -f "$NAME"
    ;;
  sh)
    docker exec -it "$NAME" bash -lc 'su - user'
    ;;
  stop)
    docker rm -f "$NAME"
    ;;
  *)
    echo "usage: $0 {build|run|logs|sh|stop}" >&2
    exit 1
    ;;
esac