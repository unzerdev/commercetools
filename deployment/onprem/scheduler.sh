#!/bin/sh
# Auto-capture scheduler: the processor owns auto-capture; there is no separate job app.
# On a fixed cadence it POSTs the processor's auto-capture endpoint over the internal network.
#
# The auto-capture endpoint itself lands in Phase 5; until then this POST is an inert 404 and the
# wiring is already in place. A failed run (endpoint absent, transient error) never kills the loop —
# the next tick retries. No secret is logged; the bearer token, when set, is sent only as a header.
set -eu

PROCESSOR_URL="${PROCESSOR_URL:?PROCESSOR_URL is required}"
SCHEDULER_TARGET_PATH="${SCHEDULER_TARGET_PATH:-/jobs/auto-capture}"
SCHEDULER_INTERVAL_SECONDS="${SCHEDULER_INTERVAL_SECONDS:-60}"

while true; do
  # Heartbeat for the container healthcheck (proves the loop is alive and the fs is writable).
  touch /tmp/scheduler-alive

  if [ -n "${SCHEDULER_TOKEN:-}" ]; then
    curl -fsS -m 30 -X POST -H "Authorization: Bearer ${SCHEDULER_TOKEN}" \
      "${PROCESSOR_URL}${SCHEDULER_TARGET_PATH}" >/dev/null 2>&1 || true
  else
    curl -fsS -m 30 -X POST "${PROCESSOR_URL}${SCHEDULER_TARGET_PATH}" >/dev/null 2>&1 || true
  fi

  sleep "${SCHEDULER_INTERVAL_SECONDS}"
done
