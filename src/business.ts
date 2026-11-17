import { DEFAULT_PRICING, type PricingConfig } from '../shared/pricing.ts';

export const CONTACTS = {
  phone: '+639625284264', whatsappUrl: 'https://wa.me/639625284264',
  facebookUrl: 'https://www.facebook.com/share/1CsWCrqdR8/?mibextid=wwXIfr',
  instagramUrl: 'https://www.instagram.com/mooncrabhosteliao/',
  email: 'greetings@mooncrabsiargao.com', bookingEmail: 'bookings@mooncrabsiargao.com',
  notificationEmail: 'greetings@mooncrabsiargao.com',
};
export const CHANNELS = { airbnb: 'https://www.airbnb.com/rooms/1817049407925156122', booking: 'https://www.booking.com/hotel/ph/moon-crab-homestay.en-gb.html', maps: 'https://maps.app.goo.gl/RwCRdtYfqmGDei1e8' };
export const externalArrow = '<svg class="arrow-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>';
export interface PublicConfig { room: 'KASAG'; pricing: PricingConfig; contacts: typeof CONTACTS }
export const DEFAULT_CONFIG: PublicConfig = { room: 'KASAG', pricing: DEFAULT_PRICING, contacts: CONTACTS };
let configPromise: Promise<PublicConfig> | undefined;
export function getPublicConfig(): Promise<PublicConfig> {
  return configPromise ??= fetch('/api/config', { signal: AbortSignal.timeout(10000) }).then(async response => {
    if (!response.ok) throw new Error('Rates are temporarily unavailable.');
    const data = await response.json();
    if (data.room !== 'KASAG' || !data.pricing || !data.contacts) throw new Error('Rates are temporarily unavailable.');
    return data as PublicConfig;
  });
}
export function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
export function hydrateContacts(contacts: typeof CONTACTS = CONTACTS): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-contact]').forEach(link => {
    const key = link.dataset.contact as keyof typeof CONTACTS;
    const value = contacts[key];
    if (!value) return;
    link.href = key === 'phone' ? `tel:${value}` : key.toLowerCase().includes('email') ? `mailto:${value}` : value;
    if (key === 'phone' || key.toLowerCase().includes('email')) link.textContent = key === 'phone' ? value.replace(/^(\+63)(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3 $4') : value;
  });
}
