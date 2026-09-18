# Per-workflow dev container for the connector.
#
# One image that runs ALL services (processor, enabler, mc, mc-view) plus a per-container
# ngrok tunnel and the Claude Code CLI. The source is NOT baked in and NOT mounted — the
# entrypoint clones the repo fresh at runtime (scripts/workflow-entrypoint.sh), so every
# container is an independent checkout.
FROM node:22

# git      — the entrypoint clones the repo; Claude commits/pushes from inside.
# ngrok    — public https tunnel for the processor (MC forward-to rejects http).
# claude-code — Claude runs INSIDE the container against the shared ~/.claude (bind-mounted).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl gnupg git ca-certificates; \
    curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
      | gpg --dearmor -o /etc/apt/trusted.gpg.d/ngrok.gpg; \
    echo "deb https://ngrok-agent.s3.amazonaws.com bookworm main" > /etc/apt/sources.list.d/ngrok.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends ngrok; \
    rm -rf /var/lib/apt/lists/*; \
    npm install -g @anthropic-ai/claude-code

ENV HOME=/root
WORKDIR /workspace

# Only the entrypoint is copied into the image; everything else arrives via `git clone`.
COPY scripts/workflow-entrypoint.sh /usr/local/bin/workflow-entrypoint.sh
RUN chmod +x /usr/local/bin/workflow-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/workflow-entrypoint.sh"]
