#!/usr/bin/env bash
# Terminal Hub setup — bootstrap a fresh checkout on macOS or a Linux VPS.
# Installs dependencies, ensures a .env with a remote-access token, and builds.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Terminal Hub setup"

# 1. Require Node >= 20.
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js >= 20 is required but was not found in PATH." >&2
  exit 1
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  echo "Error: Node.js >= 20 required (found $(node -v))." >&2
  exit 1
fi
echo "  Node $(node -v)"

# 2. Ensure .env exists with a token. Never clobber an existing one.
if [ -f .env ]; then
  echo "  .env already present — leaving it untouched."
  echo "  (current token: run 'grep TERMINALHUB_TOKEN .env' to view it)"
else
  if command -v openssl >/dev/null 2>&1; then
    token="$(openssl rand -hex 32)"
  else
    token="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  fi
  # Build .env from the example, filling in the generated token (portable; no sed -i).
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      TERMINALHUB_TOKEN=*) printf 'TERMINALHUB_TOKEN=%s\n' "$token" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.example > .env
  echo "  Created .env with a fresh TERMINALHUB_TOKEN:"
  echo "      $token"
  echo "  Paste this into Settings -> Access token on each remote device."
fi

# 3. Install dependencies (runs the node-pty spawn-helper chmod via postinstall).
echo "==> Installing dependencies (npm install)…"
npm install

# 4. Build server + web for production.
echo "==> Building (npm run build)…"
npm run build

echo
echo "==> Done. Start Terminal Hub with:"
echo "      npm start"
echo
echo "   Binds 127.0.0.1:8189 by default — front it with a tunnel (cloudflared)"
echo "   pointed at that address, or set HOST=0.0.0.0 in .env for a direct bind."
