# shellcheck shell=bash
# Shared workflow library for the connector dev surfaces.
#
# A pure function library — sourced, never executed. It carries NO top-level side effects
# (no `set`, no traps, no work at load): a caller sources it, sets the small shared state the
# functions expect, and calls what it needs. One consumer today:
#   - scripts/workflow-entrypoint.sh  (the per-workflow Docker container)
# It runs the connector as four plain Node processes fronted by an ngrok tunnel.
#
# Shared state a caller sets before use:
#   REPO_DIR       absolute path to the repo root (required by every function)
#   LOG_DIR      a writable log directory, already created (wf_start_tunnel / wf_start_service)
#   PIDS         a bash array (`PIDS=()`) the background-process functions append to
#   WF_BASE_DIR  optional; the prefix stripped from paths in log lines (default: $REPO_DIR)
# Output the library sets for the caller:
#   PUBLIC_URL   set by wf_start_tunnel to the tunnel's https public URL; both consumers read it
# Environment the functions read:
#   NGROK_AUTHTOKEN (required by wf_start_tunnel), NGROK_DOMAIN (optional; reserved domain)

# --- dependencies -------------------------------------------------------------
# `npm install` in one app directory. Idempotent; always installs (never skips): the
# containers/host may populate the same tree with platform-specific native binaries, and a
# plain install adds the missing ones and regenerates this OS's bin shims.
wf_ensure_deps() {
  local dir="$1"
  echo "Installing dependencies in ${dir#"${WF_BASE_DIR:-$REPO_DIR}"/} ..."
  (cd "$dir" && npm install --no-audit --no-fund >/dev/null)
}

