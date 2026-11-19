export const DIRECT_POLICY = {
  version: '2026-11-19',
  depositPercent: 50,
  deposit: 'A 50% deposit is required to secure your reservation and is non-refundable.',
  cancellation: 'Same-day cancellations are not allowed.',
} as const;

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
