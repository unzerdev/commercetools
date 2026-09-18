# syntax=docker/dockerfile:1
# Production image for the enabler (browser payment library). Multi-stage: build the vite library
# bundle into public/, then serve it as static assets from a non-root nginx on 8080. The enabler
# build needs no env (VITE_* only feed the local dev demo page, not the library).

ARG NODE_IMAGE=node:22.14.0-alpine3.21
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27.4-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM ${NGINX_IMAGE} AS runtime
# Static site config: server_tokens off, a /healthz liveness route, long-cache for hashed bundles.
# Edge security headers (HSTS/CSP) are the front nginx's job — this internal server only serves files.
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    server_name _;
    server_tokens off;
    root /usr/share/nginx/html;
    index index.html;

    location = /healthz {
        access_log off;
        add_header Content-Type text/plain;
        return 200 'ok';
    }

    location ~* \.(js|css|woff2?|png|jpe?g|gif|webp|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
COPY --from=build /app/public /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
