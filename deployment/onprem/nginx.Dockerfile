# syntax=docker/dockerfile:1
# Front nginx: TLS termination + reverse proxy + security headers. Built on the unprivileged nginx
# image (runs as uid 101, listens on unprivileged ports, pid in /tmp) so it satisfies non-root +
# read-only-rootfs. The config is baked in; only the TLS certs are mounted at runtime.
#
# The base image's docker-entrypoint renders /etc/nginx/templates/*.template through envsubst into
# /etc/nginx/conf.d at startup — the compose service mounts that dir as tmpfs so it stays writable
# under a read-only root filesystem.

ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27.4-alpine
FROM ${NGINX_IMAGE}

COPY nginx/snippets/ /etc/nginx/snippets/
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080 8443
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
