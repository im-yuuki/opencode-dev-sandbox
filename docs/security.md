# Security model

This is a **trusted single-user development environment**. It is not a multi-tenant sandbox, and
the boundary it defends is the container, not the processes inside it.

- **One uid for everything.** Agent, desktop, code-server, FileBrowser and CLIProxyAPI all run as
  uid 1000. They are not isolated from each other: any one of them can read, modify or kill the
  others' files and processes.
- **Web terminal sessions share that boundary.** The terminal broker runs as uid 1000 and starts
  private tmux sessions. Session IDs are not a multi-user security boundary; processes already
  running as uid 1000 can inspect or terminate them.
- **Shared secrets on the volume.** `/workspace/.devbox` holds the CLIProxy management key,
  provider OAuth tokens, proxy API keys, the FileBrowser database and the Unix password hash.
  The hash is stored without the plaintext password. Directory modes are
  restrictive against *other* accounts, but everything running as uid 1000 can read them. The TLS
  private key is the one exception: root-owned `0600`, since only nginx needs it. Hiding dotfiles
  in the file manager is tidiness, not a boundary.
- **Sudo reaches root.** Whoever holds the web password can become root inside the container.
- **One authentication layer.** FileBrowser runs with its own auth disabled, and code-server with
  `--auth none`. The nginx/PAM session gate is the only thing in front of them, which is why their
  ports must never be published.
- **Do not expose the container to an untrusted network.** Treat the published ports the way you
  would treat an SSH port into your workstation.
- **Chrome's sandbox depends on the runtime.** It needs unprivileged user namespaces from the host
  and container runtime; see [usage.md](usage.md#chrome-sandbox).

See also [usage.md](usage.md) for sudo policy and the [README](../README.md) quick start.
