/**
 * Full-screen integration test for the Unzer configuration Custom Application. Unlike the focused
 * `config-app.spec.tsx` (which mocks the hooks), this drives the REAL data path: `renderApplicationWith
 * RoutesAndRedux` mounts the app inside the MC ApplicationShell, and both `useStores` and
 * `useProcessorClient` run their actual `executeHttpClientRequest` → `/proxy/forward-to` fetch. The
 * processor gateway is stubbed with msw so nothing touches the network.
 *
 * The tests assert the AC-mapped behaviors end to end: the screen loads the Connection tab (AC1), the
 * credential round-trip on save (AC3 - the stored pair reads back in the clear and re-sends unchanged),
 * the server-validating PUT failure surface (AC1/AC3), and the Payment-methods tab appearing once
 * connected and listing the methods from the processor (AC4).
 *
 * The store-key assertion matches by header-name suffix (`endsWith('x-store-key')`): `request.ts` names
 * the header `x-store-key`, the application-shell forward-to plumbing prefixes it, and the MC gateway
 * strips that prefix so the processor receives `X-Store-Key`.
 */

import { rest } from 'msw';
import { setupServer } from 'msw/node';
import {
  fireEvent,
  screen,
  waitFor,
  within,
  mapResourceAccessToAppliedPermissions,
  type TRenderAppWithReduxOptions,
} from '@commercetools-frontend/application-shell/test-utils';
import { PERMISSIONS } from '../../../src/constants';
import { renderApplicationWithRoutesAndRedux } from '../../support/render-app';
import type {
  PaymentMethodsDto,
  StoreConfigDto,
} from '../../../src/types/config';

const PROCESSOR = 'https://processor.example.test';
const FORWARD_TO_PATH = /\/proxy\/forward-to$/;

const STORE_KEY = 'main-store';

/** A connected sandbox environment, credentials in the clear - how `GET` returns them. */
const storedConfig = (): StoreConfigDto => ({
  mode: 'sandbox',
  environments: {
    sandbox: {
      credentials: { publicKey: 's-pub-stored', privateKey: 's-priv-stored' },
    },
    live: {},
  },
});

/** A store that has never been connected: the active sandbox environment holds no credentials. */
const disconnectedConfig = (): StoreConfigDto => ({
  mode: 'sandbox',
  environments: { sandbox: {}, live: {} },
});

const PAYMENT_METHODS: PaymentMethodsDto = {
  paymentMethods: [
    {
      paymentMethodCode: 'card',
      enabled: true,
      name: { en: 'Renamed for checkout' },
      description: {},
      surcharge: {},
      countries: [],
      sendBasketData: false,
    },
    {
      paymentMethodCode: 'paypal',
      enabled: false,
      name: { en: 'PayPal' },
      description: {},
      surcharge: {},
      countries: [],
      sendBasketData: false,
    },
  ],
};

let capturedPutBody: StoreConfigDto | undefined;
let capturedMethodsPutBody: PaymentMethodsDto | undefined;
/** Flipped by the DELETE handler so a disconnect is visible to the next store-config GET. */
let disconnected: boolean;
let capturedGetHeaders: Record<string, string>;
let paymentMethodsGetCount: number;

const forwardTarget = (req: {
  headers: { get(name: string): string | null };
}) => req.headers.get('x-forward-to') ?? '';

/**
 * The processor's PUT response: the saved config echoed back. Credentials are NOT masked, so
 * the echo carries exactly what was persisted - which is what makes the saved pair readable on reload.
 */
const savedEcho = (body: StoreConfigDto): StoreConfigDto => ({
  ...body,
  environments: {
    sandbox: body.environments?.sandbox,
    live: body.environments?.live,
  },
});

const STORES = [
  { key: STORE_KEY, name: 'Main Store' },
  { key: 'eu-store', name: 'EU Store' },
];

type ForwardOverrides = {
  putConfig?: { status: number; message: string };
  getConfig?: StoreConfigDto;
};

const forwardHandlers = (overrides: ForwardOverrides = {}) => [
  rest.get(FORWARD_TO_PATH, async (req, res, ctx) => {
    const target = forwardTarget(req);
    if (target.includes('payment-methods')) {
      paymentMethodsGetCount += 1;
      return res(ctx.json(PAYMENT_METHODS));
    }
    if (target.includes('store-config')) {
      capturedGetHeaders = {};
      req.headers.forEach((value, name) => {
        capturedGetHeaders[name] = value;
      });
      if (disconnected) {
        return res(ctx.json(disconnectedConfig()));
      }
      return res(ctx.json(overrides.getConfig ?? storedConfig()));
    }
    if (target.endsWith('/store-reference-data')) {
      return res(
        ctx.json({
          languages: ['en', 'fr'],
          currencies: ['EUR'],
          countries: ['FR'],
        })
      );
    }
    if (target.endsWith('/stores')) {
      return res(ctx.json(STORES));
    }
    return res(
      ctx.status(500),
      ctx.json({ message: `unexpected GET ${target}` })
    );
  }),
  rest.put(FORWARD_TO_PATH, async (req, res, ctx) => {
    const target = forwardTarget(req);
    if (target.includes('payment-methods')) {
      capturedMethodsPutBody = (await req.json()) as PaymentMethodsDto;
      return res(ctx.json(capturedMethodsPutBody));
    }
    if (target.includes('store-config')) {
      capturedPutBody = (await req.json()) as StoreConfigDto;
      disconnected = false;
      if (overrides.putConfig) {
        return res(
          ctx.status(overrides.putConfig.status),
          ctx.json({ message: overrides.putConfig.message })
        );
      }
      return res(ctx.json(savedEcho(capturedPutBody)));
    }
    return res(
      ctx.status(500),
      ctx.json({ message: `unexpected PUT ${target}` })
    );
  }),
  rest.delete(FORWARD_TO_PATH, async (req, res, ctx) => {
    const target = forwardTarget(req);
    if (target.includes('store-config')) {
      disconnected = true;
      return res(ctx.status(200));
    }
    return res(
      ctx.status(500),
      ctx.json({ message: `unexpected DELETE ${target}` })
    );
  }),
];

