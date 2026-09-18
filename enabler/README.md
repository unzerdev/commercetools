# Payment Integration Enabler
This module provides an application based on [commercetools Connect](https://docs.commercetools.com/connect), which acts a wrapper implementation to cover frontend components provided by Payment Service Providers (PSPs)

PSPs provide libraries that can be used on client side to load on browser or other user agent which securely load DOM elements for payment methods and/or payment fields inputs. These libraries take control on saving PAN data of customer and reduce PCI scopes of the seller implementation. Now, with the usage of `enabler`, it allows the control to checkout product on when and how to load the `enabler` as connector UI based on business configuration. In cases connector is used directly and not through Checkout product, this connector UI can be loaded directly on frontend than the libraries provided by PSPs. 


## Getting Started

This module is a **library and nothing else**: it ships no page, no dev server and reads no
environment. `processorUrl` and `sessionId` are constructor options the embedding storefront passes;
everything else comes from `GET /operations/payment-config`.

#### Install dependencies
```
$ npm install
```
#### Build the bundle. The output lands in `public/` as `connector-enabler.{es,umd}.js`
```
$ npm run build
```
#### Build and serve the bundle with CORS on http://localhost:3000, for a storefront to load
```
$ npm run serve
```
#### Unit tests and lint
```
$ npx jest
$ npm run lint
```

A storefront loads the bundle from that URL and constructs the enabler:

```js
const { Enabler } = await import('http://localhost:3000/connector-enabler.es.js');
const enabler = new Enabler({ processorUrl, sessionId, onComplete, onError });
const builder = await enabler.createComponentBuilder('card');
await builder.build({}).mount('#payment');
```

## Storefront embedding — Content-Security-Policy & PCI (integration requirement)

The enabler loads the **Unzer UI Components v2** SDK at runtime from Unzer's CDN,
`https://static-v2.unzer.com/v2/ui-components/index.js` (`UNZER_SDK_URL` in
`src/components/unzer/sdk.ts`), and renders the card fields inside Unzer's own `<unzer-*>`
custom-element iframes on the checkout page. Two consequences the embedding **storefront** must
satisfy:

- **Content-Security-Policy (required).** The SDK URL is **versionless**, so Subresource Integrity
  (an `integrity="sha384-…"` hash pin) is impossible — the file behind the URL changes without the
  URL changing. The storefront that embeds the enabler on a card-data page **MUST** therefore set a
  Content-Security-Policy that allows the Unzer origins instead:
  - `script-src https://static-v2.unzer.com` — to load the UI SDK;
  - `frame-src` / `child-src` for the card iframe origins Unzer serves its fields from (and
    `connect-src` for the SDK's own API calls), per Unzer's current UI-Components integration
    documentation.

  Without this CSP the SDK is blocked and no payment fields render.
- **PCI scope (SAQ-A).** Card entry stays **inside Unzer's own iframe** — the PAN is tokenized in
  the Unzer element and never touches the enabler, the storefront DOM, or the processor. The
  connector posts only the resulting single-use resource id to `POST /payments`. Keeping card entry
  in Unzer's iframe is what keeps the merchant in **PCI SAQ-A** scope; a storefront must not attempt
  to read, wrap, or reimplement the card fields.

## Unsupported market — no payment methods rendered

The enabler renders whatever the processor's shopper config (`GET /operations/payment-config`)
returns for the session cart. The processor resolves the store from the cart and filters the
store's enabled payment methods by the cart's country + currency. When no enabled method matches
that market, `payment-config` returns **no enabled payment methods** (an empty list, not an error).
The enabler therefore renders **no payment methods** and surfaces no error; the shopper simply sees
nothing to pay with. (Attempting to create a payment for such a cart is refused by the processor
with `400`.)