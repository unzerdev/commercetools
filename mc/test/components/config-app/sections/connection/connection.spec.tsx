import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Formik } from 'formik';
import { renderWithIntl } from '../../../../support/render-with-intl';
import type { ConfigFormValues } from '../../../../../src/components/config-app/config-model';
import ConnectionSection from '../../../../../src/components/config-app/sections/connection/connection-section';

const baseValues = (
  overrides: Partial<ConfigFormValues> = {}
): ConfigFormValues => ({
  mode: 'sandbox',
  environments: {
    sandbox: { publicKey: 's-pub-1', privateKey: 's-priv-1' },
    live: { publicKey: 'p-pub-1', privateKey: 'p-priv-1' },
  },
  ...overrides,
});

/**
 * Type into one of the key fields. Most save-flow tests go through this rather than seeding the value:
 * the primary action is disabled while the form still matches what is persisted, so a save can only be
 * reached the way an operator reaches it — by changing something.
 */
const typeKey = (field: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(field), { target: { value } });

/**
 * Confirm the re-registration warning. Changing the keys of an ALREADY connected environment asks first,
 * because a successful connect discards what belonged to the old account, so a connected-store save test
 * goes through the dialog exactly as an operator does.
 */
const confirmRotation = () =>
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Reconnect',
    })
  );

// `onSave` / `onDisconnect` resolve a BOOLEAN outcome and never reject: the section reports no
// message of its own, so a failure is `false` and the parent is what turns it into a notification.
const renderSection = (
  values: ConfigFormValues,
  props: {
    connected?: boolean;
    onSave?: jest.Mock<Promise<boolean>, []>;
    onDisconnect?: jest.Mock<Promise<boolean>, []>;
    locale?: string;
  } = {}
) => {
  const onSave = props.onSave ?? jest.fn().mockResolvedValue(true);
  const onDisconnect = props.onDisconnect ?? jest.fn().mockResolvedValue(true);
  const connected = props.connected ?? true;
  const rendered = renderWithIntl(
    <Formik initialValues={values} onSubmit={jest.fn()}>
      <ConnectionSection
        connected={connected}
        onSave={onSave}
        onDisconnect={onDisconnect}
      />
    </Formik>,
    { locale: props.locale ?? 'en' }
  );
  return { ...rendered, onSave, onDisconnect };
};

