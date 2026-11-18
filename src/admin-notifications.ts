import { showError, type AdminFetch } from './admin-workspace.ts';

const endpoint = '/api/admin/email-outbox?settings=1';
export async function renderNotifications(container: HTMLElement, request: AdminFetch): Promise<void> {
  container.innerHTML = `<h2>Booking notifications</h2>
    <p class="owner-hint">Owner notifications are sent from bookings@mooncrabsiargao.com.</p>
    <p data-smtp role="status">Checking email connection…</p>
    <form class="workspace-form">
      <label>Recipient email<input type="email" name="recipient" maxlength="254" autocomplete="off"></label>
      <label><span><input type="checkbox" name="enabled"> Enable owner notifications</span></label>
      <div class="workspace-actions workspace-full"><button class="owner-primary" type="submit">Save notification settings</button><button type="button" data-test>Send test notification</button></div>
    </form>
    <p data-status class="workspace-status" role="status"></p>`;
  const form = container.querySelector('form')!;
  const recipient = form.querySelector<HTMLInputElement>('[name=recipient]')!;
  const enabled = form.querySelector<HTMLInputElement>('[name=enabled]')!;
  const test = form.querySelector<HTMLButtonElement>('[data-test]')!;
  const smtp = container.querySelector<HTMLElement>('[data-smtp]')!;
  const status = container.querySelector<HTMLElement>('[data-status]')!;
  function apply(data: Record<string, unknown>): void {
    const connection = data.smtp as { configured: boolean; reason?: string };
    const last = data.lastTest as { status: string; at: string } | null;
    recipient.value = String(data.recipient ?? '');
    enabled.checked = data.enabled === true;
    test.disabled = !connection.configured || !recipient.value;
    smtp.textContent = connection.configured ? 'Spacemail SMTP is configured.' : connection.reason || 'Spacemail SMTP is unavailable.';
    status.textContent = last ? `Last test: ${last.status === 'accepted' ? 'accepted by Spacemail' : last.status} · ${new Date(last.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}` : 'No test sent yet.';
  }
  try { apply(await request(endpoint)); } catch (error) { showError(status, error); return; }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    button.disabled = true;
    try {
      apply(await request(endpoint, 'POST', { action: 'save', settings: { recipient: recipient.value.trim(), enabled: enabled.checked } }));
      status.textContent = 'Notification settings saved.';
    } catch (error) { showError(status, error); } finally { button.disabled = false; }
  });
  test.addEventListener('click', async () => {
    test.disabled = true;
    status.textContent = 'Sending test to the saved recipient…';
    try { apply(await request(endpoint, 'POST', { action: 'test' })); }
    catch (error) { showError(status, error); test.disabled = false; }
  });
}
