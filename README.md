# commercetools Connect payment connector — Unzer

A **commercetools Connect payment connector for Unzer**. It ships four independently deployed
applications plus a Playwright suite over the processor's HTTP surface, and covers the whole payment
lifecycle: browser-side card tokenization, charge/authorize, 3-D Secure and redirect return legs,
capture/refund/cancel from the Merchant Center, webhook reconciliation, and per-store configuration.

- **`processor/`** — the Connect service (Fastify on `:8080`, clean/onion rings
  `domain/` ← `application/` ← `infrastructure/`). All payment logic runs against
  **`processor/src/providers/psp/`**, a real Unzer integration: a hand-rolled REST client
  (`client/psp-client.ts`, `fetch` against the Unzer `/v1/*` Payment API) implementing the full
  `ProviderModule` contract (`processor/src/application/handlers/provider-module.ts`).
- **`enabler/`** — the browser payment components (Vite library build) over **Unzer UI Components
  v2**. The SDK is loaded at runtime from `https://static-v2.unzer.com/v2/ui-components/index.js`
  (`src/components/unzer/sdk.ts`), card fields render inside Unzer's own `<unzer-*>` custom-element
  iframes, and only the resulting single-use `resourceId` is posted to `POST /payments`.
  It is a LIBRARY and nothing else: it ships no page of its own, and `npm run serve` builds the
  bundle and serves it with CORS on `:3000` for a storefront to load. The shopper-journey demo
  storefront lives in its own repository and consumes it over HTTP.
- **`mc/`** — the Merchant Center custom application: per-store connection (Unzer key pair per
  environment) and per-store payment-method configuration.
- **`mc-view/`** — the Merchant Center custom view: the order-details payments panel.

The PAN never reaches the enabler, the storefront DOM, or the processor. Exercising a real charge
therefore requires **Unzer sandbox credentials**; everything that does not charge (config, the
fail-closed negatives, the shopper config projection) runs against the local stack without a vendor
account.

## Quick start

1. **Configure the processor**: `cp processor/.env.template processor/.env` and fill it. The
   processor **refuses to boot** only on what cannot degrade: `ENCRYPTION_KEY` unset or weak, and
   `PSP_RETURN_FAILURE_URL` unset (`processor/src/main.ts`). Everything else falls back and is
   reported on stdout: the processor's own origin is derived from each request's `Host`, and an empty
   `PSP_ALLOWED_RETURN_ORIGINS` admits every http(s) origin. The Unzer credentials are not
   environment variables at all - they are saved per store from the Merchant Center application.
   Generate the key with `openssl rand -hex 32`.
2. **Start the stack**: `docker compose up` — processor on `:8080`, the enabler bundle served on
   `:3000`. The `mc` and `mc-view` services are profile-gated and share `:3001`, so run one at a
   time: `docker compose --profile mc up` or `docker compose --profile mc-view up`. Without Docker,
   `scripts/dev-local.sh [mc|mc-view|both]` starts the same processes on the host.
3. **Exercise it from a storefront**: point the demo store repository's `VITE_ENABLER_URL` at
   `http://localhost:3000/connector-enabler.es.js`. The processor's `PSP_ALLOWED_RETURN_ORIGINS`
   must contain the shop's origin for the return leg.
4. **Run the headless suite**: `cd e2e && npx playwright test` against the running processor. Copy
   `e2e/.env.template` → `e2e/.env` first; the webhook spec's valid-token leg gates on
   `ENCRYPTION_KEY` (the same value the processor stack runs with, since the capability-URL token
   derives from it) and its settlement leg on `UNZER_SANDBOX_*`. The fail-closed negatives always
   run.

## Serving the bundle

`npm run serve` in `enabler/` builds the library and serves `public/` on `:3000` with CORS — that is
the whole of the enabler's dev story now. There is no page, no dev server and no `VITE_*` env: the
library reads everything it needs from its constructor options and from
`GET /operations/payment-config`.

The enabler posts `returnUrl = window.location.href`, so `PSP_ALLOWED_RETURN_ORIGINS` must contain
the origin of whichever storefront pays. An unlisted origin makes `POST /payments` fail at intake.
The payment step then renders one row per method `GET /operations/payment-config` advertises, which
is the store's own configuration.

## Repository map

