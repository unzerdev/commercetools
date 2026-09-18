#!/usr/bin/env bash
# Per-workflow container entrypoint for the connector.
#
# Runs INSIDE the workflow container (see deployment/dev/workflow.Dockerfile). Unlike
# dev-local.sh (host processes over local files) this clones the repo fresh so every
# container is an independent checkout — sessions never share or clobber source. It then
# starts all services under one process tree, fronted by a per-container ngrok tunnel
# that gives the processor a unique public https URL (needed because the Merchant Center
# `/proxy/forward-to` gateway rejects http targets — mc/mc-view reach the processor through
# it). No jwt-mock: the processor validates REAL commercetools JWTs against the mc-api JWKS
# derived from CTP_REGION, which stays at its env value and is never overridden here.
#
# Required env (from `docker run`): REPO_URL, WF_BRANCH, NGROK_AUTHTOKEN, WF_PORT_BASE.
# Optional: GH_TOKEN (git clone/push over https), WF_APPS (none|mc|mc-view|both, default both).
# Secrets (CTP_*/PSP_*) arrive via `docker run --env-file`.
#
# Ports (host-published 1:1 by workflow-up.sh): enabler=WF_PORT_BASE, mc=+1, mc-view=+2. The
# processor listens on 8080 internally and is exposed ONLY via ngrok (public https URL). The
# ngrok inspector stays on the container-internal 127.0.0.1:4040 (used to read the URL).
#
# This entrypoint sources scripts/lib-workflow.sh from the CLONED tree (not the image), so
# WF_BRANCH must carry a compatible lib-workflow.sh. A branch that predates
# the extraction would fail the source or call an undefined wf_* function.
set -euo pipefail

# --- inputs -------------------------------------------------------------------
: "${REPO_URL:?REPO_URL is required (the git remote to clone)}"
: "${WF_BRANCH:?WF_BRANCH is required (the branch to check out)}"
: "${NGROK_AUTHTOKEN:?NGROK_AUTHTOKEN is required (ngrok agent authtoken)}"
: "${WF_PORT_BASE:?WF_PORT_BASE is required (host port offset, e.g. 3100)}"
WF_APPS="${WF_APPS:-both}"

ENABLER_PORT=$((WF_PORT_BASE))
MC_PORT=$((WF_PORT_BASE + 1))
MCVIEW_PORT=$((WF_PORT_BASE + 2))

WORKSPACE=/workspace
REPO_DIR="$WORKSPACE"

# --- clone (independent checkout; no source mount) ----------------------------
# Fold GH_TOKEN into an https remote so both clone and Claude's later `git push` work
# without an interactive prompt. Leave REPO_URL untouched for ssh/anonymous remotes.
clone_url="$REPO_URL"
if [ -n "${GH_TOKEN:-}" ] && [[ "$REPO_URL" == https://* ]]; then
  clone_url="https://x-access-token:${GH_TOKEN}@${REPO_URL#https://}"
fi

if [ ! -d "$WORKSPACE/.git" ]; then
  echo "Cloning $REPO_URL @ $WF_BRANCH into $WORKSPACE ..."
  git clone --branch "$WF_BRANCH" "$clone_url" "$WORKSPACE"
fi
git config --global --add safe.directory "$WORKSPACE"

cd "$REPO_DIR"

# Shared workflow functions — sourced from the freshly-cloned tree (the Dockerfile copies only
# this entrypoint; the library arrives via `git clone` above and is used only post-clone).
# WF_BASE_DIR makes the library's log lines print paths relative to the workspace root (...),
# exactly as the inlined copies did.
WF_BASE_DIR="$WORKSPACE"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib-workflow.sh
source "$REPO_DIR/scripts/lib-workflow.sh"

# --- dependencies -------------------------------------------------------------
wf_ensure_deps "$REPO_DIR/processor"
wf_ensure_deps "$REPO_DIR/enabler"
case "$WF_APPS" in
  mc)      wf_ensure_deps "$REPO_DIR/mc" ;;
  mc-view) wf_ensure_deps "$REPO_DIR/mc-view" ;;
  both)    wf_ensure_deps "$REPO_DIR/mc"; wf_ensure_deps "$REPO_DIR/mc-view" ;;
  none)    ;;
  *) echo "ERROR: WF_APPS must be one of none|mc|mc-view|both (got '$WF_APPS')." >&2; exit 2 ;;
