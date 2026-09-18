#!/usr/bin/env bash
# Launch a per-workflow dev container: an independent repo clone running all services
# (processor, enabler, mc, mc-view) behind a per-container ngrok tunnel, with the Claude Code
# CLI and a shared ~/.claude.
#
# Usage (Git Bash on Windows):
#   NGROK_AUTHTOKEN=... WF_SECRETS_ENV=/path/secrets.env \
#     scripts/workflow-up.sh <name> <branch> [port-base]
#
# Required env:
#   NGROK_AUTHTOKEN   ngrok agent authtoken (free tier = 1 tunnel at a time; parallel needs paid)
#   WF_SECRETS_ENV    path to a host env-file (NOT in git) carrying the union of app secrets:
#                     CTP_*, PSP_*, mc CLOUD_IDENTIFIER /
#                     CUSTOM_APPLICATION_ID / ENTRY_POINT_URI_PATH / CTP_INITIAL_PROJECT_KEY, ...
# Optional env:
#   REPO_URL          git remote to clone (default: this repo's `origin`)
#   GH_TOKEN          token so clone + Claude's `git push` work over https, non-interactively
#   WF_APPS           none|mc|mc-view|both  (default both)
#   CLAUDE_DIR        host ~/.claude to share RW (default: $HOME/.claude)
#   GITCONFIG         host .gitconfig to mount read-only for commit identity (default: none)
set -euo pipefail

NAME="${1:-}"
BRANCH="${2:-}"
OFFSET="${3:-}"
[ -n "$NAME" ] && [ -n "$BRANCH" ] || { echo "Usage: $0 <name> <branch> [port-base]" >&2; exit 2; }

: "${NGROK_AUTHTOKEN:?set NGROK_AUTHTOKEN}"
: "${WF_SECRETS_ENV:?set WF_SECRETS_ENV to a host env-file with the app secrets}"
[ -f "$WF_SECRETS_ENV" ] || { echo "ERROR: WF_SECRETS_ENV file not found: $WF_SECRETS_ENV" >&2; exit 1; }

# On Git Bash (Windows) docker needs Windows-form host paths for -v/--env-file, but the
# container-side paths must NOT be MSYS-converted. We pass sources through cygpath and run
# `docker run` under MSYS_NO_PATHCONV=1 (the `docker build` context path, by contrast, must
# stay auto-converted — so only the run is wrapped).
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_URL="${REPO_URL:-$(git -C "$REPO_DIR" remote get-url origin)}"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
WF_APPS="${WF_APPS:-both}"
IMAGE=ct-wf:dev
CONTAINER="ct-wf-$NAME"

# Port base: explicit arg, else deterministic from the name so repeat launches are stable and
# distinct workflows rarely collide (step 10 leaves room for +1 mc / +2 mc-view).
if [ -n "$OFFSET" ]; then
  WF_PORT_BASE="$OFFSET"
else
  WF_PORT_BASE=$((3100 + ($(cksum <<<"$NAME" | cut -d' ' -f1) % 30) * 10))
fi
ENABLER_PORT=$((WF_PORT_BASE))
MC_PORT=$((WF_PORT_BASE + 1))
MCVIEW_PORT=$((WF_PORT_BASE + 2))

if [ -n "$(docker ps -aq -f "name=^${CONTAINER}$")" ]; then
  echo "ERROR: container $CONTAINER already exists — 'scripts/workflow-down.sh $NAME' first." >&2
  exit 1
fi

echo "Building $IMAGE ..."
docker build -f "$REPO_DIR/deployment/dev/workflow.Dockerfile" -t "$IMAGE" "$REPO_DIR"

echo "Starting $CONTAINER (branch $BRANCH, ports ${ENABLER_PORT}/${MC_PORT}/${MCVIEW_PORT}) ..."
MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" \
  --env-file "$(winpath "$WF_SECRETS_ENV")" \
  -e REPO_URL="$REPO_URL" \
  -e WF_BRANCH="$BRANCH" \
  -e WF_PORT_BASE="$WF_PORT_BASE" \
  -e WF_APPS="$WF_APPS" \
  -e NGROK_AUTHTOKEN="$NGROK_AUTHTOKEN" \
  ${GH_TOKEN:+-e GH_TOKEN="$GH_TOKEN"} \
  -v "$(winpath "$CLAUDE_DIR")":/root/.claude \
  ${GITCONFIG:+-v "$(winpath "$GITCONFIG")":/root/.gitconfig:ro} \
  -p "${ENABLER_PORT}:${ENABLER_PORT}" \
  -p "${MC_PORT}:${MC_PORT}" \
  -p "${MCVIEW_PORT}:${MCVIEW_PORT}" \
  "$IMAGE"

echo
echo "Booting (clone + npm install + ngrok can take a few minutes). Follow it:"
echo "  docker logs -f $CONTAINER"
echo
echo "Once ready:"
echo "  enabler   http://localhost:$ENABLER_PORT"
case "$WF_APPS" in
  mc)      echo "  mc        https://localhost:$MC_PORT" ;;
  mc-view) echo "  mc-view   https://localhost:$MCVIEW_PORT" ;;
  both)
    echo "  mc        https://localhost:$MC_PORT"
    echo "  mc-view   https://localhost:$MCVIEW_PORT"
    ;;
esac
echo "  processor public URL → docker logs $CONTAINER  (grep 'Processor public URL')"
echo "  attach Claude        → docker exec -it $CONTAINER claude"
echo "  stop + remove        → scripts/workflow-down.sh $NAME"
