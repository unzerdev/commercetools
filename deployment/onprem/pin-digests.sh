#!/usr/bin/env bash
# Resolve each base image tag to its immutable content digest and print the .env lines to paste.
# Run this on a networked host BEFORE a production build so images are pinned by digest, not by a
# mutable tag (AC27). Requires docker buildx + registry access (no local daemon needed for inspect).
#
#   ./pin-digests.sh >> .env      # then de-duplicate the *_IMAGE keys, keeping the digest form
set -euo pipefail

images=(
  "NODE_IMAGE=node:22.14.0-alpine3.21"
  "NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27.4-alpine"
  "ALPINE_IMAGE=alpine:3.21"
)

for entry in "${images[@]}"; do
  var="${entry%%=*}"
  ref="${entry#*=}"
  repo="${ref%%:*}"
  digest="$(docker buildx imagetools inspect "$ref" --format '{{.Manifest.Digest}}')"
  echo "${var}=${repo}@${digest}"
done