# --- per-app .env materialization (web sandbox) -------------------------------
# Split the union process environment into per-app `.env` files, one per app, keyed by that
# app's `.env.template` (the authoritative key list — this tracks the code as templates change).
# For each template key that is actually present in the process env, write `KEY=<value>`.
#
# SKIPS any app whose `.env` already exists, so a developer's local files and the Docker
# workflow's own env handling are never clobbered. The Docker entrypoint does NOT call this
# (its secrets arrive via `--env-file` into the process env and are threaded per service); it
# is the web sandbox's way of turning one pasted union env-file into the per-app files that
# dev tooling (dev-local.sh's precondition, mc-scripts dotenv, the e2e harness) expects.
wf_materialize_envs() {
  local app template envfile key tmp
  for app in processor enabler mc mc-view e2e; do
    template="$REPO_DIR/$app/.env.template"
    envfile="$REPO_DIR/$app/.env"
    [ -f "$template" ] || continue
    if [ -f "$envfile" ]; then
      echo "Keeping existing ${app}/.env (not overwriting) ..."
      continue
    fi
    echo "Materializing ${app}/.env from the union env (keys: ${app}/.env.template) ..."
    # Accumulate into a temp file, publish it only if it ends up NON-empty. mktemp creates the
    # file 0600 (owner-only) and mv preserves that mode — the .env holds the commercetools secret,
    # the PSP API key and the AES ENCRYPTION_KEY, so it must not be world-readable. Publishing
    # only a non-empty file means a premature run (union env not yet populated) leaves no sticky
    # empty .env that a later run's skip-if-exists would keep forever. The temp name matches the
    # `.env.*` gitignore glob, so a crash-orphaned temp is never committable. NOTE: a PARTIALLY
    # populated union env still publishes a partial .env (some keys missing); skip-if-exists then
    # keeps it — to recover, delete the app's .env and re-run after fixing the union env.
    tmp="$(mktemp "$REPO_DIR/$app/.env.XXXXXX")"
    chmod 600 "$tmp"
    # Only real `KEY=` lines — never commented (`# FOO=`) or blank lines. Emit a key solely when it
    # is set AND non-empty in the process env (`:+`); a missing or empty key is left out so the app
    # falls back to its own default rather than being pinned to an empty string.
    while IFS= read -r key; do
      [ -n "$key" ] || continue
      if [ -n "${!key:+set}" ]; then
        printf '%s=%s\n' "$key" "${!key}" >>"$tmp"
      fi
    done < <(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$template" | sed 's/=$//')
    if [ -s "$tmp" ]; then
      mv "$tmp" "$envfile"
    else
      rm -f "$tmp"
      echo "  (no union-env key matched ${app}/.env.template — wrote nothing)"
    fi
  done
}

# --- headless post-deploy -----------------------------------------------------
# Parity with the platform deploy lifecycle: run the encryption-key rotation. A missing or weak
# ENCRYPTION_KEY fails here exactly as the processor would refuse to boot. Non-fatal (warn +
# continue): the processor's own boot guard is the hard gate.
wf_post_deploy() {
  echo "Running processor post-deploy (encryption-key rotation) ..."
  if ! (cd "$REPO_DIR/processor" && npx ts-node src/infrastructure/connectors/post-deploy.ts); then
    echo "WARNING: post-deploy failed — the encryption-key rotation did not complete." >&2
  fi
}

# --- ngrok: public URL for the processor --------------------------------------
# Start the ngrok agent tunnelling the processor (:8080) and set the global PUBLIC_URL to the
# reserved https public URL. The agent PID is appended to PIDS for cleanup. When NGROK_DOMAIN
# is set (the web sandbox: a reserved static domain, so the webhook + MC origin registration is
# one-time and stable across sessions) it is passed as `--domain`; when unset (the Docker
# workflow) ngrok assigns a random URL, as today.
#
# FAIL-HARD is preserved: no https URL within 60s → return 1. Both callers run under `set -e`
# (or check the return) and abort — a stack that comes up without its public ingress cannot
# exercise webhooks, /operations/*, or the shopper return leg.
wf_start_tunnel() {
  ngrok config add-authtoken "$NGROK_AUTHTOKEN" >/dev/null
  local domain_flag=()
  if [ -n "${NGROK_DOMAIN:-}" ]; then domain_flag=(--domain="$NGROK_DOMAIN"); fi
  echo "Starting ngrok tunnel to the processor (:8080)${NGROK_DOMAIN:+ on domain $NGROK_DOMAIN} ..."
  ngrok http 8080 "${domain_flag[@]}" --log stdout >"$LOG_DIR/ngrok.log" 2>&1 &
  PIDS+=("$!")

  # Poll the local ngrok agent API until the https public_url appears (node has global fetch).
  PUBLIC_URL="$(node -e '
    const api = "http://127.0.0.1:4040/api/tunnels";
    (async () => {
      for (let i = 0; i < 60; i++) {
        try {
          const res = await fetch(api);
          const body = await res.json();
          const tunnel = (body.tunnels || []).find((t) => (t.public_url || "").startsWith("https"));
          if (tunnel) { process.stdout.write(tunnel.public_url); return; }
        } catch { /* agent not up yet */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
      process.exit(1);
    })();
  ')" || { echo "ERROR: ngrok public URL not available after 60s (see $LOG_DIR/ngrok.log)." >&2; return 1; }

  echo "Processor public URL: $PUBLIC_URL"
}

# --- process management -------------------------------------------------------
# Start a named background service, logging to $LOG_DIR/<name>.log and tracking its PID.
wf_start_service() {
  local name="$1"; shift
  echo "  -> $name (logs: ${LOG_DIR#"${WF_BASE_DIR:-$REPO_DIR}"/}/$name.log)"
  "$@" >"$LOG_DIR/$name.log" 2>&1 &
  PIDS+=("$!")
}

# Kill every tracked PID. Wired by each caller as `trap wf_cleanup EXIT INT TERM`.
wf_cleanup() {
  echo
  echo "Stopping workflow services ..."
  for pid in "${PIDS[@]}"; do kill "$pid" >/dev/null 2>&1 || true; done
}
