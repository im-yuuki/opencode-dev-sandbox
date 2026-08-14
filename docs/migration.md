# Container migration

Use this guide to upgrade an existing container while preserving the
`devbox-workspace` volume and the user's login password.

## Before upgrade

For a container created before password-hash persistence was added, export the
existing password hash once while the old container is still running:

```bash
docker exec -u root devbox sh -c 'set -eu; hash="$(getent shadow user | cut -d: -f2)"; test -n "$hash"; printf "%s\n" "$hash" > /workspace/.devbox/user-password.hash; chown root:root /workspace/.devbox/user-password.hash; chmod 600 /workspace/.devbox/user-password.hash'
```

The command writes only the hash and never prints the password or hash.

New containers persist only the shadow hash automatically after the password is
set through the first-run web form. The plaintext password is never written to
the volume.

## Recreate container

Stop and remove only the container, then recreate it with the same workspace
volume:

```bash
docker stop devbox
docker rm devbox
docker run -d --security-opt seccomp=unconfined --restart=unless-stopped --pull always --tmpfs /tmp --shm-size=1g -p 127.0.0.1:8080:80/tcp -p 127.0.0.1:8443:443/tcp --name devbox -v devbox-workspace:/workspace ghcr.io/im-yuuki/opencode-dev-sandbox:latest
```

For the Docker Hub image, replace the image name with:

```text
imyuuki/opencode-dev-sandbox:latest
```

The entrypoint preserves existing workspace data, restores the Unix password
from `/workspace/.devbox/user-password.hash`, and seeds user-owned OpenCode and
OpenChamber packages into `/workspace/.local` when they are missing.

Do **not** use `docker rm -v` or delete `devbox-workspace` during migration.

## Verify

Open the Launcher and verify that the existing password still works. Then
launch Agent and confirm that OpenCode/OpenChamber start normally.