| Path | Contents |
|---|---|
| `processor/` | Connect service: `domain/` ← `application/` ← `infrastructure/` rings + `providers/psp/` (the Unzer integration) + `composition-root.ts`, the only file that names a provider |
| `enabler/` | the browser payment library: `src/components/unzer/`, `src/stored/`, `src/payment-enabler/` — Vite lib build into `public/` |
| `mc/` | Merchant Center custom application — `src/components/config-app/sections/{connection,payment-modes}` |
| `mc-view/` | Merchant Center custom view — `src/components/payments-panel/` (`unzer-payment-card.tsx`, `unzer.css`) |
| `e2e/` | Playwright suite over the processor's webhook surface; token derivation in `support/webhook-token.ts` |
| `deployment/onprem/` | on-premise docker-compose stack (four apps + scheduler + nginx front) |
| `deployment/dev/` | the per-workflow dev container (`workflow.Dockerfile`) |
| `scripts/` | local dev runners (`dev-local.sh`, `workflow-up.sh`, `workflow-down.sh`) |
| `connect.yaml` | the Connect deployment manifest — four `deployAs` applications and every configuration key |

The four applications are standalone: each carries its own `package.json` and lockfile, and none
imports another. The root `package.json` (`@psp/root-tooling`) holds the lint-staged config only —
there are no npm workspaces.

## Environment variables

`connect.yaml` is the authority for what a deployment sets. The processor's own contract is
`processor/src/infrastructure/config/` (`config.ts`, `ctp-region.ts`, `env-store-settings.ts`,
`encryption-key-guard.ts`, `public-url-guard.ts`, `return-leg-guard.ts`); the local-development
copy is `processor/.env.template`. Secrets are never logged and never returned in plaintext by any
endpoint.

Vendor identity is **not** environment: `paymentInterface`, `displayName`, the sandbox/live hosts,
the telemetry header name, the integrator string, the Custom Object container names, the manage
permission and the commercetools custom-Type key ship in
`processor/src/providers/psp/brand.defaults.json` and reach the runtime through
`infrastructure/config/brand.ts`. The vendor-call timeout is the hardcoded constant
`DEFAULT_REQUEST_TIMEOUT_MS` (30 000 ms) in `infrastructure/config/config.ts`, not a knob. The
per-store webhook URL is derived as `{processor origin}/webhooks/{storeKey}/{token}` — the
trailing token is a MAC derived from `ENCRYPTION_KEY` over the store key,
which makes the whole URL a bearer secret — and is overridable only per store, through
`environments.<mode>.webhookUrl` (the override wins **verbatim**, so it must embed a valid token
itself).

### processor

