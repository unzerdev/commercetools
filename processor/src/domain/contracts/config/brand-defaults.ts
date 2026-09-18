/** The brand-varying values a provider ships in its `brand.defaults.json`; there is no env override. */
export interface BrandDefaults {
  displayName: string;
  /** The `paymentMethodInfo.paymentInterface` stamped on payments. */
  paymentInterface: string;
  telemetryHeaderName: string;
  integrator: string;
  shoppingCartExtension: string;
  /** Custom Object container for per-store connection config. */
  customObjectContainer: string;
  /** Custom Object container for per-store payment-methods config. */
  paymentMethodsContainer: string;
  /** Custom Object container for webhook idempotency markers. */
  webhookMarkerContainer: string;
  /** The custom type key registered on Payments. */
  paymentTypeKey: string;
  defaultHost: string;
  defaultHostLive: string;
  /** The Merchant Center permission derived from the config app's entry point: `canManage<TitleCase(entryPoint)>`. */
  managePermission: string;
  /** The vendor back office per environment; absent when the distribution has none. */
  backOffice?: { test: string; live: string };
}
