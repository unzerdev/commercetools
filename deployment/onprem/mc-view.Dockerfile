# syntax=docker/dockerfile:1
# Production image for the Merchant Center custom view (mc-view). Same build+serve shape as mc:
# `mc-scripts build` bakes the non-secret registration values into the static bundle, then a non-root
# nginx serves it on 8080 with SPA rewrites.

ARG NODE_IMAGE=node:22.14.0-alpine3.21
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27.4-alpine

FROM ${NODE_IMAGE} AS build
ARG CUSTOM_VIEW_ID
ARG ENTRY_POINT_URI_PATH
ARG CLOUD_IDENTIFIER=gcp-eu
ARG APPLICATION_URL
ARG PROCESSOR_URL
ENV CUSTOM_VIEW_ID=${CUSTOM_VIEW_ID} \
    ENTRY_POINT_URI_PATH=${ENTRY_POINT_URI_PATH} \
    CLOUD_IDENTIFIER=${CLOUD_IDENTIFIER} \
    APPLICATION_URL=${APPLICATION_URL} \
    PROCESSOR_URL=${PROCESSOR_URL}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM ${NGINX_IMAGE} AS runtime
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
