#!/usr/bin/env bash
# Stop and remove a per-workflow dev container started by workflow-up.sh.
# The clone lives only inside the container, so make sure Claude has pushed its branch first.
#
# Usage: scripts/workflow-down.sh <name>
set -euo pipefail

NAME="${1:-}"
[ -n "$NAME" ] || { echo "Usage: $0 <name>" >&2; exit 2; }
CONTAINER="ct-wf-$NAME"

if [ -z "$(docker ps -aq -f "name=^${CONTAINER}$")" ]; then
  echo "No container named $CONTAINER."
  exit 0
fi

docker rm -f "$CONTAINER" >/dev/null
echo "Removed $CONTAINER."
