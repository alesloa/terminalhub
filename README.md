# Terminal Hub

A browser-based control center for AI coding-agent CLIs. Lay out **workspace cards** on a draggable canvas — each card is a folder on your machine. Open a card and you get a **room**: a main terminal plus a Zed-style side panel of additional terminals, each with its own title and color. Every terminal auto-launches the coding agent of your choice (`claude` by default, but it's agent-agnostic — `codex`, a plain shell, anything you can type).

Terminals are backed by **tmux**, so they survive browser refreshes, network drops, and reconnects. Close the tab, come back tomorrow, your agent is still running where you left it.

Run it **locally** in your browser, or reach it **from anywhere** (a tablet, another laptop) by putting a Cloudflare tunnel in front of it.

---

## Why

The agent you started is still running. The browser is just a screen attached to it. That's the whole idea: durable shells on your real machine, driven from a UI that makes juggling several agents across several folders feel like managing windows instead of hunting for tmux sessions.

## Features

- **Workspace canvas** — draggable cards, one per folder; positions persist.
- **Server-side folder picker** — browse the host filesystem, including other volumes (`/Volumes/*` on macOS, `/mnt`, `/media`, `/home` on Linux). The server runs on your machine, so it sees your real disks.
- **Terminal rooms** — main terminal + side panel; add, rename, recolor, switch, close.
- **Agent launch** — each new terminal runs the workspace's launch command (default `claude`).
- **Durable** — one tmux session per terminal; detaching a browser never kills the shell.
- **Task board** — a floating kanban (To Do / In Progress / Done) you drag cards across. Server-backed, so the agents in your terminals can read and move cards too (see below).
- **Local-first, remotely reachable** — frictionless on loopback; token-enforced the moment it's exposed.

---

## Requirements

- **Node ≥ 20**
- **tmux** (macOS: `brew install tmux` · Linux: `apt install tmux`)
- **gpg** — *optional*, only for the **Secret** burnable-link tool (macOS: `brew install gnupg` · Linux: `apt install gnupg`)
- A C toolchain for the native modules (`node-pty`, `better-sqlite3`)
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `build-essential`
- Whatever agent CLI you want to launch in PATH (e.g. `claude`)

---

## Quick start — macOS (native, terminals are your real Mac shells)

```bash
git clone https://github.com/alesloa/terminalhub.git && cd terminalhub
npm install
npm run build
npm start                 # binds 127.0.0.1:8189
# open http://localhost:8189
```

Prefer one command? `./setup.sh` installs deps, writes a `.env` with a freshly generated token, and builds — then `npm start`.

On loopback there's no token and no friction — open the URL and start making workspaces.

## Linux VPS (first-class target — terminals are real shells on that box)

tmux is native on Linux (often preinstalled; else `apt install tmux`). Same code, same flow as macOS.

```bash
sudo apt update && sudo apt install -y tmux build-essential git
git clone https://github.com/alesloa/terminalhub.git && cd terminalhub
./setup.sh                 # installs deps, writes .env with a generated token, builds
```

`setup.sh` prints the token it generated — keep it, you'll paste it into the UI later. It never clobbers an existing `.env`.

**No git on the box?** Build an archive on your machine and copy it across:

```bash
# on your machine, from the repo root
git archive --format=tar.gz -o /tmp/terminalhub.tar.gz HEAD
scp /tmp/terminalhub.tar.gz root@your-vps:/root/
# on the VPS
mkdir -p ~/terminalhub && tar xzf ~/terminalhub.tar.gz -C ~/terminalhub && cd ~/terminalhub && ./setup.sh
```

Never copy `node_modules` from another OS — `node-pty` and `better-sqlite3` are native, and `npm install` rebuilds them for the box (the archive above already excludes them).

Now decide how to reach it: a Cloudflare tunnel (recommended) or a direct public bind — both below. Run it on boot with the systemd unit further down.

---

## Remote access (only when you're away)

Terminal Hub binds to loopback. To reach it from another device, put a Cloudflare tunnel + **Cloudflare Access** in front of it. Cloudflare authenticates (email / MFA / SSO) *before* traffic ever hits Terminal Hub; the token is the backstop.

```bash
# one-time: install cloudflared, create a tunnel, add a Cloudflare Access policy
cloudflared tunnel run terminalhub     # points at 127.0.0.1:8189
```

Set a token first (see below) — once the app sees an exposed/forwarded request, it requires one. In the UI, open **Settings → Access token** and paste the same value.

### Direct public bind (no tunnel)

Quickest way to poke at it from another machine: bind every interface and open the port. The token is then the **only** thing standing between the internet and root shells on that box, so treat it like one.

```bash
# .env (setup.sh already generated TERMINALHUB_TOKEN for you):
HOST=0.0.0.0

sudo ufw allow 8189/tcp        # open the port (also open it in your provider's cloud firewall)
npm start                       # or: systemctl start terminalhub
```

Reach it at `http://<vps-ip>:8189`. The page loads, but every API call returns `401` until you open **Settings → Access token** and paste the token — a missing token shows up in the UI as "can't read" / "not a readable directory", not an obvious auth error.

The server won't boot on a non-loopback `HOST` without a token, so you can't expose an unauthenticated instance by accident. That's the floor, not a green light: anyone holding the token gets a root shell. Use the tunnel for anything beyond a quick test, and `systemctl stop terminalhub` when you're done.

---

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8189` | Listen port |
| `HOST` | `127.0.0.1` | Bind address. Anything non-loopback is treated as "exposed" and **requires `TERMINALHUB_TOKEN`** — the server refuses to boot otherwise. |
| `TERMINALHUB_TOKEN` | _(none)_ | Bearer token required for exposed/forwarded requests. |
| `TERMINALHUB_DB` | `data/terminalhub.db` | SQLite metadata path. |
| `FS_ROOTS` | _(none)_ | Comma-separated allowlist of folder roots (reserved for exposed deployments). |
| `ONETIME_BASE` | _(none)_ | Yopass-compatible "onetime" host for the **Secret** tool. The server encrypts with the host's `gpg` and uploads only ciphertext. Unset = the feature is disabled. |

The env prefix is **`TERMINALHUB_`**; the older `TERMINALHUB_` names are still read as a fallback, so an existing `.env` keeps working.

### Security model

- **Loopback = relaxed.** Requests from `127.0.0.1`/`::1` need no token. Local use is frictionless.
- **Exposed = enforced.** If a request arrives through a tunnel/proxy (`CF-Connecting-IP`, `X-Forwarded-For`) or from a non-loopback address, a valid `TERMINALHUB_TOKEN` is required.
- **Fail closed on boot.** Binding to a non-loopback `HOST` without `TERMINALHUB_TOKEN` set is refused — you can't accidentally expose an unauthenticated instance.

Keep `HOST=127.0.0.1` and let the tunnel be the only path in. That way Cloudflare Access is the front door and the token is the deadbolt.

---

## Run on boot

### macOS — launchd

Create `~/Library/LaunchAgents/com.terminalhub.plist` (adjust the two paths):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.terminalhub</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/you/terminalhub/server/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/you/terminalhub</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>8189</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.terminalhub.plist
```

### Linux — systemd

Create `/etc/systemd/system/terminalhub.service` (paths assume a `git clone` / archive into `/root/terminalhub` — adjust if yours differs):

```ini
[Unit]
Description=Terminal Hub
After=network.target

[Service]
WorkingDirectory=/root/terminalhub
ExecStart=/usr/bin/node server/dist/index.js
Restart=on-failure
RestartSec=2
# HOST, PORT, and TERMINALHUB_TOKEN are read from .env in WorkingDirectory at boot —
# no need to repeat the secret here. To run as a non-root user, add `User=youruser`.

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now terminalhub
journalctl -u terminalhub -f      # follow the logs; you want "Server listening" + "reconcile: …"
```

`ExecStart` points node at `server/dist/index.js`, so make sure you ran the build (`./setup.sh` or `npm run build`) first. Find the node path on the box with `command -v node` if it isn't `/usr/bin/node`.

---

## Development

```bash
npm install
npm run dev      # server on :8189 (tsx watch) + web on :5173 (vite, proxies /api and /ws)
# open http://localhost:5173
npm test         # backend unit + integration tests (vitest)
```

- `server/` — Fastify (REST + WebSocket) over a tmux controller + node-pty + better-sqlite3
- `web/` — React + Vite + xterm.js + dnd-kit
- `docs/PRD.md`, `docs/IMPLEMENTATION-PLAN.md` — design + build plan

## How it works (one paragraph)

Each terminal maps to a tmux session named `tr_<workspaceId>_<terminalId>`. Creating a terminal runs `tmux new-session -d` in the workspace folder and sends the launch command. The browser opens a WebSocket to `/ws/terminal/:id`; the server forks a PTY running `tmux attach`, pipes bytes both ways, and on disconnect kills *only* the attach process — the tmux session (and your agent) keeps running. SQLite stores workspace/terminal metadata; on boot the server reconciles stored terminals against live tmux sessions.

## Task board — agent API

The board lives behind a small REST API on the same port. From any terminal running on the host (loopback needs no token) an agent can read and move cards, and the floating board updates within a couple of seconds. Columns are `todo` / `doing` / `done`.

```bash
# read the whole board
curl -s localhost:8189/api/board

# add a card (defaults to the "todo" column)
curl -s -X POST localhost:8189/api/board/cards \
  -H 'content-type: application/json' -d '{"title":"wire up auth","body":"use the existing guard"}'

# move a card to another column (one PATCH does placement and edits)
curl -s -X PATCH localhost:8189/api/board/cards/<id> \
  -H 'content-type: application/json' -d '{"column":"done"}'

# reorder within a column: position is the index among the column's other cards (0 = top)
curl -s -X PATCH localhost:8189/api/board/cards/<id> \
  -H 'content-type: application/json' -d '{"column":"doing","position":0}'

# delete a card
curl -s -X DELETE localhost:8189/api/board/cards/<id>
```

When Terminal Hub is exposed (non-loopback), these calls need the `TERMINALHUB_TOKEN` as a `Authorization: Bearer` header, same as the rest of `/api/*`.

## Contributing

PRs are welcome, but note the licensing: Terminal Hub is dual-licensed (AGPL + commercial), so every contribution has to be shippable under both. By opening a PR you agree to the [Contributor License Agreement](CLA.md) — you keep ownership of your code and grant the right to ship it under any license, including the paid version. No payment, no ownership stake, attribution stays in the git history. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

Copyright © 2026 Ale Sloan.

Terminal Hub is licensed under the **GNU Affero General Public License v3.0** ([AGPL-3.0](LICENSE)). You're free to use, run, study, modify, and share it — including inside a company — as long as anything you build on it stays under the AGPL and you make your source available to the people you serve it to (the AGPL covers network use, not just distribution).

### Commercial license

Want to use Terminal Hub in a closed-source product, or otherwise can't live with the AGPL's copyleft terms? A separate commercial license is available — reach out via [GitHub](https://github.com/alesloa). Companies building on this should pay for it; individuals and open-source projects never have to.

### Sponsor

If Terminal Hub is useful to you, [sponsoring the project](https://github.com/sponsors/alesloa) keeps it moving and is genuinely appreciated.
