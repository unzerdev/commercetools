/** The commercetools scopes the connector's API client needs; the status endpoint probes every one. */
export const REQUIRED_CT_SCOPES: readonly string[] = [
  'manage_payments',
  'manage_orders',
  'view_sessions',
  'manage_checkout_payment_intents',
  'introspect_oauth_tokens',
  'manage_types',
  'view_types',
  'manage_states',
  'view_stores',
  'view_project_settings',
  'manage_key_value_documents',
  'view_customers',
];