esac

# Headless bootstrap — parity with dev-local.sh. Runs the encryption-key rotation; a missing or
# weak ENCRYPTION_KEY fails here exactly as the processor would refuse to boot.
wf_post_deploy

# --- ngrok: public URL for the processor --------------------------------------
LOG_DIR="$REPO_DIR/.dev-logs"
mkdir -p "$LOG_DIR"

# Process tracking + cleanup wired before the tunnel so a tunnel failure still reaps the agent.
PIDS=()
trap wf_cleanup EXIT INT TERM

# No NGROK_DOMAIN here → ngrok assigns a random per-container URL, as today. Fail-hard on the
# 60s timeout (wf_start_tunnel returns 1 → `set -e` aborts). Sets the global PUBLIC_URL.
wf_start_tunnel

echo "Starting services (real commercetools JWT; processor exposed via ngrok):"

# Processor - its own origin is derived from each request's Host header, which behind ngrok is the
# tunnel URL, so the merchant JWT routes accept the tokens the MC API Gateway mints for it and the
# per-store webhook URL follows the tunnel ($PUBLIC_URL/webhooks/<storeKey>/<token>, the token a MAC
# over the store key from ENCRYPTION_KEY; a per-store stored webhookUrl overrides it), as does the
# connector's OWN public /return base ($PUBLIC_URL/return). CTP_REGION is NOT touched.
wf_start_service processor env -C "$REPO_DIR/processor" \
  npm run watch

# Enabler — a library, so there is nothing to configure: the bundle is built and served with CORS,
# and the storefront that loads it decides which processor URL to construct it with.
wf_start_service enabler env -C "$REPO_DIR/enabler" \
  npm run serve -- -l "$ENABLER_PORT"

# MC apps — PROCESSOR_URL must be the https ngrok URL (forward-to rejects http). mc-scripts
# bakes its dev origin from APPLICATION_URL/HTTP_PORT, so each runs on its own unique port and
# is published 1:1; register each new origin (https://localhost:<port>) in the MC app config.
case "$WF_APPS" in
  mc)
    wf_start_service mc env -C "$REPO_DIR/mc" \
      PROCESSOR_URL="$PUBLIC_URL" HTTP_PORT="$MC_PORT" APPLICATION_URL="https://localhost:$MC_PORT" \
      npm run start
    ;;
  mc-view)
    wf_start_service mc-view env -C "$REPO_DIR/mc-view" \
      PROCESSOR_URL="$PUBLIC_URL" HTTP_PORT="$MCVIEW_PORT" APPLICATION_URL="https://localhost:$MCVIEW_PORT" \
      npm run start
    ;;
  both)
    wf_start_service mc env -C "$REPO_DIR/mc" \
      PROCESSOR_URL="$PUBLIC_URL" HTTP_PORT="$MC_PORT" APPLICATION_URL="https://localhost:$MC_PORT" \
      npm run start
    wf_start_service mc-view env -C "$REPO_DIR/mc-view" \
      PROCESSOR_URL="$PUBLIC_URL" HTTP_PORT="$MCVIEW_PORT" APPLICATION_URL="https://localhost:$MCVIEW_PORT" \
      npm run start
    ;;
esac

echo
echo "Workflow container ready:"
echo "  processor    $PUBLIC_URL           (public; 401 without a token = healthy)"
echo "  enabler      http://localhost:$ENABLER_PORT   (dev checkout / QA console)"
case "$WF_APPS" in
  mc)      echo "  mc           https://localhost:$MC_PORT" ;;
  mc-view) echo "  mc-view      https://localhost:$MCVIEW_PORT" ;;
  both)
    echo "  mc           https://localhost:$MC_PORT"
    echo "  mc-view      https://localhost:$MCVIEW_PORT"
    ;;
esac
echo
echo "Public processor URL is above and in: docker logs \$HOSTNAME"
echo "Attach Claude:  docker exec -it \$HOSTNAME claude   (repo at $WORKSPACE)"

# Keep the container alive with the services; `docker exec` attaches Claude on top.
wait
