# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this repository is

The **commercetools Connect payment connector for Unzer**. Four independently deployed applications:

- **`processor/`** — the Connect service (Fastify on `:8080`, clean/onion rings). All payment logic
  runs against `processor/src/providers/psp/`, a real Unzer integration: a hand-rolled REST client
  (`client/` — `transport.ts` is the one `fetch` against the Unzer `/v1/*` Direct API, composed of
  per-resource modules under `resources/`) implementing the full `ProviderModule` contract.
- **`enabler/`** — the browser payment library (Vite lib build into `public/`) over Unzer UI
  Components v2. It ships no page and reads no environment: `processorUrl` and `sessionId` are
  constructor options, everything else comes from `GET /operations/payment-config`. `npm run serve`
  builds it and serves the bundle with CORS on `:3000`.
- **`mc/`** — the Merchant Center custom application: per-store connection and payment-method config.
- **`mc-view/`** — the Merchant Center custom view: the order-details payments panel.

Plus `e2e/` (Playwright, over the processor's webhook surface). The shopper-journey demo storefront
lives in its own repository and loads the built enabler bundle over HTTP (`VITE_ENABLER_URL`); the
browser-driven legs live there too.

The browser tokenizes card data in Unzer's UI Components v2 elements and the processor charges the
resulting resource id; the PAN never reaches the enabler, the storefront DOM or the processor. There
is no in-memory gateway and no processor-served hosted pages, so an end-to-end charge needs Unzer
sandbox credentials.

## Architecture rules (enforced, not advisory)

- Processor rings: `domain/` ← `application/` ← `infrastructure/`; all provider code lives under
  `providers/psp/` behind the `ProviderModule` contract
  (`application/handlers/provider-module.ts`). Only `composition-root.ts` wires a provider.
- Processor HTTP + orchestration are grouped by CONSUMING APPLICATION: `routes/`, `dtos/` and
  `application/orchestration/` each split into `mc/`, `mc-view/`, `checkout/`, `enabler/`, `vendor/`,
  `public/` (+ `shared/`). `routes/operation.route.ts` is only the `/operations` composer, and
  `test/architecture-http-surfaces.spec.ts` holds each group to its auth policy. The orchestration
  barrel `application/orchestration/index.ts` stays the only entry — deep imports are eslint-blocked.
- Every outbound call has ONE address. commercetools goes through `infrastructure/commercetools/` —
  `ctClient` (custom-objects / payments / stores / orders), `ctServices` + `ctAuthHooks`, `errors.ts` —
  the only module allowed to name `paymentSDK` (`test/architecture-ct-client.spec.ts`). The vendor
  goes through `providers/psp/client/`: `transport.ts` is the one `fetch`, `requests/` are named
  request objects, `responses/` parse-and-validate (typed `PspError` on drift), `resources/` are
  composed by `PspClient` — held by `test/architecture-vendor-transport.spec.ts`. No vendor or CT call
  takes loose positional arguments.
- The vendor SDK imports only under `providers/psp/**`; `@commercetools/connect-payments-sdk` never
  imports there (eslint `no-restricted-imports` zones + `test/architecture-boundaries.spec.ts` +
  `test/contracts-payment-provider.spec.ts`).
- The four apps are standalone — no npm workspaces (the root `package.json` holds lint-staged config
  only). The connector root is the repo root.
- Code MAY name the vendor: the neutral `psp` slot (`providers/psp`, `PspConfig`) and vendor-named
  symbols (the enabler's `UnzerMethodComponent`, `components/unzer/`) coexist. Vendor identity lives,
  in part, in `providers/psp/brand.defaults.json` (`paymentInterface: "unzer"`, the sandbox/live
  hosts, container `unzer-connector-config`, manage permission `canManageUnzerPayments`) and the
  `unzer-payments` entry point the `mc` / `mc-view` deployments are configured with
  (`ENTRY_POINT_URI_PATH`, a `connect.yaml` key per deployment, with the literal as a development
  fallback in `mc/src/constants.ts`).
- Connection credentials are the Unzer key pair `publicKey` / `privateKey`, saved per store from the
  Merchant Center app into the encrypted `unzer-connector-config` Custom Object — there is no
  environment baseline; the active environment is `mode: sandbox | live`.

## Commands

```bash
# processor (from processor/): npm test | npm run lint | npm run build | npm run dev
# enabler   (from enabler/):   npm run build | npx jest | npm run lint | npm run serve
# mc / mc-view (from each):    npm ci && npm run lint && npm run typecheck && npm test && npm run build
# e2e (from e2e/):             npm run typecheck | npx playwright test (stack must be running)
# local stack: docker compose up   (processor :8080, enabler bundle :3000)
```

There is no shared test runner: each app's gate must be green before any "done" claim, with the
command output shown.

A gate is a glob, and `e2e/` falls outside every one of them: it has no eslint config and declares
`typecheck` and `test` only, while root `lint-staged` globs `{processor,enabler}`, `mc` and `mc-view`.
So changes under `e2e/**` are neither formatted nor linted at commit or in CI — `e2e` is
compiler-checked by `npm run typecheck`, and Playwright needs a running stack plus `UNZER_SANDBOX_*`.
"All four apps green" says nothing about it; name it explicitly instead.

## Code style

- TypeScript strict everywhere; match the surrounding file's naming and idiom.
- **Comments go ON functions, never inside them.** A function, class, type, interface member or
  exported constant may carry a SHORT doc comment - one or two lines saying what it is for. A body
  carries none: no inline `//` notes between statements, no prose block above a section of a body, no
  narrated reasoning, in source or in tests. This holds whatever the surrounding file looks like:
  older files are far denser than this, and their comments stay where they are unless the code under
  them is being rewritten - do not add new ones to match them.
- **Imports use the shortest path**: when a ring/package barrel (`index.ts`) re-exports a symbol,
  import from the barrel (`../../domain`), never a deeper module the barrel already covers. Deep
  imports only for symbols a barrel deliberately does not re-export
  (e.g. `domain/custom-types/reconciliation`).
- Errors leave the provider only as typed `PspError` (`providers/psp/errors.ts`); raw vendor bodies
  never escape. Amounts are ISO-4217 minor units end to end.
- Secrets: never in source, logs, or test fixtures; the inbound webhook is admitted by the
  capability-URL token in its path (`POST /webhooks/:storeKey/:token`), compared constant-time and
  fail-closed before any I/O, and redacted wherever the URL is logged.
