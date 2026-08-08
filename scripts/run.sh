#!/usr/bin/env bash
# Build + run helper for the DevBox image.
set -euo pipefail

IMAGE="${IMAGE:-devbox}"
NAME="${NAME:-devbox}"
PORT="${PORT:-8080}"
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
      -p "${PORT}:9080" \
      -v "${VOLUME}:/workspace" \
      --tmpfs /tmp \
      "$IMAGE"
    echo "DevBox up  ->  https://localhost:${PORT}/launcher/"
    echo "Certificate is self-signed: expect a browser warning on first visit."
    echo "First visit: set your password on the login page (user: user)"
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