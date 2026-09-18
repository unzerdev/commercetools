#!/usr/bin/env bash
# Local no-docker dev runner for the connector.
#
# Starts the same processes as the dev docker-compose, directly on the host:
#   - processor on :8080 (nodemon + ts-node watch), validating REAL commercetools JWTs
#     (the mc-api JWKS derived from CTP_REGION in its own .env — there is no JWT mock)
#   - enabler dev server on :3000 (vite)
#   - optionally the Merchant Center dev apps: `mc` and/or `mc-view`. mc-scripts
#     defaults its dev server to :3001, so a single MC app runs there; `both`
#     runs mc on :3001 AND mc-view on :3002 (HTTP_PORT + APPLICATION_URL override,
#     since mc-scripts reads the dev-server port from HTTP_PORT, else 3001).
#
# Each app is standalone (plain `npm install` + run; no shared-module prebuild).
#
# The merchant /operations/* routes need a REAL commercetools exchange JWT, which the MC API
# Gateway mints only for an https forward-to target, so exercising them from outside the Merchant
# Center means tunnelling the processor (`ngrok http 8080`).
#
# Usage (from anywhere, Git Bash on Windows):
#   scripts/dev-local.sh            # core: processor + the enabler bundle
#   scripts/dev-local.sh mc         # core + Merchant Center custom app  (:3001)
#   scripts/dev-local.sh mc-view    # core + Merchant Center custom view (:3001)
#   scripts/dev-local.sh both       # core + mc (:3001) + mc-view (:3002)
#
# NOTE (both): mc-view is served at https://localhost:3002 via HTTP_PORT=3002 and
# APPLICATION_URL is set to match. For a REAL Merchant Center login the 3002 origin
# must be allowed in the MC Custom Application config; local dev (compile-html:local)
# does not need it. If mc-view still grabs :3001, set APPLICATION_URL=https://localhost:3002
# and HTTP_PORT=3002 in mc-view/.env (dotenv may not let the env override win).
#
# Ctrl+C stops every started process. Logs stream to .dev-logs/<service>.log.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"

case "$TARGET" in
  ''|mc|mc-view|both) ;;
  *) echo "Usage: $0 [mc|mc-view|both]" >&2; exit 2 ;;
esac

# Free exactly the ports this runner is about to own, best effort (`require_free` below stays the
# real gate; `|| true` so an already-free port or a missing npx never aborts the start here).
# kill-port is PINNED — an unpinned `npx <name>` executes whatever the registry serves latest
# (a locally installed binary is used rather than npx, which can resolve a squatted package).
DEV_PORTS=(8080 3000)
case "$TARGET" in
  mc|mc-view) DEV_PORTS+=(3001) ;;
  both) DEV_PORTS+=(3001 3002) ;;
esac
npx --yes kill-port@2.0.1 "${DEV_PORTS[@]}" || true

# --- prerequisites ------------------------------------------------------------
if ! command -v node >/dev/null; then
  echo "ERROR: node is not on PATH." >&2
  if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "You are in WSL bash ('bash' from PowerShell resolves to WSL, not Git Bash)." >&2
    echo "Run this from Git Bash instead:" >&2
    echo '  & "C:\Program Files\Git\bin\bash.exe" scripts/dev-local.sh' >&2
  fi
  exit 1
fi

for f in "$REPO_DIR/processor/.env"; do
  [ -f "$f" ] || { echo "ERROR: missing $f — copy the .env.template next to it and fill it in." >&2; exit 1; }
done

require_free() {
  local port="$1"
  if curl -s -o /dev/null -m 2 "http://localhost:$port/" 2>/dev/null; then
    echo "ERROR: port $port is already in use (docker dev stack still running? 'docker compose down' it first, or stop the local process)." >&2
    exit 1
  fi
}
require_free 8080
require_free 3000
case "$TARGET" in
  mc|mc-view) require_free 3001 ;;
  both) require_free 3001; require_free 3002 ;;
esac

# npm scripts must run under bash, not cmd.exe: the docker containers install
# node_modules over the same bind mount without Windows .cmd shims.
export npm_config_script_shell
npm_config_script_shell="$(command -v bash)"

