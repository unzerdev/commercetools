# syntax=docker/dockerfile:1
# Minimal auto-capture scheduler: alpine + curl running a poll loop as a non-root user (no
# separate job app). Read-only rootfs compatible — it writes only the /tmp heartbeat (tmpfs).

ARG ALPINE_IMAGE=alpine:3.21
FROM ${ALPINE_IMAGE}

RUN apk add --no-cache curl \
  && adduser -D -H -u 10001 scheduler

COPY scheduler.sh /usr/local/bin/scheduler.sh
RUN chmod +x /usr/local/bin/scheduler.sh

USER scheduler
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD test -f /tmp/scheduler-alive || exit 1
ENTRYPOINT ["/usr/local/bin/scheduler.sh"]
