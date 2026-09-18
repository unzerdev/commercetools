/**
 * Every processor failure the connection screen shows an operator has to read in the OPERATOR's
 * language — with NO English `Error.message` slipping through. Three failure shapes are worth pinning,
 * and they do not resolve the same way:
 *
 * - a gateway body that names no reason, and a request that produced no response at all: the processor
 *   cannot word these, so the app words them — and the wording distinguishes them, because "cannot be
 *   reached" and "your keys are wrong" call for different actions.
 * - a rejection the processor DID word: for the credential-validating PUT that text is the VENDOR's
 *   (an HTTP status plus a partially-masked key), so it is replaced by the app's generic message. It is
 *   untranslatable, echoes part of a credential, and names no remedy.
 *
 * So this drives the REAL data path: the real `useProcessorClient`, the real query hooks, the real
 * connection section, with only the MC gateway transport stubbed — and it renders through the GERMAN
 * catalogue the app ships. A hardcoded English string cannot pass here. The outcome reaches the
 * operator as a SIDE NOTIFICATION (the same channel as success), so that is what these assert on.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import {
  buildApiUrl,
  executeHttpClientRequest,
} from '@commercetools-frontend/application-shell';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import ConfigApp from '../../../src/components/config-app/config-app';
import deCatalogue from '../../../src/i18n/data/de.json';
import type { StoreConfigDto } from '../../../src/types/config';
import { createQueryHarness } from '../../support/render-with-query-client';

jest.mock('@commercetools-frontend/application-shell', () => ({
  buildApiUrl: jest.fn((endpoint: string) => `https://mc-api.test${endpoint}`),
  executeHttpClientRequest: jest.fn(),
}));
jest.mock('@commercetools-frontend/application-shell-connectors', () => ({
  useApplicationContext: jest.fn(),
}));

const mockShowNotification = jest.fn();
jest.mock('@commercetools-frontend/actions-global', () => ({
  useShowNotification: () => mockShowNotification,
}));

const executeMock = executeHttpClientRequest as jest.MockedFunction<
  typeof executeHttpClientRequest
>;
const useApplicationContextMock = useApplicationContext as jest.MockedFunction<
  typeof useApplicationContext
>;

const PROCESSOR = 'https://processor.example.test';

/** The German text of an id, read from the catalogue the app actually ships. */
const de = (id: string): string => (deCatalogue as Record<string, string>)[id];

/** A connected sandbox environment: the connection card's Save action is what we exercise. */
const STORED_CONFIG: StoreConfigDto = {
  mode: 'sandbox',
  environments: {
    sandbox: {
      credentials: { publicKey: 's-pub-stored', privateKey: 's-priv-stored' },
    },
  },
};

const STORES = [{ key: 'main-store', name: 'Main Store' }];
const REFERENCE_DATA = {
  languages: ['en', 'de'],
  currencies: ['EUR'],
  countries: ['DE'],
};

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  text: async () => JSON.stringify(body),
  headers: { get: () => null },
});

/** What a failing MC gateway actually returns: an HTML body that names no reason at all. */
const gatewayFailureResponse = (status = 502) => ({
  ok: false,
  status,
  text: async () => '<html>Bad Gateway</html>',
  headers: { get: () => null },
});

type GatewayResponse = ReturnType<typeof jsonResponse>;

const stubGateway = (putConfig: GatewayResponse | Error) => {
  const fetchMock = jest.fn(async (_url: string, init: RequestInit) => {
    const target = (init.headers as Record<string, string>)['x-forward-to'];
    if (init.method === 'PUT') {
      if (putConfig instanceof Error) {
        throw putConfig;
      }
      return putConfig;
    }
    if (target.endsWith('/stores')) return jsonResponse(STORES);
    if (target.endsWith('/store-reference-data'))
      return jsonResponse(REFERENCE_DATA);
    if (target.includes('payment-methods'))
      return jsonResponse({ paymentMethods: [] });
    if (target.includes('store-config')) return jsonResponse(STORED_CONFIG);
    return jsonResponse({ message: `unexpected target ${target}` }, false, 500);
  });
  global.fetch = fetchMock as never;
  return fetchMock;
};

