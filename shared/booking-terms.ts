export const DIRECT_POLICY = {
  version: '2026-11-21',
  depositPercent: 50,
  deposit: 'A 50% deposit is required to secure your reservation.',
  cancellation: 'Cancel 14 days or more before check-in for a full refund of the amount paid. Cancel 7–13 days before check-in for a 50% refund of the amount paid. Cancellations fewer than 7 days before check-in are not refundable.',
  agreement: 'I have read and agree to Moon Crab Siargao’s booking and cancellation policy.',
} as const;

export const PREVIOUS_DIRECT_POLICY_VERSION = '2026-11-19';

export function hasRecordedDirectPolicy(version?: string): boolean {
  return version === DIRECT_POLICY.version || version === PREVIOUS_DIRECT_POLICY_VERSION;
}

export interface BookingAgreement {
  version: string;
  acceptedAt: string;
  recordedBy: 'guest' | 'host';
}

export interface BookingPayment {
  totalCents: number;
  receivedCents: number | null;
}

export const MANUAL_SOURCES = ['Walk-in', 'WhatsApp', 'Facebook Messenger', 'Instagram', 'Phone Call', 'Airbnb', 'Booking.com', 'Other'] as const;

export function externalSource(source?: string): 'airbnb' | 'booking' | undefined {
  if (source?.toLowerCase() === 'airbnb') return 'airbnb';
  if (source?.toLowerCase() === 'booking.com') return 'booking';
}

export function centsFromInput(value: string): number {
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : NaN;
}

export function validPayment(value: unknown): value is BookingPayment {
  if (!value || typeof value !== 'object') return false;
  const { totalCents, receivedCents } = value as BookingPayment;
  return Number.isSafeInteger(totalCents) && totalCents >= 0 && totalCents < 10_000_000_000
    && (receivedCents === null || (Number.isSafeInteger(receivedCents) && receivedCents >= 0 && receivedCents < 10_000_000_000));
}

export function readStoredPayment(value: unknown): BookingPayment | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { totalCents, receivedCents = null } = value as Partial<BookingPayment>;
  // The storage round trip can omit a null received amount. Keep submitted payments strict.
  const payment = { totalCents, receivedCents };
  if (validPayment(payment)) return payment;
}

export function paymentSummary({ totalCents, receivedCents }: BookingPayment, depositPercent: number | null) {
  const received = receivedCents ?? 0;
  const deposit = depositPercent === null ? null : Math.ceil(totalCents * depositPercent / 100);
  return {
    deposit,
    depositOutstanding: deposit === null ? null : Math.max(0, deposit - received),
    balance: Math.max(0, totalCents - received),
    status: receivedCents === null ? 'No payment recorded' : received > totalCents ? 'Overpaid' : received === totalCents ? 'Paid in full'
      : received === 0 ? 'Unpaid' : deposit !== null && received >= deposit ? 'Deposit covered' : 'Partially paid',
  };
}
