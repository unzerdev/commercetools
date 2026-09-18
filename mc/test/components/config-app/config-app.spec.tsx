/**
 * Focused screen test: with `useStores` and `useProcessorClient` mocked, the screen renders the store
 * selector and the Connection tab, and the Save action forwards a `formToConfig`-shaped payload to
 * `putStoreConfig`. The toast hook is mocked so no Redux store is needed.
 */

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import type { ProcessorClient } from '../../../src/processor';
import type {
  PaymentMethodsDto,
  StoreConfigDto,
} from '../../../src/types/config';
import { useStores } from '../../../src/hooks/use-stores';
import { useProcessorClient } from '../../../src/processor';
import ConfigApp from '../../../src/components/config-app/config-app';
import { createQueryHarness } from '../../support/render-with-query-client';

jest.mock('../../../src/hooks/use-stores', () => ({ useStores: jest.fn() }));
jest.mock('../../../src/processor', () => ({
  useProcessorClient: jest.fn(),
}));
const mockShowNotification = jest.fn();
jest.mock('@commercetools-frontend/actions-global', () => ({
  useShowNotification: () => mockShowNotification,
}));

const useStoresMock = useStores as jest.MockedFunction<typeof useStores>;
const useProcessorClientMock = useProcessorClient as jest.MockedFunction<
  typeof useProcessorClient
>;

// A connected sandbox environment, credentials in the clear — how GET returns them.
const STORED_CONFIG: StoreConfigDto = {
  mode: 'sandbox',
  environments: {
    sandbox: {
      credentials: { publicKey: 's-pub-stored', privateKey: 's-priv-stored' },
    },
  },
};

const NO_METHODS: PaymentMethodsDto = { paymentMethods: [] };

const makeClient = (): jest.Mocked<ProcessorClient> => ({
  getStoreConfig: jest
    .fn<Promise<StoreConfigDto>, []>()
    .mockResolvedValue(STORED_CONFIG),
  putStoreConfig: jest
    .fn<Promise<StoreConfigDto>, [StoreConfigDto]>()
    .mockResolvedValue(STORED_CONFIG),
  deleteConnection: jest.fn().mockResolvedValue(undefined),
  getPaymentMethods: jest.fn().mockResolvedValue(NO_METHODS),
  putPaymentMethods: jest.fn().mockResolvedValue(NO_METHODS),
  getStoreReferenceData: jest.fn().mockResolvedValue({
    languages: ['en', 'fr'],
    currencies: ['EUR'],
    countries: ['FR'],
  }),
  getStores: jest.fn().mockResolvedValue([]),
});

const renderApp = () => {
  const { Wrapper } = createQueryHarness();
  return render(
    <Wrapper>
      <IntlProvider locale="en" messages={{}}>
        <MemoryRouter>
          <ConfigApp />
        </MemoryRouter>
      </IntlProvider>
    </Wrapper>
  );
};