| Variable | Secured | Required | Example | Meaning |
|---|---|---|---|---|
| `CTP_PROJECT_KEY` | No | Yes | `my-store-prod` | commercetools project key. |
| `CTP_CLIENT_ID` | No | Yes | `abcDEF123456` | API-client ID. Scopes (`connect.yaml`): `manage_payments`, `manage_orders`, `view_sessions`, `manage_checkout_payment_intents`, `introspect_oauth_tokens`, `manage_types`, `view_types`, `manage_states`, `view_stores`, `view_project_settings`, `manage_key_value_documents`, `view_customers`. `view_customers` is read only to resolve the signed-in shopper's date of birth, which buy-now-pay-later methods require; without it that read logs a warning and the payment proceeds without the birthdate. `manage_types` and `manage_states` are what saving a store connection provisions the payment custom type and the eight `PaymentState` states with; until that has happened `GET /operations/status` reports `connector-provisioning` DOWN. |
| `CTP_REGION` | No | Yes | `europe-west1.gcp` | commercetools region as `{cloudRegion}.{cloudProvider}`. The six commercetools URLs are derived from it (`ctp-region.ts`): auth/api/session/checkout, plus the MC-API JWKS and JWT issuer on `mc-api.<region>.commercetools.com` used to validate MC-app JWTs. `connect.yaml` declares **no default**, so a deployment cannot install on a prefilled region. |
| `PSP_ALLOWED_RETURN_ORIGINS` | No | No | `https://shop.example.com,https://checkout.example.com` | Comma-separated allowlist of storefront origins accepted as the shopper return URL, checked at intake and again before the 302. **Optional**: empty admits EVERY http(s) origin, and the boot prints `return leg: PSP_ALLOWED_RETURN_ORIGINS is empty ...`. Non-http(s) targets (`javascript:`, `data:`) are refused regardless - that scheme check is what keeps them out of a 302 when the list is open. Set it in production so the redirect after payment can only land on your own shops. |
| `PSP_RETURN_FAILURE_URL` | No | Yes at boot | `https://shop.example.com/payment/failed` | The single safe sink the RETURN leg redirects to on any failure (unknown payment, invalid return context, off-allowlist or non-http(s) URL). Declared `required: true` in `connect.yaml`; `return-leg-guard.ts` refuses the boot when unset - without it the shopper would see a 500. |
| `CTP_CLIENT_SECRET` | **Yes** | Yes | `s3cr3t…` | commercetools API-client secret. |
| `ENCRYPTION_KEY` | **Yes** | Yes | `0123…64hex` | AES-256-GCM current key of the encryption keyring (64 hex used raw, otherwise SHA-256-derived). New ciphertext is written under it in the `v1:<key-id>:<iv>:<tag>:<ciphertext>` envelope. It encrypts the secret fields of the `unzer-connector-config` Custom Object, and the same keyring mints the webhook capability-URL token (a domain-separated HMAC, so the MAC use stays disjoint from the AES-GCM use). The processor and the post-deploy both refuse to run without it. |
| `ENCRYPTION_KEY_PREVIOUS` | **Yes** | No | `4567…64hex` | Previous key of the keyring, for zero-downtime rotation. Decryption selects the key whose fingerprint matches the envelope key-id and falls back to this one; new ciphertext is always written under `ENCRYPTION_KEY`. Webhook-token verification accepts the previous key's derivation too, so deliveries addressed to the old capability URL keep arriving until it is dropped. When set, post-deploy re-encrypts existing `unzer-connector-config` secrets under the current key **and** re-registers every credentialed store environment's Unzer subscription with the current-key URL. |
| `LOGGER_LEVEL` | No | No | `info` | winston log level. Read in `config.ts`, default `info`. **Not declared in `connect.yaml`** (the default applies on Connect); settable in on-prem/local `.env` only. |
| `HEALTH_CHECK_TIMEOUT` | No | No | `5000` | `/operations/status` downstream health-check timeout in ms. Read in `config.ts`, default `5000`. **Not declared in `connect.yaml`**; settable in on-prem/local `.env` only. |
| `PSP_TRACE_VENDOR_CALLS` | No | No | `1` | Developer diagnostic: set to `1` and the vendor transport logs each call's method, path and body (never the `Authorization` header), for reading a vendor refusal against the actual payload. Read in `providers/psp/client/transport.ts`. Deliberately **not** a `connect.yaml` key — a declared toggle invites leaving it on in production. |

### mc and mc-view (Merchant Center applications)

