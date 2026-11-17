/** Package rates apply only to complete seven-/thirty-night blocks. */
export interface PricingConfig {
  nightlyPhp: number;
  weeklyPhp: number;
  monthlyPhp: number;
  minimumNights: number;
  maxNights: number;
  weeklyEnabled: boolean;
  monthlyEnabled: boolean;
}
export const DEFAULT_PRICING: PricingConfig = {
  nightlyPhp: 1300, weeklyPhp: 8000, monthlyPhp: 30000,
  minimumNights: 2, maxNights: 90, weeklyEnabled: true, monthlyEnabled: true,
};
export interface PriceLine {
  kind: 'monthly' | 'weekly' | 'nightly' | 'extra-guest';
  label: string;
  quantity: number;
  unitPhp: number;
  amountPhp: number;
}
export interface PricingSnapshot {
  currency: 'PHP';
  room: 'KASAG';
  nights: number;
  guests: number;
  monthlyPackages: number;
  weeklyPackages: number;
  additionalNights: number;
  lineItems: PriceLine[];
  roomSubtotalPhp: number;
  extraGuestFeePhp: number;
  totalPhp: number;
  depositPhp: number;
  rates: PricingConfig;
  calculatedAt: string;
}
export function validPricing(value: unknown): value is PricingConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as PricingConfig;
  return ['nightlyPhp', 'weeklyPhp', 'monthlyPhp'].every(key => Number.isSafeInteger(p[key as keyof PricingConfig]) && Number(p[key as keyof PricingConfig]) >= 1 && Number(p[key as keyof PricingConfig]) <= 1_000_000)
    && Number.isInteger(p.minimumNights) && p.minimumNights >= 2 && p.minimumNights <= 90
    && Number.isInteger(p.maxNights) && p.maxNights >= p.minimumNights && p.maxNights <= 90
    && typeof p.weeklyEnabled === 'boolean' && typeof p.monthlyEnabled === 'boolean';
}
export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) return NaN;
  const arrival = Date.parse(`${checkIn}T00:00:00Z`);
  const departure = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(arrival) || !Number.isFinite(departure)
    || new Date(arrival).toISOString().slice(0, 10) !== checkIn || new Date(departure).toISOString().slice(0, 10) !== checkOut) return NaN;
  return (departure - arrival) / 86_400_000;
}
/** Find the lowest total from eligible whole packages; never round a shorter stay up. */
export function calculatePricing(nights: number, guests: number, rates: PricingConfig = DEFAULT_PRICING, calculatedAt = new Date().toISOString()): PricingSnapshot {
  if (!validPricing(rates) || !Number.isInteger(nights) || nights < rates.minimumNights || nights > rates.maxNights
    || !Number.isInteger(guests) || guests < 1 || guests > 3) throw new Error('Choose a valid stay and guest count.');
  const choices = [{ length: 1, amount: rates.nightlyPhp, kind: 'nightly' as const }];
  const packages: Array<{length:number;amount:number;kind:'nightly'|'weekly'|'monthly'}> = [...choices];
  if (rates.weeklyEnabled) packages.push({ length: 7, amount: rates.weeklyPhp, kind: 'weekly' });
  if (rates.monthlyEnabled) packages.push({ length: 30, amount: rates.monthlyPhp, kind: 'monthly' });
  const cost = Array<number>(nights + 1).fill(Infinity);
  const picked = Array<number>(nights + 1).fill(0);
  cost[0] = 0;
  for (let count = 1; count <= nights; count++) for (let index = 0; index < packages.length; index++) {
    const pack = packages[index];
    if (count >= pack.length && cost[count - pack.length] + pack.amount < cost[count]) {
      cost[count] = cost[count - pack.length] + pack.amount;
      picked[count] = index;
    }
  }
  const counts = { monthly: 0, weekly: 0, nightly: 0 };
  for (let count = nights; count > 0;) {
    const pack = packages[picked[count]];
    counts[pack.kind]++;
    count -= pack.length;
  }
  const lineItems: PriceLine[] = [];
  if (counts.monthly) lineItems.push({kind:'monthly',label:'30-night monthly package',quantity:counts.monthly,unitPhp:rates.monthlyPhp,amountPhp:counts.monthly*rates.monthlyPhp});
  if (counts.weekly) lineItems.push({kind:'weekly',label:'7-night weekly package',quantity:counts.weekly,unitPhp:rates.weeklyPhp,amountPhp:counts.weekly*rates.weeklyPhp});
  if (counts.nightly) lineItems.push({kind:'nightly',label:'Nightly rate',quantity:counts.nightly,unitPhp:rates.nightlyPhp,amountPhp:counts.nightly*rates.nightlyPhp});
  const extraGuestFeePhp = guests === 3 ? nights * 500 : 0;
  if (extraGuestFeePhp) lineItems.push({kind:'extra-guest',label:'Third guest supplement',quantity:nights,unitPhp:500,amountPhp:extraGuestFeePhp});
  const totalPhp = cost[nights] + extraGuestFeePhp;
  return {currency:'PHP',room:'KASAG',nights,guests,monthlyPackages:counts.monthly,weeklyPackages:counts.weekly,additionalNights:counts.nightly,lineItems,
    roomSubtotalPhp:cost[nights],extraGuestFeePhp,totalPhp,depositPhp:totalPhp/2,rates:{...rates},calculatedAt};
}
export function formatPhp(amount: number): string {
  return new Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP',maximumFractionDigits:amount%1?2:0}).format(amount);
}