describe('ConfigApp', () => {
  beforeEach(() => {
    mockShowNotification.mockClear();
    useStoresMock.mockReturnValue({
      stores: [{ key: 'main-store', name: 'Main Store' }],
      loading: false,
    });
    useProcessorClientMock.mockReturnValue(makeClient());
  });

  // The processor returns the DEFAULT SCOPE first — the configuration a store follows when it
  // was never connected on its own. The app labels it itself and opens on it.
  it('offers the default scope first in the selector and preselects it', async () => {
    useStoresMock.mockReturnValue({
      stores: [
        { key: '__default__', name: 'Default', isDefault: true },
        { key: 'main-store', name: 'Main Store' },
      ],
      loading: false,
    });
    renderApp();

    const selector = screen.getByRole('combobox', {
      name: 'Store',
    }) as HTMLSelectElement;
    const options = within(selector).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'Default (all stores)',
      'Main Store',
    ]);
    expect(selector.value).toBe('__default__');
    // And the screen loads that scope's config, not a store's.
    expect(useProcessorClientMock).toHaveBeenCalledWith('__default__');
  });

  it('renders the store selector and the Connection tab once the config loads', async () => {
    renderApp();

    expect(screen.getByRole('combobox', { name: 'Store' })).toBeInTheDocument();

    // The Connection tab mounts once the store config resolves.
    expect(
      await screen.findByRole('button', { name: 'Save changes' })
    ).toBeInTheDocument();
    // The Connection tab is on screen: the environment card + the Public key field.
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByLabelText(/Public key/)).toBeInTheDocument();
  });

  it('sends a formToConfig payload to putStoreConfig on save', async () => {
    const client = makeClient();
    useProcessorClientMock.mockReturnValue(client);
    renderApp();

    // Save is disabled until something changes, so the operator edits one key; the OTHER must ride
    // along verbatim — the payload is the whole config, not a patch of what was touched.
    fireEvent.change(await screen.findByLabelText(/Public key/), {
      target: { value: 's-pub-edited' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    // Editing a key of a connected environment asks first — it reconnects to a different account.
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Reconnect',
      })
    );

    await waitFor(() => expect(client.putStoreConfig).toHaveBeenCalledTimes(1));
    const payload = client.putStoreConfig.mock.calls[0][0];
    expect(payload).toMatchObject({
      mode: 'sandbox',
      environments: expect.any(Object),
    });
    expect(payload.environments?.sandbox?.credentials?.publicKey).toBe(
      's-pub-edited'
    );
    expect(payload.environments?.sandbox?.credentials?.privateKey).toBe(
      's-priv-stored'
    );
  });

  it('shows a warning when the project has no keyed stores', () => {
    useStoresMock.mockReturnValue({ stores: [], loading: false });
    renderApp();

    expect(screen.getByText(/has no stores with a key/i)).toBeInTheDocument();
  });

  it('shows the Payment methods tab only once the store is connected', async () => {
    renderApp();

    // The connected sandbox environment exposes the Payment methods tab.
    expect(
      await screen.findByRole('link', { name: 'Payment methods' })
    ).toBeInTheDocument();
  });

  it('hides the Payment methods tab when no environment is connected', async () => {
    const client = makeClient();
    client.getStoreConfig.mockResolvedValue({ mode: 'sandbox' });
    useProcessorClientMock.mockReturnValue(client);
    renderApp();

    // Not connected: the primary action reads "Connect", and no Payment-methods tab is exposed.
    await screen.findByRole('button', { name: 'Connect' });
    expect(
      screen.queryByRole('link', { name: 'Payment methods' })
    ).not.toBeInTheDocument();
  });

  it('hides the Payment methods tab when the SELECTED environment is not connected, even if the active one is', async () => {
    // Persisted: sandbox is active AND connected; live is not connected. The tab tracks the selected
    // environment, so switching the radio to the unconnected live must hide the tab.
    renderApp();
    expect(
      await screen.findByRole('link', { name: 'Payment methods' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Live' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Payment methods' })
      ).not.toBeInTheDocument()
    );
  });

  it('shows the Payment methods tab when switching to a connected environment that is not the active one', async () => {
    // Persisted: sandbox is the active mode but is NOT connected; live IS connected. Selecting live
    // must expose the tab even though the persisted active mode differs.
    const client = makeClient();
    client.getStoreConfig.mockResolvedValue({
      mode: 'sandbox',
      environments: {
        live: { credentials: { publicKey: 'p-pub-1', privateKey: 'p-priv-1' } },
      },
    });
    useProcessorClientMock.mockReturnValue(client);
    renderApp();

    // Sandbox selected + not connected → no tab yet.
    await screen.findByRole('button', { name: 'Connect' });
    expect(
      screen.queryByRole('link', { name: 'Payment methods' })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Live' }));

    expect(
      await screen.findByRole('link', { name: 'Payment methods' })
    ).toBeInTheDocument();
  });

  it('fetches the payment-methods catalogue for the SELECTED environment (per-env)', async () => {
    // Both environments connected; sandbox is the active mode. The catalogue is read from the selected
    // environment's keypair, so switching the radio refetches for that environment.
    const client = makeClient();
    client.getStoreConfig.mockResolvedValue({
      mode: 'sandbox',
      environments: {
        sandbox: {
          credentials: { publicKey: 's-pub-1', privateKey: 's-priv-1' },
        },
        live: { credentials: { publicKey: 'p-pub-1', privateKey: 'p-priv-1' } },
      },
    });
    useProcessorClientMock.mockReturnValue(client);
    renderApp();

    // On load the active (sandbox) environment's catalogue is fetched.
    await waitFor(() =>
      expect(client.getPaymentMethods).toHaveBeenCalledWith('sandbox')
    );

    // Switching to the connected live environment refetches its catalogue.
    fireEvent.click(screen.getByRole('radio', { name: 'Live' }));
    await waitFor(() =>
      expect(client.getPaymentMethods).toHaveBeenCalledWith('live')
    );
  });
});