const renderConfigApp = () => {
  const { Wrapper } = createQueryHarness();
  return render(
    <Wrapper>
      <IntlProvider locale="de" messages={deCatalogue}>
        <MemoryRouter>
          <ConfigApp />
        </MemoryRouter>
      </IntlProvider>
    </Wrapper>
  );
};

/**
 * Edit a key, then submit the connection card's Save action. The edit is not incidental: Save is
 * disabled while the form still matches what is persisted, so a save is only reachable after a change.
 */
const saveConnection = async () => {
  fireEvent.change(
    await screen.findByLabelText(
      new RegExp(de('ConfigApp.Connection.publicKeyLabel'))
    ),
    { target: { value: 's-pub-edited' } }
  );
  fireEvent.click(
    await screen.findByRole('button', {
      name: de('ConfigApp.Connection.saveChanges'),
    })
  );
  // Re-registration warning: the store is connected and a key just changed.
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: de('ConfigApp.Connection.rotationConfirmButton'),
    })
  );
};

describe('ConfigApp — processor failures in the operator language', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (buildApiUrl as jest.Mock).mockImplementation(
      (endpoint: string) => `https://mc-api.test${endpoint}`
    );
    useApplicationContextMock.mockImplementation((selector) =>
      selector({ environment: { processorUrl: PROCESSOR } } as never)
    );
    executeMock.mockImplementation(
      async (
        fetcher: Parameters<typeof executeHttpClientRequest>[0],
        config: Parameters<typeof executeHttpClientRequest>[1]
      ) =>
        (
          await fetcher({
            credentials: 'include',
            headers: {
              'x-forward-to': config?.forwardToConfig?.uri ?? '',
            },
          } as never)
        ).data
    );
  });

  /** The text of the error notification the screen raised, once one has been raised. */
  const notifiedError = async (): Promise<string> => {
    await waitFor(() => expect(mockShowNotification).toHaveBeenCalled());
    const call = mockShowNotification.mock.calls
      .map(([arg]) => arg as { kind: string; text: string })
      .find((arg) => arg.kind === 'error');
    expect(call).toBeDefined();
    return call!.text;
  };

  it('states a gateway failure that names no reason in the operator language', async () => {
    stubGateway(gatewayFailureResponse());

    renderConfigApp();
    await saveConnection();

    expect(await notifiedError()).toBe(
      'Die Zahlungsverbindung konnte nicht erreicht werden. (HTTP 502)'
    );
  });

  // No response at all (offline, DNS, a rejected `fetch`): the browser's own English `Failed to fetch`
  // is not an answer, and it is not translatable — so it gets the app's words like any other failure.
  it('states a save that produced no response at all in the operator language', async () => {
    stubGateway(new TypeError('Failed to fetch'));

    renderConfigApp();
    await saveConnection();

    expect(await notifiedError()).toBe(
      'Die Zahlungsverbindung ist nicht erreichbar. Prüfen Sie Ihre Netzwerkverbindung und versuchen Sie es erneut.'
    );
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });

  // A credential rejection is the VENDOR's wording relayed by the processor. It is replaced, not shown:
  // an operator cannot act on "PSP API error (401)", it is only ever English, and it echoes part of the
  // key back onto the screen.
  it('replaces a vendor-worded credential rejection with the generic message', async () => {
    stubGateway(
      jsonResponse(
        {
          message:
            'Connection validation failed: PSP API error (401): The given key s-p****fds is unknown or invalid.',
        },
        false,
        400
      )
    );

    renderConfigApp();
    await saveConnection();

    expect(await notifiedError()).toBe(de('ConfigApp.saveError'));
    expect(screen.queryByText(/401/)).not.toBeInTheDocument();
    expect(screen.queryByText(/s-p\*\*\*\*fds/)).not.toBeInTheDocument();
  });
});
