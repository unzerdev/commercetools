/**
 * Where the processor lives: the `PROCESSOR_URL` the deployment was given. On Connect the processor's
 * URL is assigned at deploy time, so it is copied into this view and deployed a second time.
 */

import { useCustomViewContext } from '@commercetools-frontend/application-shell-connectors';

/** The custom env value injected via `additionalEnv.processorUrl` in `custom-view-config.mjs`. */
type ProcessorEnvironment = { processorUrl: string };

export type ProcessorUrlResult = {
  /** The base URL, or `undefined` when the deployment carries none yet. */
  url?: string;
  loading: boolean;
  error?: Error;
};

export const useProcessorUrl = (): ProcessorUrlResult => {
  // The context types `environment` with the platform's own keys; `additionalEnv` values are merged
  // in at runtime, so the selector widens it to the env this view declares.
  const configured = useCustomViewContext(
    (context) =>
      (context.environment as typeof context.environment & ProcessorEnvironment)
        .processorUrl
  );
  const url = (configured ?? '').trim();
  return url !== '' ? { url, loading: false } : { loading: false };
};
