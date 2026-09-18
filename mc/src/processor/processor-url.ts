/**
 * Where the processor lives: the `PROCESSOR_URL` the deployment was given. On Connect the processor's
 * URL is assigned at deploy time, so it is copied into this application and deployed a second time.
 */

import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';

/** The custom env value injected via `additionalEnv.processorUrl` in `custom-application-config.mjs`. */
type ProcessorEnvironment = { processorUrl: string };

export type ProcessorUrlResult = {
  /** The base URL, or `undefined` when the deployment carries none yet. */
  url?: string;
  loading: boolean;
  error?: Error;
};

export const useProcessorUrl = (): ProcessorUrlResult => {
  const configured = useApplicationContext<string, ProcessorEnvironment>(
    (context) => context.environment.processorUrl
  );
  const url = (configured ?? '').trim();
  return url !== '' ? { url, loading: false } : { loading: false };
};