| Variable | App | Required | Meaning |
|---|---|---|---|
| `CUSTOM_APPLICATION_ID` | `mc` | Yes | The Custom Application ID. |
| `CUSTOM_VIEW_ID` | `mc-view` | Yes | The Custom View ID. |
| `ENTRY_POINT_URI_PATH` | `mc` | Yes | The application entry point. It derives the MC permission the operator must hold (`canManage<TitleCase(path)>`), which the processor enforces as `brand.managePermission` — `unzer-payments` / `canManageUnzerPayments` in this distribution. `mc-view` carries the same value in its own `.env`: `custom-view-config.mjs` names its `additionalOAuthScopes` group after it, so the two sides must agree or every manage route answers `403`. |
| `CLOUD_IDENTIFIER` | both | No (default `gcp-eu`) | The cloud identifier of the target region. |
| `APPLICATION_URL` | both | Platform-injected | The origin the built bundle is served from, baked in as its production `url`. **Not declared in `connect.yaml`**: Connect injects it into every Merchant Center application build with the host it assigned, and overrides whatever a deployment would type (`PLATFORM_ASSIGNED_KEYS`), so it was removed from the install form. Only a local or on-prem build sets it, in `.env` (`https://localhost:3001` for `mc-scripts start`). It must equal the URL the application is registered under in the Merchant Center. |
| `PROCESSOR_URL` | both | No | Base URL of the processor `/operations/*` API the app forwards to via the MC API Gateway `/proxy/forward-to`. **Optional**, because a first install has nothing to put here: Connect assigns the processor its URL at deploy time. Leave it empty for that first pass, then copy the assigned URL into both applications and deploy again (see [Finding the processor](#finding-the-processor)). Both applications must carry the same value; without it every merchant call fails with "the processor URL is not configured". |

Local development additionally reads `CTP_INITIAL_PROJECT_KEY`,
`ENABLE_NEW_JSX_TRANSFORM` and `FAST_REFRESH` from each app's `.env`
(`mc/.env.template`, `mc-view/.env.template`); Connect deployments supply the values above at
build time.

### Finding the processor

On Connect the processor's URL is assigned **at deploy time**, after the `mc` and `mc-view` bundles
are built - and Connect interpolates no application's URL into another's configuration (the only key
it assigns is each application's own `APPLICATION_URL`). Installing is therefore a two-pass job:

1. Install the connector with `PROCESSOR_URL` empty in both Merchant Center applications. The
   processor deploys and Connect shows the URL it assigned it.
2. Copy that URL into `PROCESSOR_URL` on both `mc` and `mc-view`, and deploy again. The two must
   carry the same value.

The processor itself is never told its own URL. The merchant-JWT audience gate, the webhook
capability URL and the shopper return base all derive from the origin each request's `Host` header
names (`infrastructure/config/public-origin.ts`), which the platform ingress routes by and a client
cannot forge into this process; in the post-deploy, where there is no request, the origin Connect
assigned (`CONNECT_SERVICE_URL`) stands in.

There is **no CSP `connect-src`** naming the processor on either application, deliberately: the
browser never opens a connection to the processor origin. Every call goes to the gateway's
`/proxy/forward-to`, which forwards server-side. The one processor-origin resource a panel loads is
a payment-method logo, and that is `img-src`, whose Merchant Center default is already `*`.

### enabler

The enabler reads **no environment at all**. It is a library: `processorUrl` and `sessionId` are
constructor options the host passes, and everything else comes from
`GET /operations/payment-config`. There is no `enabler/.env`.

## Per-store configuration

Configuration is resolved **per `storeKey`** and read on every request — edits need no redeploy.
The shopper flow derives the store key from the cart's store; the merchant `X-Store-Key` header and
the webhook / post-deploy paths fall back to the commercetools project key. Two layers deep-merge,
highest wins field by field (`infrastructure/config/resolve-store-config.ts`):

| Precedence (low → high) | Source |
|---|---|
| 1 | the `unzer-connector-config` Custom Object for `__default__` |
| 2 | the `unzer-connector-config` Custom Object for `<storeKey>` |

Plain objects deep-merge; arrays and scalars are replaced wholesale. Both layers are written **only**
by `PUT /operations/store-config`, which encrypts secret leaves at rest with `ENCRYPTION_KEY`. There
is no environment layer: the Unzer credentials exist only where the merchant saved them. A write
whose target resolves to the commercetools project key is rejected `400` - that key is reserved and
may never hold a per-store config.

### The `StoredStoreConfig` envelope

Both entries — the `__default__` scope and the store's own Custom Object — are the same envelope,
with exactly three top-level keys:

| Field | Secret | Meaning |
|---|---|---|
| `mode` | No | `"sandbox"` \| `"live"` (default `"sandbox"`) — selects which `environments.<mode>` block is active. |
| `environments.<mode>.credentials` | **Yes** | The Unzer key pair for that environment: `publicKey`, `privateKey`. The only source there is - no environment baseline exists. |
| `environments.<mode>.host` | No | Vendor API host override for that environment. Omitted, `brand.defaults.json` applies: `defaultHost` (`https://sbx-api.unzer.com`) for `sandbox`, `defaultHostLive` (`https://api.unzer.com`) for `live`. |
| `environments.<mode>.webhookUrl` | No (persisted in plaintext) | Overrides the derived `{processor origin}/webhooks/{storeKey}/{token}` **verbatim**, so an override must embed a valid token itself. Because this leaf is not encrypted at rest, an override carrying a token is a bearer credential readable by anyone with read access to the config container; prefer the derived URL. |
| `settings` | No | The provider-owned settings document. **This connector declares none**: `providers/psp/config/store-settings.schema.ts` is `Type.Object({}, { additionalProperties: false })`, so `settings` is either absent or `{}`, and any field in it fails validation. |

Every field is optional: an environment is connected once it carries a `credentials` pair, and the
`__default__` scope is what a store with no document of its own inherits. `GET` masks every secret
leaf to `"***"`; `DELETE` disconnects.

### The `store-config` transport schema

`GET`/`PUT`/`DELETE /operations/store-config` speak a **narrower** shape than the stored envelope
(`infrastructure/http/dtos/operations/store-config.dto.ts`), strict on every object
(`additionalProperties: false`):

| Field | Accepted on the wire |
|---|---|
| `mode` | `"sandbox"` \| `"live"` |
| `environments.sandbox` / `environments.live` | `credentials` only (a string map, ≤ 16 keys, each value ≤ 512 chars) |
| `settings` | passed through opaquely, then strict-validated by the provider's `ConfigHandler.validate` |

`host` and `webhookUrl` are **rejected** at this boundary: the vendor host derives from the active
`mode` and the webhook URL from the processor's own origin plus the derived token, so neither can be
redirected by a hand-crafted `PUT`. Every field is optional (the Custom Object is an override layer), but an
environment *being connected* must carry `credentials.publicKey` and `credentials.privateKey` —
enforced fail-closed in the `updateStoreConfig` orchestrator with a field-level `400`. `GET` always
masks every secret leaf to `"***"`. `DELETE` disconnects: it clears the active environment's
credentials and deletes the whole Custom Object once no environment retains any.

### Payment-method configuration

Per-method behaviour is a separate, **plaintext** Custom Object
(`unzer-connector-payment-methods`), read and written through
`GET`/`PUT /operations/payment-methods?mode=sandbox|live` over
`infrastructure/http/dtos/operations/payment-methods.dto.ts`. One entry per method:

| Field | Type | Required |
|---|---|---|
| `paymentMethodCode` | string | Yes |
| `enabled` | boolean | Yes |
| `name` / `description` | `{ <locale>: <text> }` | Yes |
| `minAmount` / `maxAmount` | currency-keyed map `{ "<ISO-4217>": <minor units> }` | No |
| `surcharge` | currency-keyed map `{ "<ISO-4217>": <minor units> }` | Yes (may be empty `{}`) |
| `countries` | array of ISO-3166 alpha-2 codes (`^[A-Z]{2}$`) | Yes |
| `sendBasketData` | boolean | Yes |
| `bookingMode` | `"charge"` \| `"authorize"` | No |
| `googlePay` | `{ merchantId?, merchantName?, countryCode?: "DK"\|"CH", allowedCardNetworks?, allowCreditCards?, allowPrepaidCards?, buttonColor?, buttonSizeMode? }` — **Google Pay only** | No |
| `applePay` | `{ supportedNetworks?, label? }` — **Apple Pay only** | No |

A wallet block on any other method is refused with a 400: it would describe nothing, and reading it later would
suggest the wallet was configured when it was not.

Amounts are stated **per currency**, in the minor units of that entry's own currency, and nothing is
converted — commercetools exposes no exchange rates. An entry applies to its own currency only: a cart
in a currency with no `minAmount`/`maxAmount` entry carries no limit, and one with no `surcharge` entry is
charged no surcharge. Every `currency` is ISO-4217 alpha-3 (`^[A-Z]{3}$`). Two rules span more than one
field and are enforced in the orchestrator with a `400`: `min <= max` within one currency's window, and
a currency may appear at most once in either list.

The `GET` view adds four read-only fields per method — `supportsAuthorize` and `supportsCharge`, the two
**independent** transaction kinds Unzer accepts for that method, and `vendorCountries` /
`vendorCurrencies`, the coverage Unzer itself declares (each empty means unrestricted) — all derived from
the live catalogue and the provider's transaction table. The `PUT` schema declares none of them, so none is
persisted; Fastify's ajv strips an undeclared property rather than rejecting it, which is why the merchant
app strips all four itself instead of relying on a 400.

`bookingMode` is a **preference, not a decision**. A method may accept both kinds (`card`, `paypal`,
`applepay`, `googlepay`, `wero`), only an authorization (`klarna` and the `paylater-*` family — a direct
charge answers `500 API.000.000.999`), or only a direct charge (`ideal`, `bancontact`, `przelewy24`,
`twint`, `alipay`, `wechatpay`, `prepayment`, `payu`, `openbanking-pis`, `post-finance-efinance`, `EPS`,
`sepa-direct-debit` — an authorization answers `405 API.320.000.004`). Where one kind is possible the
processor books it whatever is stored, and the merchant app hides the booking control; where both are
possible the merchant's choice stands, and where they made none the per-method default applies —
`authorize` for cards, PayPal, Wero and the paylater family, a direct charge for the wallets, following the
vendor's own per-method booking behaviour. The method codes the provider recognizes are listed in
`processor/src/providers/psp/supported-methods.ts`: `card`, `paypal`, `applepay`, `googlepay`,
`paylater-invoice`, `paylater-installment`, `installment-secured`, `invoice-secured`.

#### Which methods a shopper is offered

`GET /operations/payment-config` intersects the merchant's configuration with Unzer's own coverage.
A method survives four gates, in this order: it is `enabled`; a non-empty `countries` restriction
contains the **billing** country (falling back to the cart's country, then the shipping country); the
`minAmount`/`maxAmount` window for the **cart's currency**, when one exists, contains the cart total; and the
vendor's `vendorCountries` / `vendorCurrencies` for that method, each when non-empty, contain the
cart's country and currency. The vendor coverage is read from `GET /v1/keypair/types` — the same call that
probes connectivity — as the union of `paymentTypes[].supports[].{countries, currency}` per method type, so
a method Unzer does not serve for the cart's market is withheld at the checkout rather than refused at
charge time.

Only the shopper request filters. The merchant `GET /operations/payment-methods` returns **every** method
the account's keypair advertises, with `vendorCountries` / `vendorCurrencies` attached as information, so a
merchant configures a method they can see even when no current cart would be offered it.

The amount maps are per currency: with `minAmount: { "EUR": 500, "JPY": 500 }`,
`maxAmount: { "EUR": 100000 }` and `surcharge: { "EUR": 150 }`, a EUR cart under €5.00 or over
€1000.00 is not offered the method and one within the window pays a €1.50 surcharge; a JPY cart must
reach ¥500 and pays no surcharge, because `surcharge` carries no JPY entry; a cart in any other
currency is offered the method with no limit and no surcharge, subject to the vendor coverage gate.

## Features

### HTTP surface

| Route | Auth |
|---|---|
| `POST /payments` | commercetools session (`X-Session-Id`) |
| `GET /operations/payment-config` | commercetools session |
| `GET /return` | none — authenticated structurally against the server-stamped Unzer payment id (timing-safe, fail-closed) |
| `POST /webhooks/:storeKey/:token` | none — the per-store capability-URL token, compared constant-time and fail-closed before any I/O |
| `GET /assets/method-logo/:code` | none — the bundled per-method artwork the connector ships |
| `GET /health` | none - liveness only: `{ status: "ok", name, version }` from `package.json`, no configuration and no downstream call, so a deployment can be confirmed up (and told apart from the previous build) without a token. Downstream state stays behind `GET /operations/status`. |
| `POST /operations/payment-intents/:id` | commercetools OAuth2 (the certified Checkout route) |
| `POST /operations/payments/:id/intents` | MC JWT (the panel's capture/refund/cancel/reverse route) |
| `GET /operations/orders/:orderId/payments` | MC JWT |
| `GET`/`PUT`/`DELETE /operations/store-config` | MC JWT |
| `GET`/`PUT /operations/payment-methods` | MC JWT |
| `GET /operations/store-reference-data`, `GET /operations/stores` | MC JWT |
| `POST /operations/testconnection` | MC JWT |
| `GET /operations/status` | MC JWT |
| `GET /operations/payment-components` | MC JWT + audience only - **no manage permission**: Checkout probes it with an exchange token of its own that carries no operator permissions, and a manage gate there made Checkout report the connector as broken. Answers `components: [unzer]` and `dropins: [embedded]` - the same method list under both Checkout integration modes (web component or Drop-in; one is active at a time): the enabler renders every method the Merchant Center app enabled for the shopper's store and mounts the chosen one under it (`enabler/src/components/unzer/method-list.ts`). |

Every MC JWT route but `payment-components` runs three guards (`infrastructure/http/routes/operation.route.ts`):
**token audience** (`aud` origin must equal the origin the request's `Host` names), **manage permission**
(`canManageUnzerPayments` in the forwarded `<iss>/claims/user_permissions` claim), and — on the
store-scoped routes — **store existence** (the effective `X-Store-Key` must resolve to a real
project store). Each rejects with `403`.

### Payments

The enabler bootstraps from `GET /operations/payment-config`, which carries the shopper public key
for the active mode, the locale, the session cart `amount`
(minor units, no surcharge), the purchase `country` and the enabled cart-eligible methods with their
locale-resolved name/description, minor-unit surcharge and `needsAmountData` — true only for the
instalment surface, which is handed the amount, currency and country through the vendor element's own
`setBasketData` so it can fetch its plan list. The
shopper tokenizes inside the Unzer element: the HOST's pay button (commercetools Checkout's "Complete
purchase", a storefront's own) calls the component's `submit()`, which clicks the hidden submit control
inside `<unzer-checkout>`; the vendor tokenizes and reports the single-use resource id through
`onPaymentSubmit`. The component posts it to `POST /payments` with
`paymentMethodCode`, `returnUrl`,
optional `device` and `locale`, the `resourceId`, and — when the element
created one for this purchase — `vendorCustomerId`, which the processor charges as-is instead of building a
customer of its own. The processor
charges — or authorizes, per the method's `bookingMode` — and answers with a `FollowUpAction`:
`redirect` (3-D Secure or a redirect method), `sdkAction`, `display`, or `none`. Amounts are
ISO-4217 minor units end to end.

### Apple Pay and Google Pay

Both surfaces need their sheet described before they can be paid with, so the connector assembles it server-side
from the per-method `googlePay` / `applePay` configuration plus what it already knows — the Unzer **channel** the
keypair reports (Google's `gatewayMerchantId`), and the cart's total, currency and country — and the enabler hands
that object to the vendor's own `setGooglePayData` / `setApplePayData`. The wallet draws **its own** button, so the
connector renders none for these two however the host asks.

What the merchant must still do outside the connector: register the Apple Pay certificate with Unzer and serve
`apple-developer-merchantid-domain-association` from the STOREFRONT's domain (Apple shows no button until both are
in place), and obtain a Google Pay & Wallet Console merchant id — until `merchantId` is set, Google renders the
sheet in test mode. Apple's `label` (the payee name in the sheet) falls back to the store key, so it is worth
setting.

The connector writes the commercetools Payment (`amountPlanned` = cart total plus the method
surcharge, `interfaceId` = the Unzer payment id) and every Transaction itself; it never creates the
Order — commercetools Checkout owns that.

### Return leg

The redirect and 3-D Secure legs come back through the public `GET /return` route with no session
and no JWT. Its base is derived, not configured: `{processor origin}/return` (the configured or the request-derived origin), to which
`create-payment` appends `?ctPaymentId=<id>` before handing it to Unzer. Unzer appends no
signed token, so the return is authenticated **structurally**: the Unzer payment id is taken only
from the `pspPaymentId` custom field stamped server-side at charge time, and the resource
`getPayment` returns must be that same payment (timing-safe) before anything is reflected. An absent
stamp fails closed before any vendor call. The shopper return URL must be an absolute http(s) URL and,
when `PSP_ALLOWED_RETURN_ORIGINS` is set, on that allowlist - checked at intake and again before the 302
(an empty allowlist admits every http(s) origin) - and every failure resolves to the
single `PSP_RETURN_FAILURE_URL` sink — the shopper is never shown a 500 and payment existence is
not observable. The return leg is best-effort; the webhook is the authoritative reconciler.

### Webhooks

`POST /webhooks/:storeKey/:token` is a **capability URL**. The trailing segment is a 43-character
base64url MAC the processor derives per store —
`base64url(HMAC-SHA256(key material from ENCRYPTION_KEY, "psp-webhook-url-token:v1:" + storeKey))` —
and registers with Unzer when the store connects. `handleWebhook` compares it constant-time against
the current key's and the previous key's derivation before any commercetools or vendor call, and
fails closed: a wrong token and an unknown store answer the same `401 {"outcome":"unauthorized"}`,
while the tokenless `POST /webhooks/:storeKey` matches no route at all and answers `404`. The whole
URL is therefore a bearer secret — whoever holds it may post events — so no endpoint serves it
(`GET /operations/store-config` deliberately never returns it) and the processor's own request logs
redact the token segment. Beneath the gate the receiver captures the raw request body through a
webhook-scoped content-type parser, and the parsed envelope (`{ event, paymentId, retrieveUrl }`)
only points at the resource: the authoritative payment is re-read from Unzer, reconciled to the
commercetools Payment by an anchor that payment echoes — the minted `merchantReference` when Unzer
carries it, else the `orderId` the charge stamped with the commercetools Payment id — and deduped by
`interactionId`.
Subscriptions are registered on connect and deleted on disconnect, scoped to the key pair. The
registration names exactly the events the connector settles (`authorize.succeeded|failed|canceled`,
`charge.succeeded|failed|canceled`, `chargeback`) rather than `all` — one subscription per name, all on
the same URL, and every name is derived from the handler registry in
`processor/src/providers/psp/webhook/events/`, so nothing is subscribed that has no handler.
Anything else the vendor delivers is a free 200 no-op with no vendor read.

### Merchant Center store configuration (`mc`)

The custom application's content region is the store-configuration screen: a **connection** section
(per-environment Unzer key pair, server-validated connect and real disconnect) and a
**payment-modes** section (per-method enable/disable, localized name and description,
`bookingMode`, a per-currency amount window and surcharge, countries, basket-data toggle). It makes **zero direct
commercetools calls**: the store list, the reference data and a store's config are read and written
only through the processor's `/operations/*` endpoints over the MC API Gateway
`/proxy/forward-to`, with `includeUserPermissions: true` so the exchange token carries the
operator's permissions, and the selected store travelling as the `x-store-key` forward header.

### Merchant Center order panel (`mc-view`)

The order's payments panel renders **one card per connector payment**
(`src/components/payments-panel/unzer-payment-card.tsx`), fed by exactly one processor read —
`GET /operations/orders/:orderId/payments` — that carries every field on screen:

- **Header** — the Unzer mark, the payment identity (`providerPaymentId`, else the commercetools
  payment id), and an *In review* stamp when the payment carries the review flag.
- **Summary amount book** — Date (the earliest leg date, derived rather than read off index 0),
  Payment ID, Order ID, Merchant reference, Method, and the five amounts the vendor reports:
  Total, Authorized, Charged, Cancelled, Refunded.
- **Leg table** — one row per vendor operation: date, payment id, transaction id, method, type
  (`authorization`, `charge`, `refund`, `reversal`; an unknown kind renders verbatim), outcome
  (`success` / `pending` / `error`), amount.
- **Inline actions** — capture and refund each carry an amount input seeded with their headroom
  (`capturableAmount`, `refundableAmount`) and validated against it before the button arms; cancel
  states the uncaptured figure and voids it whole. Each opens a **confirmation dialog** naming the
  amount snapshotted at open, and posts one action —
  `capturePayment` / `refundPayment` / `cancelPayment` — to
  `POST /operations/payments/:id/intents`. An answered action re-reads the panel rather than
  patching the card.

What the card *displays* is the vendor's word (`details`); what an action is *allowed* to do is
commercetools' word. An unavailable provider read therefore degrades only the summary and the leg
table — the identity and the actions survive it, with a Retry offered when there is a
`providerPaymentId` to re-read.

Every money-moving operation is fenced off in commercetools before the vendor is called: the
operation's `Pending` leg is reserved under the version the guard read, so a concurrent write loses
with a `409` and never reaches the vendor. An operation whose outcome is never learned leaves the
payment blocked rather than repeatable: the blocked transaction is recognised by its `Pending` leg
with no terminal sibling, and is cleared by hand once the vendor's own record has been read.

## Development

1. Copy `processor/.env.template` → `processor/.env` and fill the values. Add `mc/.env` and
   `mc-view/.env` from their templates when
   running the Merchant Center apps.
2. Start the stack: `docker compose up` (processor `:8080`, enabler `:3000`; `mc` and `mc-view` are
   opt-in profiles on `:3001`), or run the apps as host processes with
   `scripts/dev-local.sh [mc|mc-view|both]`.
3. Quality gates, per app — each must be green on its own before any "done" claim:

| App | Gate |
|---|---|
| `processor/` | `npm test` · `npm run lint` · `npm run build` |
| `enabler/` | `npm run build` · `npx jest` · `npm run lint` |
| `mc/`, `mc-view/` | `npm ci && npm run lint && npm run typecheck && npm test && npm run build` |
| `e2e/` | `npx playwright test` against the running stack |

The architecture rules are enforced, not advisory: the ring boundaries are eslint
`import-x/no-restricted-paths` zones, the two SDK bans are
`@typescript-eslint/no-restricted-imports`, and both are asserted programmatically by
`processor/test/architecture-boundaries.spec.ts` and
`processor/test/contracts-payment-provider.spec.ts`.

For an isolated per-branch environment running all four apps behind an ngrok tunnel with real
commercetools JWTs, see the per-workflow dev container (`scripts/workflow-up.sh`,
`deployment/dev/workflow.Dockerfile`). On-premise deployment (the same four apps plus a scheduler
and an nginx front) is `deployment/onprem/`.
