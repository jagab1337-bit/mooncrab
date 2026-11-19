import { centsFromInput, DIRECT_POLICY, externalSource, MANUAL_SOURCES, paymentSummary, validPayment } from '../shared/booking-terms.ts';
import type { BookingPayment } from '../shared/booking-terms.ts';
import { formatPhp } from '../shared/pricing.ts';

const amount = (cents: number | null | undefined) => cents == null ? '' : (cents / 100).toFixed(2);
const money = (cents: number) => formatPhp(cents / 100);

export function paymentFields(payment?: BookingPayment, quote?: number): string {
  return `<div class="owner-settings-grid owner-booking-amounts">
    <label>Agreed accommodation total (PHP)<input name="total" type="number" min="0.01" max="99999999.99" step="0.01" required value="${amount(payment?.totalCents ?? (quote === undefined ? null : Math.round(quote * 100)))}"></label>
    <label>Payment actually received (PHP)<input name="received" type="number" min="0" max="99999999.99" step="0.01" value="${amount(payment?.receivedCents)}" placeholder="Leave blank if unrecorded"></label>
  </div><dl class="owner-payment-summary" data-payment-summary></dl>`;
}

export function bindPayment(form: HTMLFormElement, source: () => string | undefined) {
  const total = form.elements.namedItem('total') as HTMLInputElement;
  const received = form.elements.namedItem('received') as HTMLInputElement;
  const summary = form.querySelector<HTMLElement>('[data-payment-summary]')!;
  function read(): BookingPayment | null {
    const payment = { totalCents: centsFromInput(total.value), receivedCents: received.value ? centsFromInput(received.value) : null };
    return validPayment(payment) ? payment : null;
  }
  function update() {
    const payment = read();
    if (!payment) { summary.textContent = 'Enter the agreed total to see the deposit and balance.'; return; }
    const { deposit, depositOutstanding, balance, status } = paymentSummary(payment, externalSource(source()) ? null : DIRECT_POLICY.depositPercent);
    summary.innerHTML = [
      ['Required deposit (50%)', deposit === null ? 'Set by booking platform' : money(deposit)],
      ['Payment received', payment.receivedCents === null ? 'No payment recorded' : money(payment.receivedCents)],
      ...(depositOutstanding === null ? [] : [['Deposit outstanding', money(depositOutstanding)]]),
      ['Remaining balance', money(balance)], ['Payment status', status],
    ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  }
  form.addEventListener('input', update);
  update();
  return { read, update };
}

export const manualBookingFields = `<div class="owner-settings-grid owner-manual-fields">
  <label>Guest full name<input name="name" required minlength="2" maxlength="100" autocomplete="off"></label>
  <label>Guest email<input name="email" type="email" maxlength="254" autocomplete="off"></label>
  <label>Phone or WhatsApp<input name="phone" type="tel" maxlength="40" placeholder="+63 912 345 6789" autocomplete="off"></label>
  <label>Room<select name="room"><option>KASAG</option></select></label>
  <label>Check-in<input name="checkIn" type="date" required></label>
  <label>Check-out<input name="checkOut" type="date" required></label>
  <label>Guests<select name="guests"><option>1</option><option selected>2</option><option>3</option></select></label>
  <label>Reservation source<select name="source" required></select></label>
  <label>Status when saving without email<select name="status"><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option><option value="declined">Declined</option></select></label>
</div>
${paymentFields()}
<label class="owner-manual-notes">Private reservation notes<textarea name="message" maxlength="2000" rows="3"></textarea></label>
<label class="owner-request-agreement" data-policy-agreement><input type="checkbox" name="policyAccepted"> Guest agreed to the 50% non-refundable deposit and same-day cancellation policy.</label>
<p class="owner-hint" data-source-note>Confirmation email requires a guest email and recorded policy agreement.</p>
<div class="owner-request-actions"><button type="submit">Save Without Sending Email</button><button class="owner-primary" type="submit" name="sendEmail">Confirm Booking &amp; Send Email</button></div>`;

export function bindManualBooking(form: HTMLFormElement, save: (payload: Record<string, unknown>) => Promise<boolean>, showError: (message: string) => void) {
  const source = form.elements.namedItem('source') as HTMLSelectElement;
  const send = form.elements.namedItem('sendEmail') as HTMLButtonElement;
  const policy = form.querySelector<HTMLElement>('[data-policy-agreement]')!;
  const payment = bindPayment(form, () => source.value);
  let id = crypto.randomUUID();
  function updateSource() {
    const provider = externalSource(source.value);
    policy.hidden = Boolean(provider);
    send.disabled = Boolean(provider);
    form.querySelector('[data-source-note]')!.textContent = provider
      ? 'Use the platform’s confirmation and cancellation policy. Save without sending to record the reservation here.'
      : 'Confirmation email requires a guest email and recorded policy agreement.';
    payment.update();
  }
  function setSources(additional: string[]) {
    const current = source.value;
    source.replaceChildren(new Option('Choose a source', ''), ...[...MANUAL_SOURCES, ...additional].map(value => new Option(value)));
    source.value = [...source.options].some(option => option.value === current) ? current : '';
    updateSource();
  }
  form.addEventListener('input', () => { id = crypto.randomUUID(); });
  source.addEventListener('change', updateSource);
  form.onsubmit = async event => {
    event.preventDefault();
    const fields = new FormData(form);
    const amounts = payment.read();
    if (!amounts) { showError('Enter the agreed accommodation total and any payment actually received.'); return; }
    const sendEmail = event.submitter === send;
    const policyAccepted = !externalSource(source.value) && fields.get('policyAccepted') === 'on';
    if (sendEmail && (!fields.get('email') || !policyAccepted)) {
      showError('Enter the guest email and record their policy agreement before confirming with email.'); return;
    }
    const saved = await save({ ...Object.fromEntries(fields), guests: Number(fields.get('guests')), payment: amounts, sendEmail, policyAccepted,
      policyVersion: DIRECT_POLICY.version, status: sendEmail ? 'confirmed' : fields.get('status'), idempotencyKey: id });
    if (saved) { form.reset(); id = crypto.randomUUID(); updateSource(); }
  };
  setSources([]);
  return setSources;
}