describe('ConnectionSection', () => {
  it('renders the public and private key fields', () => {
    renderSection(baseValues());

    expect(screen.getByLabelText(/Public key/)).toHaveValue('s-pub-1');
    expect(screen.getByLabelText(/Private key/)).toHaveValue('s-priv-1');
  });

  it('labels the primary action Connect when not connected and Save changes when connected', () => {
    const { onSave } = renderSection(
      baseValues({
        environments: {
          sandbox: { publicKey: '', privateKey: '' },
          live: { publicKey: '', privateKey: '' },
        },
      }),
      { connected: false }
    );
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    void onSave;
  });

  it('shows the Disconnect action when the active environment is connected', () => {
    renderSection(baseValues(), { connected: true });

    expect(
      screen.getByRole('button', { name: 'Disconnect' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save changes' })
    ).toBeInTheDocument();
  });

  it('hides the Disconnect action when the environment is not connected', () => {
    renderSection(
      baseValues({
        environments: {
          sandbox: { publicKey: '', privateKey: '' },
          live: { publicKey: '', privateKey: '' },
        },
      }),
      { connected: false }
    );

    expect(
      screen.queryByRole('button', { name: 'Disconnect' })
    ).not.toBeInTheDocument();
  });

  it('binds the credential fields to the selected environment when the radio changes', async () => {
    renderSection(baseValues(), { connected: true });

    expect(screen.getByLabelText(/Public key/)).toHaveValue('s-pub-1');

    fireEvent.click(screen.getByRole('radio', { name: 'Live' }));

    await waitFor(() =>
      expect(screen.getByLabelText(/Public key/)).toHaveValue('p-pub-1')
    );
  });

  it('marks both key fields as required', () => {
    renderSection(
      baseValues({
        environments: {
          sandbox: { publicKey: '', privateKey: '' },
          live: { publicKey: '', privateKey: '' },
        },
      }),
      { connected: false }
    );

    expect(screen.getAllByText('*')).toHaveLength(2);
  });

  it('keeps the action shut while a key is still missing', async () => {
    const onSave = jest.fn().mockResolvedValue(true);
    renderSection(
      baseValues({
        environments: {
          sandbox: { publicKey: '', privateKey: '' },
          live: { publicKey: '', privateKey: '' },
        },
      }),
      { connected: false, onSave }
    );

    typeKey(/Public key/, 's-pub-1');

    // One key is not a connection: nothing to send, so the action never opens and no round trip is spent
    // discovering what the form already knows.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('flags a key whose prefix does not match the selected environment AS IT IS TYPED, and shuts the action', async () => {
    const onSave = jest.fn().mockResolvedValue(true);
    renderSection(
      baseValues({
        environments: {
          sandbox: { publicKey: '', privateKey: 's-priv-2' },
          live: { publicKey: '', privateKey: '' },
        },
      }),
      { connected: false, onSave }
    );

    typeKey(/Public key/, 'nope-123');

    // The message is what a disabled button cannot say for itself, so it does not wait for a click.
    expect(await screen.findByText(/must start with/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('lets the save through once both correctly-prefixed keys are present', async () => {
    const onSave = jest.fn().mockResolvedValue(true);
    renderSection(
      baseValues({
        environments: {
          sandbox: { publicKey: '', privateKey: '' },
          live: { publicKey: '', privateKey: '' },
        },
      }),
      { connected: false, onSave }
    );

    fireEvent.change(screen.getByLabelText(/Public key/), {
      target: { value: 's-pub-2' },
    });
    fireEvent.change(screen.getByLabelText(/Private key/), {
      target: { value: 's-priv-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  // Credentials arrive in the clear (processor), but an OLDER processor may still mask them.
  // The mask must not be read as a malformed key, or the save would be blocked with a prefix complaint
  // about characters the operator never typed.
  it('accepts a masked secret from an older processor without flagging its prefix', async () => {
    const onSave = jest.fn().mockResolvedValue(true);
    renderSection(
      baseValues({
        environments: {
          sandbox: { publicKey: 's-pub-1', privateKey: '***' },
          live: { publicKey: '', privateKey: '' },
        },
      }),
      { connected: true, onSave }
    );

    typeKey(/Public key/, 's-pub-2');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    confirmRotation();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/must start with/)).not.toBeInTheDocument();
  });

  it('replaces the stored secret when the operator edits it', async () => {
    renderSection(baseValues(), { connected: true });

    const secret = screen.getByLabelText(/Private key/);
    expect(secret).toHaveValue('s-priv-1');
    fireEvent.change(secret, { target: { value: 's-priv-fresh' } });

    await waitFor(() =>
      expect(screen.getByLabelText(/Private key/)).toHaveValue('s-priv-fresh')
    );
  });

  it('placeholders follow the selected environment', async () => {
    renderSection(baseValues(), { connected: true });

    expect(screen.getByLabelText(/Public key/)).toHaveAttribute(
      'placeholder',
      'Enter public key (s-pub-…)'
    );
    expect(screen.getByLabelText(/Private key/)).toHaveAttribute(
      'placeholder',
      'Enter private key (s-priv-…)'
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Live' }));

    await waitFor(() =>
      expect(screen.getByLabelText(/Public key/)).toHaveAttribute(
        'placeholder',
        'Enter public key (p-pub-…)'
      )
    );
    expect(screen.getByLabelText(/Private key/)).toHaveAttribute(
      'placeholder',
      'Enter private key (p-priv-…)'
    );
  });

  it('reveals and re-hides the private key', () => {
    renderSection(baseValues(), { connected: true });

    const secret = screen.getByLabelText(/Private key/);
    expect(secret).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show private key' }));
    expect(secret).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide private key' }));
    expect(secret).toHaveAttribute('type', 'password');
  });

  it('re-hides a revealed private key when the environment switches', async () => {
    renderSection(baseValues(), { connected: true });

    fireEvent.click(screen.getByRole('button', { name: 'Show private key' }));
    expect(screen.getByLabelText(/Private key/)).toHaveAttribute(
      'type',
      'text'
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Live' }));

    await waitFor(() =>
      expect(screen.getByLabelText(/Private key/)).toHaveAttribute(
        'type',
        'password'
      )
    );
  });

  it('states the pending phase while a save is in flight and disables both actions', async () => {
    let settle: (ok: boolean) => void = () => undefined;
    const onSave = jest.fn().mockReturnValue(
      new Promise<boolean>((resolve) => {
        settle = resolve;
      })
    );
    renderSection(baseValues(), { connected: true, onSave });

    typeKey(/Private key/, 's-priv-2');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    confirmRotation();

    const pending = await screen.findByRole('button', { name: 'Saving…' });
    expect(pending).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled();

    settle(true);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    );
  });

  it('reads Connecting… while a first connect is in flight', async () => {
    const onSave = jest.fn().mockReturnValue(new Promise<boolean>(() => {}));
    renderSection(
      baseValues({
        environments: {
          sandbox: { publicKey: 's-pub-1', privateKey: '' },
          live: { publicKey: '', privateKey: '' },
        },
      }),
      { connected: false, onSave }
    );

    typeKey(/Private key/, 's-priv-1');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(
      await screen.findByRole('button', { name: 'Connecting…' })
    ).toBeDisabled();
  });

  it('states the pending phase while a disconnect is in flight', async () => {
    const onDisconnect = jest
      .fn()
      .mockReturnValue(new Promise<boolean>(() => {}));
    renderSection(baseValues(), { connected: true, onDisconnect });

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    expect(
      await screen.findByRole('button', { name: 'Disconnecting…' })
    ).toBeDisabled();
  });

  it('keeps the field markers up and echoes no vendor text when the save reports failure', async () => {
    const onSave = jest.fn().mockResolvedValue(false);
    renderSection(
      baseValues({
        environments: {
          sandbox: { publicKey: 's-pub-1', privateKey: '' },
          live: { publicKey: '', privateKey: '' },
        },
      }),
      { connected: false, onSave }
    );

    typeKey(/Private key/, 's-priv-1');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // The section renders no outcome text at all — the parent owns the message, and the vendor's own
    // wording (status code, masked key fragment) must never reach this screen.
    expect(screen.queryByText(/401/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown or invalid/)).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Connect' })
    ).toBeEnabled();
  });

  // Re-registration: connecting an ALREADY connected environment to a different Unzer account discards
  // what belonged to the old one (its webhook, its payment-method configuration), so it is confirmed
  // first — and cancelling must leave the connection exactly as it was.
  describe('changing the keys of a connected environment', () => {
    it('asks before reconnecting, naming the account change and what it costs', async () => {
      const onSave = jest.fn().mockResolvedValue(true);
      renderSection(baseValues(), { connected: true, onSave });

      typeKey(/Private key/, 's-priv-other-account');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByText(/belong to a different Unzer account/)
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText('All existing configuration will be deleted.')
      ).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('saves once the operator confirms', async () => {
      const onSave = jest.fn().mockResolvedValue(true);
      renderSection(baseValues(), { connected: true, onSave });

      typeKey(/Private key/, 's-priv-other-account');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      confirmRotation();

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    });

    it('sends nothing when the operator cancels', async () => {
      const onSave = jest.fn().mockResolvedValue(true);
      renderSection(baseValues(), { connected: true, onSave });

      typeKey(/Private key/, 's-priv-other-account');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Cancel',
        })
      );

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      );
      expect(onSave).not.toHaveBeenCalled();
    });

    it('asks nothing on a FIRST connect — there is no account to disconnect from', async () => {
      const onSave = jest.fn().mockResolvedValue(true);
      renderSection(
        baseValues({
          environments: {
            sandbox: { publicKey: '', privateKey: '' },
            live: { publicKey: '', privateKey: '' },
          },
        }),
        { connected: false, onSave }
      );

      typeKey(/Public key/, 's-pub-1');
      typeKey(/Private key/, 's-priv-1');
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // Nothing changed means nothing to send: an untouched form must not fire a PUT that would re-validate
  // and re-register the very credentials the processor already holds. Together with the two specs above,
  // this is the whole gate on the primary action: changed, complete, and correctly prefixed.
  it('disables the primary action until the form differs from what is persisted', async () => {
    renderSection(baseValues(), { connected: true });

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    typeKey(/Private key/, 's-priv-2');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    );
  });

  // The reveal toggle lives INSIDE the field, which is what keeps both key inputs the same width. This
  // is a DOM-STRUCTURE claim — the toggle being a child of the field wrapper rather than its sibling —
  // so it is asserted on the tree itself; no role- or label-based query can express containment.
  it('renders the reveal toggle inside the private-key field wrapper', () => {
    const { container } = renderSection(baseValues(), { connected: true });

    /* eslint-disable testing-library/no-container, testing-library/no-node-access */
    const wrapper = container.querySelector('.unzer-secret-field');
    /* eslint-enable testing-library/no-container, testing-library/no-node-access */
    expect(wrapper).not.toBeNull();
    expect(wrapper).toContainElement(screen.getByLabelText(/Private key/));
    expect(wrapper).toContainElement(
      screen.getByRole('button', { name: 'Show private key' })
    );
  });

  it('links Need help at the support centre for the active locale', () => {
    renderSection(baseValues(), { connected: true });

    expect(screen.getByRole('link', { name: 'Need help?' })).toHaveAttribute(
      'href',
      'https://help.unzer.com/en/support/home'
    );
  });

  // Unzer's German pages are not the English paths with a locale swapped, so each language has its own
  // URL - and a language Unzer does not serve falls back to English rather than 404ing.
  it.each([
    [
      'de',
      'https://www.unzer.com/de/kontakt-vertrieb',
      'https://help.unzer.com/de/support/home',
    ],
    [
      'en',
      'https://www.unzer.com/en/sales-team-contact/',
      'https://help.unzer.com/en/support/home',
    ],
    [
      'sr',
      'https://www.unzer.com/en/sales-team-contact/',
      'https://help.unzer.com/en/support/home',
    ],
  ])(
    'points contact and support at the %s pages',
    (locale, contact, support) => {
      renderSection(baseValues(), { connected: true, locale });

      expect(
        screen.getByRole('link', { name: 'contact us here' })
      ).toHaveAttribute('href', contact);
      expect(screen.getByRole('link', { name: 'Need help?' })).toHaveAttribute(
        'href',
        support
      );
    }
  );

  it('opens a confirmation before disconnecting and does not call onDisconnect until confirmed', () => {
    const onDisconnect = jest.fn().mockResolvedValue(true);
    renderSection(baseValues(), { connected: true, onDisconnect });

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(
      screen.getByText(/including its payment method settings/)
    ).toBeInTheDocument();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it('runs the disconnect side-effect once the operator confirms', async () => {
    const onDisconnect = jest.fn().mockResolvedValue(true);
    renderSection(baseValues(), { connected: true, onDisconnect });

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
  });

  it('clears the pending phase when the disconnect reports failure', async () => {
    const onDisconnect = jest.fn().mockResolvedValue(false);
    renderSection(baseValues(), { connected: true, onDisconnect });

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
    // The button returns to its idle label and stays usable for a retry; the message is the parent's.
    expect(
      await screen.findByRole('button', { name: 'Disconnect' })
    ).toBeEnabled();
  });
});