ensure_deps() {
  local dir="$1"
  # Always `npm install`, never skip: the docker containers populate the same
  # tree with Linux-only native binaries — npm install adds the missing
  # platform-specific packages and regenerates the bin shims for this OS.
  echo "Syncing dependencies in ${dir#"$REPO_DIR"/}..."
  (cd "$dir" && npm install --no-audit --no-fund >/dev/null)
}
ensure_deps "$REPO_DIR/processor"
ensure_deps "$REPO_DIR/enabler"
case "$TARGET" in
  mc|mc-view) ensure_deps "$REPO_DIR/$TARGET" ;;
  both) ensure_deps "$REPO_DIR/mc"; ensure_deps "$REPO_DIR/mc-view" ;;
esac

# Headless bootstrap — parity with the docker post-deploy the compose stack runs. Runs the
# encryption-key rotation and nothing else (post-deploy writes no config object; the store
# connection and the custom types both come from PUT /operations/store-config). A missing or weak
# ENCRYPTION_KEY fails here, exactly as the processor itself would refuse to boot. Idempotent, so
# it is safe to run on every start.
echo "Running processor post-deploy (encryption-key rotation)..."
if ! (cd "$REPO_DIR/processor" && npx ts-node src/infrastructure/connectors/post-deploy.ts); then
  echo "WARNING: post-deploy failed — the encryption-key rotation did not complete." >&2
  echo "         The processor will refuse to start until processor/.env carries a strong" >&2
  echo "         ENCRYPTION_KEY (openssl rand -hex 32)." >&2
fi

LOG_DIR="$REPO_DIR/.dev-logs"
mkdir -p "$LOG_DIR"

# --- process management ---------------------------------------------------------
PIDS=()

kill_tree() {
  local pid="$1"
  if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]; then
    # Git Bash on Windows: kill the whole tree, or node children survive.
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
  else
    kill -- -"$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  echo
  echo "Stopping dev services..."
  for pid in "${PIDS[@]}"; do kill_tree "$pid"; done
}
trap cleanup EXIT INT TERM

start_service() {
  local name="$1"; shift
  echo "  -> $name (logs: ${LOG_DIR#"$REPO_DIR"/}/$name.log)"
  "$@" >"$LOG_DIR/$name.log" 2>&1 &
  PIDS+=("$!")
}

echo "Starting dev services locally (no docker):"

# Processor in watch mode. CTP_REGION is NOT overridden: it validates merchant JWTs against the
# real Merchant Center JWKS derived from its own .env, exactly as a deployment does. There is no
# mock issuer to fall back on.
start_service processor env -C "$REPO_DIR/processor" npm run watch

# Enabler bundle: built once, then served with CORS on :3000 for a storefront to load.
start_service enabler env -C "$REPO_DIR/enabler" npm run serve

case "$TARGET" in
  mc|mc-view)
    start_service "$TARGET" env -C "$REPO_DIR/$TARGET" npm run start
    ;;
  both)
    # mc on the default :3001; mc-view moved to :3002 (HTTP_PORT drives the mc-scripts
    # dev-server port; APPLICATION_URL is set to match so the app's origin is correct).
    start_service mc env -C "$REPO_DIR/mc" npm run start
    start_service mc-view env -C "$REPO_DIR/mc-view" \
      HTTP_PORT=3002 APPLICATION_URL=https://localhost:3002 npm run start
    ;;
esac

echo
echo "URLs once each service finishes booting:"
echo "  processor    http://localhost:8080   (401 without a token = healthy)"
echo "  enabler      http://localhost:3000   (dev checkout page)"
case "$TARGET" in
  mc|mc-view) echo "  $TARGET      https://localhost:3001   (first webpack compile takes minutes)" ;;
  both)
    echo "  mc           https://localhost:3001   (first webpack compile takes minutes)"
    echo "  mc-view      https://localhost:3002   (first webpack compile takes minutes)"
    ;;
esac
echo
echo "Ctrl+C stops everything. Tail a log: tail -f ${LOG_DIR#"$REPO_DIR"/}/processor.log"

wait
