import type { AppConfig } from './types';
import { getBrand } from './brand';
import { ctpEndpointsFromRegion } from './ctp-region';

/** The hard bound on one vendor call: a capture or refund on a blackholed socket must end so the release decision can run. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** The application config. Local-dev fallbacks only; every deployment supplies the values, and `main.ts` refuses to boot without them. */
export const config: AppConfig = {
  projectKey: process.env.CTP_PROJECT_KEY || 'payment-integration',
  clientId: process.env.CTP_CLIENT_ID || 'xxx',
  clientSecret: process.env.CTP_CLIENT_SECRET || 'xxx',
  ...ctpEndpointsFromRegion(process.env.CTP_REGION),
  healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000'),
  requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  loggerLevel: process.env.LOGGER_LEVEL || 'info',
  get configManagePermission(): string {
    return getBrand().managePermission;
  },
  allowedReturnOrigins: (process.env.PSP_ALLOWED_RETURN_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  returnFailureUrl: process.env.PSP_RETURN_FAILURE_URL,
};

export const getConfig = () => {
  return config;
};
