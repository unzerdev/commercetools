# Connector E2E harness (`@psp/e2e`)

Standalone [Playwright](https://playwright.dev/) suite that drives the **processor's HTTP surface**
against a running stack.

This is **TEST-ONLY tooling**. It is **not** a Connect `deployAs` app, is **not** in `connect.yaml`,
and is **not** part of any npm workspace — it has its own `package.json` and toolchain and no
dependency on the other apps (`processor`, `enabler`, `mc`, `mc-view`).

The browser-driven legs — the shopper journey, the card iframe, 3-D Secure — live in the **demo store
repository**, which is the surface that mounts the enabler. What stays here is the webhook receiver,
which has no browser leg at all:

- **Runs against the local stack, no vendor account** — the fail-closed negatives on the capability
  URL (`401` on a bad token, `404` with no token at all).
- **Needs a connected Unzer SANDBOX** (`UNZER_SANDBOX_PUBLIC_KEY`) — the settlement-lifecycle case,
  which reconciles a real charge. It is a `test.fixme` that only a live sandbox run can pin.

It still needs the processor up, so it is not a blocking unit gate: the repo's `tsc` + eslint gates
do not run it.

## Prerequisites

The harness starts **no server** — bring the processor up externally first:

| Service   | URL                     | Notes                          |
| --------- | ----------------------- | ------------------------------ |
| processor | `http://localhost:8080` | `PROCESSOR_URL` in `.env`      |

`docker compose up` from the repository root, or `scripts/dev-local.sh`, does that.

## Running

```bash
npm ci
npx playwright install chromium   # first run only
cp .env.template .env             # then fill it in
npm run typecheck                 # the only gate CI runs here
npx playwright test
```

## Environment

Copy `.env.template` → `.env`. Playwright loads it in `playwright.config.ts` with Node 22's own
`process.loadEnvFile`, so there is no dotenv dependency; values already exported in the shell win.

| Variable | Role |
|---|---|
| `PROCESSOR_URL` | the processor base URL every request is built against |
| `E2E_STORE_KEY` | the store key the webhook POST path targets; without it the negatives skip |
| `ENCRYPTION_KEY` | the processor's own key, from which `support/webhook-token.ts` re-derives the capability-URL token; without it only the fail-closed negatives run |
| `UNZER_SANDBOX_PUBLIC_KEY` / `UNZER_SANDBOX_PRIVATE_KEY` | gate the settlement-lifecycle leg |

## Layout

```
e2e/
  playwright.config.ts  # testDir ./tests, no baseURL, single chromium project
  tests/
    webhook.spec.ts     # the capability-URL token gate + the settlement lifecycle
  support/
    webhook-token.ts    # re-derives the per-store token from ENCRYPTION_KEY, in Node
```

## A note on the token

The inbound webhook is admitted by the capability-URL token in its path
(`POST /webhooks/:storeKey/:token`), compared constant-time and fail-closed before any I/O. The token
is a domain-separated HMAC-SHA256 over `"psp-webhook-url-token:v1:" + storeKey`, keyed by
`ENCRYPTION_KEY` — which is why this suite can compute the valid one without asking the processor for
it, and why the whole URL is a bearer secret that must never be logged or committed.
