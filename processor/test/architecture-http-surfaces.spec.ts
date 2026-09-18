/**
 * The HTTP layer is grouped by CONSUMING APPLICATION: `routes/mc`, `routes/mc-view`,
 * `routes/checkout`, `routes/enabler`, `routes/vendor`, `routes/public`. A folder name is only worth
 * something if it cannot lie, so this spec asserts that every route file uses the auth policy its
 * folder promises - a route dropped into the wrong group fails the build rather than the audit.
 *
 * It reads source text (like `contracts-payment-provider.spec.ts`) because the guard chain is what a
 * reader must be able to trust at a glance; running the routes would prove the same thing only for the
 * requests a test happens to send.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';

const ROUTES = path.join(process.cwd(), 'src/infrastructure/http/routes');

/** Every `.ts` file directly under one consumer group. */
const groupFiles = (group: string): { name: string; source: string }[] => {
  const dir = path.join(ROUTES, group);
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ name: `${group}/${file}`, source: fs.readFileSync(path.join(dir, file), 'utf8') }));
};

/** A route file declares at least one route; a group with none would pass every rule vacuously. */
const declaresRoutes = (source: string): boolean => /fastify\.(get|post|put|delete)/.test(source);

const JWT = 'jwtGuards';
const MANAGE = 'requireManagePermission';
const SESSION = 'sessionHeaderAuthHook';
const OAUTH2 = 'oauth2AuthHook';

describe('http routes are grouped by consuming application', () => {
  it.each(['mc', 'mc-view'])(
    '%s: every route runs the JWT + audience guards AND the manage-permission gate',
    (group) => {
      const files = groupFiles(group);
      expect(files.length).toBeGreaterThan(0);

      for (const { name, source } of files) {
        expect(declaresRoutes(source)).toBe(true);
        // The audience gate rides inside `jwtGuards`: an MC token minted for ANOTHER Custom Application
        // in the same project authenticates fine, so `jwtAuthHook` alone is not enough.
        expect({ file: name, hasJwtGuards: source.includes(JWT) }).toEqual({ file: name, hasJwtGuards: true });
        expect({ file: name, hasManageGate: source.includes(MANAGE) }).toEqual({ file: name, hasManageGate: true });
        expect({ file: name, hasSession: source.includes(SESSION) }).toEqual({ file: name, hasSession: false });
        expect({ file: name, hasOauth2: source.includes(OAUTH2) }).toEqual({ file: name, hasOauth2: false });
      }
    },
  );

  it('checkout: OAuth2 + scope authorization, never the Merchant Center JWT', () => {
    const files = groupFiles('checkout');
    expect(files.length).toBeGreaterThan(0);

    for (const { name, source } of files) {
      expect(declaresRoutes(source)).toBe(true);
      expect({ file: name, hasOauth2: source.includes(OAUTH2) }).toEqual({ file: name, hasOauth2: true });
      expect({ file: name, authorizes: source.includes('authorizationHook.authorize') }).toEqual({
        file: name,
        authorizes: true,
      });
      expect({ file: name, hasJwt: source.includes(JWT) || source.includes('jwtAuthHook') }).toEqual({
        file: name,
        hasJwt: false,
      });
    }
  });

  it('enabler: the shopper session hook, never a merchant or Checkout credential', () => {
    const files = groupFiles('enabler');
    expect(files.length).toBeGreaterThan(0);

    for (const { name, source } of files) {
      expect(declaresRoutes(source)).toBe(true);
      expect({ file: name, hasSession: source.includes(SESSION) }).toEqual({ file: name, hasSession: true });
      expect({ file: name, hasJwt: source.includes(JWT) || source.includes('jwtAuthHook') }).toEqual({
        file: name,
        hasJwt: false,
      });
      expect({ file: name, hasOauth2: source.includes(OAUTH2) }).toEqual({ file: name, hasOauth2: false });
    }
  });

  it.each(['vendor', 'public'])('%s: no auth hook at all - authenticity is HMAC / content-addressing', (group) => {
    const files = groupFiles(group);
    expect(files.length).toBeGreaterThan(0);

    for (const { name, source } of files) {
      expect(declaresRoutes(source)).toBe(true);
      for (const hook of [JWT, 'jwtAuthHook', SESSION, OAUTH2]) {
        expect({ file: name, hook, present: source.includes(hook) }).toEqual({ file: name, hook, present: false });
      }
    }
  });

  it('the composer registers every group, so a new folder cannot be forgotten', () => {
    const composer = fs.readFileSync(path.join(ROUTES, 'operation.route.ts'), 'utf8');

    // Only the `/operations/*` groups are composed here; `enabler/payment`, `vendor` and `public` mount
    // at the root through their own plugins.
    for (const registered of [
      'enablerConfigRoutes',
      'mcStoreConfigRoutes',
      'mcPaymentMethodsRoutes',
      'mcStoreDataRoutes',
      'mcDiagnosticsRoutes',
      'mcViewOrderPaymentsRoutes',
      'checkoutRoutes',
    ]) {
      expect({ registered, composed: composer.includes(`fastify.register(${registered}`) }).toEqual({
        registered,
        composed: true,
      });
    }
  });
});