const mockServer = setupServer();

beforeAll(() =>
  mockServer.listen({
    onUnhandledRequest: (req, print) => {
      const path = req.url.pathname;
      if (path.endsWith('/proxy/forward-to')) {
        print.error();
      }
    },
  })
);
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

beforeEach(() => {
  capturedPutBody = undefined;
  capturedMethodsPutBody = undefined;
  disconnected = false;
  capturedGetHeaders = {};
  paymentMethodsGetCount = 0;
});

const renderApp = (
  overrides: ForwardOverrides = {},
  appliedPermissions = mapResourceAccessToAppliedPermissions([
    PERMISSIONS.View,
  ]),
  options: Partial<TRenderAppWithReduxOptions> = {}
) => {
  mockServer.use(...forwardHandlers(overrides));
  return renderApplicationWithRoutesAndRedux({
    environment: { processorUrl: PROCESSOR },
    project: { allAppliedPermissions: appliedPermissions },
    ...options,
  } as Partial<TRenderAppWithReduxOptions>);
};

describe('ConfigApp (integration)', () => {
  it('loads the store selector and, once the config GET resolves, the Connection tab renders', async () => {
    renderApp();

    expect(
      await screen.findByRole('combobox', { name: 'Store' })
    ).toBeInTheDocument();

    expect(
      await screen.findByRole('button', { name: 'Save changes' })
    ).toBeInTheDocument();
    // The Connection tab is on screen: the environment card + the Public key field.
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByLabelText(/Public key/)).toBeInTheDocument();

    // AC3 (read half): the store key rides the forward-to GET.
    const storeKeyEntry = Object.entries(capturedGetHeaders).find(([name]) =>
      name.endsWith('x-store-key')
    );
    expect(storeKeyEntry?.[1]).toBe(STORE_KEY);
  });

  it('AC3: the stored keys are readable in their fields, and an untouched form has nothing to save', async () => {
    renderApp();

    // The point of returning them in the clear: the operator can SEE which pair the store holds, so a
    // wrong key can be spotted instead of only blindly overwritten.
    expect(await screen.findByLabelText(/Public key/)).toHaveValue(
      's-pub-stored'
    );
    expect(screen.getByLabelText(/Private key/)).toHaveValue('s-priv-stored');

    // And nothing to save yet: the form matches what the processor holds, so the primary action stays
    // disabled rather than firing a PUT that would change nothing.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('AC3: an edited private key sends the new value while the public key rides along unchanged', async () => {
    renderApp();

    fireEvent.change(await screen.findByLabelText(/Private key/), {
      target: { value: 's-priv-new' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Reconnect',
      })
    );

    await waitFor(() => expect(capturedPutBody).toBeDefined());
    const credentials =
      capturedPutBody?.environments?.sandbox?.credentials ?? {};
    expect(credentials.privateKey).toBe('s-priv-new');
    expect(credentials.publicKey).toBe('s-pub-stored');
  });

  it('AC1: a rejected PUT reads as the generic message, never the vendor’s own words', async () => {
    // The processor relays Unzer's wording on a credential rejection - an HTTP status plus a
    // partially-masked key. None of it may reach the operator: it is untranslatable, echoes part of a
    // credential, and names no remedy. The screen answers with its own translated message instead.
    renderApp({
      putConfig: {
        status: 400,
        message:
          'Connection validation failed: PSP API error (401): The given key s-p****fds is unknown or invalid.',
      },
    });

    // An edit first: the save action only opens once the form differs from what is persisted, and a
    // connected environment then asks before reconnecting to a different account.
    fireEvent.change(await screen.findByLabelText(/Public key/), {
      target: { value: 's-pub-edited' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Reconnect',
      })
    );

    expect(
      await screen.findByText(/Could not connect to Unzer/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/401/)).not.toBeInTheDocument();
    expect(screen.queryByText(/s-p\*\*\*\*fds/)).not.toBeInTheDocument();
  });

  it('AC4: the Payment-methods tab appears once connected and lists the methods', async () => {
    renderApp();

    fireEvent.click(
      await screen.findByRole('link', { name: 'Payment methods' })
    );

    expect(
      await screen.findByText('Cards and Click to Pay')
    ).toBeInTheDocument();
    expect(screen.getByText('PayPal')).toBeInTheDocument();
  });

  // There is no tab-level save: the settings modal persists what it edited, and switching a method off
  // persists on the click. Both are the whole list, PUT for the selected environment.
  it('persists from the settings modal, carrying the per-currency amounts', async () => {
    renderApp();

    fireEvent.click(
      await screen.findByRole('link', { name: 'Payment methods' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.change(await screen.findByLabelText('Min order amount'), {
      target: { value: '7.50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(capturedMethodsPutBody).toBeDefined());
    expect(capturedMethodsPutBody?.paymentMethods[0]).toEqual(
      expect.objectContaining({
        paymentMethodCode: 'card',
        minAmount: { EUR: 750 },
      })
    );
  });

  it('persists a disable straight from the list', async () => {
    renderApp();

    fireEvent.click(
      await screen.findByRole('link', { name: 'Payment methods' })
    );
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: 'Enable Cards and Click to Pay',
      })
    );

    await waitFor(() => expect(capturedMethodsPutBody).toBeDefined());
    expect(capturedMethodsPutBody?.paymentMethods[0]).toEqual(
      expect.objectContaining({ paymentMethodCode: 'card', enabled: false })
    );
  });

  // A RECONNECT with different keys is a rotation: the processor clears that environment's method
  // configuration, so the tab must not go on showing the previous account's config.
  it('refreshes the method list after a reconnect with new keys', async () => {
    renderApp();

    fireEvent.click(
      await screen.findByRole('link', { name: 'Payment methods' })
    );
    expect(
      await screen.findByText('Cards and Click to Pay')
    ).toBeInTheDocument();
    expect(paymentMethodsGetCount).toBe(1);

    // Rotate the private key of the already-connected environment; the form warns first.
    fireEvent.click(screen.getByRole('link', { name: 'Connection' }));
    fireEvent.change(await screen.findByLabelText(/Private key/), {
      target: { value: 's-priv-rotated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Reconnect',
      })
    );

    // Straight away, without the operator having to reload: the stale list is gone and refetched.
    await waitFor(() => expect(paymentMethodsGetCount).toBe(2));
  });

  // The processor DELETES that environment's method configuration on disconnect, and this app
  // caches for the whole session - so the cached list has to go with it, or a re-connect would show (and
  // then re-persist) methods that no longer exist.
  it('drops the cached method list on disconnect, so a re-connect fetches it again', async () => {
    renderApp();

    fireEvent.click(
      await screen.findByRole('link', { name: 'Payment methods' })
    );
    expect(
      await screen.findByText('Cards and Click to Pay')
    ).toBeInTheDocument();
    expect(paymentMethodsGetCount).toBe(1);

    fireEvent.click(screen.getByRole('link', { name: 'Connection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Disconnect',
      })
    );

    // Wait for the disconnected view BEFORE typing: the disconnect re-seeds the form from the config it
    // re-reads, which would otherwise clobber the keys typed into it.
    expect(
      await screen.findByRole('button', { name: 'Connect' })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Public key/), {
      target: { value: 's-pub-new' },
    });
    fireEvent.change(screen.getByLabelText(/Private key/), {
      target: { value: 's-priv-new' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(paymentMethodsGetCount).toBe(2));
  });

  it('a store that loads disconnected fires no payment-methods call until it is connected', async () => {
    renderApp({ getConfig: disconnectedConfig() });

    // The Connection tab renders with the first-connect primary action; no Payment-methods tab yet.
    expect(
      await screen.findByRole('button', { name: 'Connect' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Payment methods' })
    ).not.toBeInTheDocument();
    // T-Code2: an unconnected store makes no live keypair (payment-methods) call.
    expect(paymentMethodsGetCount).toBe(0);
  });

  it('the connected view survives the first connect and does not revert to disconnected', async () => {
    renderApp({ getConfig: disconnectedConfig() });

    fireEvent.change(await screen.findByLabelText(/Public key/), {
      target: { value: 's-pub-new' },
    });
    fireEvent.change(await screen.findByLabelText(/Private key/), {
      target: { value: 's-priv-new' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    // The just-saved connection persists: the Payment-methods tab appears and the credentials read as
    // configured (masked). The bug this guards reverted the whole body to the disconnected view here.
    expect(
      await screen.findByRole('link', { name: 'Payment methods' })
    ).toBeInTheDocument();
    // The connect landed on the Payment-methods tab with the catalogue listed.
    expect(
      screen.getByRole('checkbox', { name: 'Enable Cards and Click to Pay' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect' })
    ).not.toBeInTheDocument();
    // Exactly one payment-methods call — fired only once the store became connected.
    await waitFor(() => expect(paymentMethodsGetCount).toBe(1));
  });

  it('permission path: the screen renders for a user with the app’s view permission', async () => {
    renderApp({}, mapResourceAccessToAppliedPermissions([PERMISSIONS.View]));

    expect(
      await screen.findByRole('combobox', { name: 'Store' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Save changes' })
    ).toBeInTheDocument();
  });
});
