import { showError, type AdminFetch } from './admin-workspace.ts';

const endpoint = '/api/admin/email-outbox?settings=1';

type NotificationEditorOptions = {
  showTest?: boolean;
  onSave?: (enabled: boolean) => void;
};

export function mountNotificationEditor(
  container: HTMLElement,
  request: AdminFetch,
  initialSettings: Record<string, unknown>,
  { showTest = false, onSave }: NotificationEditorOptions = {},
): void {
  container.innerHTML = `
    ${showTest ? '<p data-smtp role="status"></p>' : ''}
    <form class="workspace-form">
      <label class="workspace-full">Owner alert recipients
        <textarea name="recipients" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        <span class="owner-hint">Enter up to 10 email addresses, one per line or separated by commas.</span>
      </label>
      <label class="workspace-full"><span><input type="checkbox" name="enabled"> Enable owner booking alerts</span></label>
      <div class="workspace-actions workspace-full">
        <button class="owner-primary" type="submit">Save notification settings</button>
        ${showTest ? '<button type="button" data-test>Send test notification</button>' : ''}
      </div>
    </form>
    <p class="workspace-status" data-notification-status role="status"></p>
    ${showTest ? '<p data-last-test role="status"></p>' : ''}`;
  const form = container.querySelector('form')!;
  const recipients = form.querySelector<HTMLTextAreaElement>('[name=recipients]')!;
  const enabled = form.querySelector<HTMLInputElement>('[name=enabled]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const test = form.querySelector<HTMLButtonElement>('[data-test]');
  const status = container.querySelector<HTMLElement>('[data-notification-status]')!;
  let testReady = false;

  function apply(data: Record<string, unknown>, updateDraft: boolean) {
    const addresses = Array.isArray(data.recipients) ? data.recipients : data.recipient ? [String(data.recipient)] : [];
    if (updateDraft) {
      recipients.value = addresses.join('\n');
      recipients.rows = Math.max(3, addresses.length);
      enabled.checked = data.enabled === true;
    }
    if (!test) return;
    const connection = data.smtp as { configured: boolean; reason?: string };
    const last = data.lastTest as { status: string; at: string; results?: { to: string; state: string }[] } | null;
    const stateLabel = (state: string) => ({
      accepted: 'accepted by Spacemail', failed: 'rejected', unknown: 'outcome uncertain',
    }[state] ?? state);
    testReady = connection.configured && addresses.length > 0;
    container.querySelector('[data-smtp]')!.textContent = connection.configured
      ? 'Spacemail SMTP is configured.' : connection.reason || 'Spacemail SMTP is unavailable.';
    const result = last?.results?.map(({ to, state }) => `${to} (${stateLabel(state)})`).join(', ');
    container.querySelector('[data-last-test]')!.textContent = last
      ? `Last test · ${new Date(last.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} · ${result || stateLabel(last.status)}`
      : 'No test sent yet.';
  }

  apply(initialSettings, true);
  if (test) test.disabled = !testReady;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const addresses = recipients.value.split(/[\r\n,]+/).map(address => address.trim()).filter(Boolean);
    submit.disabled = true;
    recipients.disabled = true;
    enabled.disabled = true;
    if (test) test.disabled = true;
    try {
      const result = await request(endpoint, 'POST', { action: 'save', settings: { recipients: addresses, enabled: enabled.checked } });
      apply(result, true);
      status.textContent = 'Notification settings saved.';
      onSave?.(enabled.checked);
    } catch (error) { showError(status, error); }
    finally {
      submit.disabled = false;
      recipients.disabled = false;
      enabled.disabled = false;
      if (test) test.disabled = !testReady;
    }
  });
  test?.addEventListener('click', async () => {
    if (!confirm('Send a test email to all saved owner alert recipients?')) return;
    submit.disabled = test.disabled = true;
    status.textContent = 'Sending test to saved recipients…';
    try {
      apply(await request(endpoint, 'POST', { action: 'test' }), false);
      status.textContent = '';
    } catch (error) { showError(status, error); }
    finally {
      submit.disabled = false;
      test.disabled = !testReady;
    }
  });
}

export async function renderNotifications(container: HTMLElement, request: AdminFetch): Promise<void> {
  container.innerHTML = `<h2>Booking notifications</h2>
    <p class="owner-hint">Owner notifications are sent from bookings@mooncrabsiargao.com.</p>
    <div data-notification-editor><p role="status">Loading booking notifications…</p></div>`;
  const editor = container.querySelector<HTMLElement>('[data-notification-editor]')!;
  try { mountNotificationEditor(editor, request, await request(endpoint), { showTest: true }); }
  catch (error) { showError(editor, error); }
}
