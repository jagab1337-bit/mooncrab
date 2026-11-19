import type { PricingSnapshot } from './pricing.ts';

export type PricePackage = 'nightly' | 'weekly' | 'monthly';
export type CouponKind = 'percent' | 'fixed' | 'free-night';
export type CouponStatus = 'active' | 'inactive' | 'archived';
export interface CouponRule {
  code: string; name: string; description: string; notes: string; kind: CouponKind; value: number;
  rooms: string[]; packages: PricePackage[]; minCents: number; minNights: number; maxNights: number | null;
  startsAt: string | null; endsAt: string | null; checkInFrom: string | null; checkInThrough: string | null;
  minLead: number | null; maxLead: number | null; limit: number | null; perGuest: number | null; maxDiscountCents: number | null;
  paidNights: number; maxFree: number; combinable: boolean; status: CouponStatus;
}
export interface Coupon extends CouponRule { revision: string; createdAt: string; updatedAt: string }
export interface CouponApplied { code: string; name: string; revision: string; discountCents: number }

export const COUPON_CODE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
export const PACKAGES: PricePackage[] = ['nightly','weekly','monthly'];
export const couponStatus = (coupon: Coupon, now: string) => coupon.status !== 'active' ? coupon.status
  : coupon.endsAt && now >= coupon.endsAt ? 'expired' : coupon.startsAt && now < coupon.startsAt ? 'scheduled' : 'active';

export function normalizeCodes(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3 || value.some(code => typeof code !== 'string')) return null;
  const codes: string[] = value.map(code => code.trim().toUpperCase());
  return new Set(codes).size === codes.length && codes.every(code=>COUPON_CODE.test(code)) ? codes : null;
}

export function applyAdjustments(base: PricingSnapshot, coupons: CouponApplied[], manualDiscountCents = 0): PricingSnapshot {
  if (!coupons.length && !manualDiscountCents) return base;
  const room = Math.round(base.roomSubtotalPhp * 100);
  const discount = coupons.reduce((total, item) => total + item.discountCents, manualDiscountCents);
  if (!Number.isSafeInteger(discount) || discount < 0 || discount > room) throw new Error('Discount exceeds the eligible room subtotal.');
  const total = Math.round(base.totalPhp * 100) - discount;
  return { ...base, ...(coupons.length?{coupons}:{}), ...(manualDiscountCents?{manualDiscountCents}:{}), originalTotalPhp: base.totalPhp, discountPhp:discount/100,
    totalPhp:total/100, depositPhp:Math.ceil(total/2)/100 };
}

export function priceWithCoupons(base: PricingSnapshot, coupons: Coupon[], checkIn: string, today: string, at: string): PricingSnapshot {
  if (coupons.length > 1 && coupons.some(coupon=>!coupon.combinable)) throw new Error('These codes cannot be combined.');
  const lead = Math.round((Date.parse(checkIn) - Date.parse(today))/86_400_000);
  const room = Math.round(base.roomSubtotalPhp*100);
  const rateNights = base.lineItems.flatMap(line => {
    if (line.kind === 'extra-guest') return [];
    const kind=line.kind;
    const count = line.quantity * (kind === 'weekly' ? 7 : kind === 'monthly' ? 30 : 1);
    const cents = Math.round(line.amountPhp * 100);
    return Array.from({length:count}, (_,i)=>({kind,remaining:Math.floor(cents/count)+(i<cents%count ? 1 : 0)}));
  });
  const applied = coupons.map(coupon => {
    if (couponStatus(coupon, at) !== 'active' || !coupon.rooms.includes(base.room) || base.nights < coupon.minNights
      || (coupon.maxNights !== null && base.nights > coupon.maxNights) || room < coupon.minCents
      || (coupon.checkInFrom && checkIn < coupon.checkInFrom) || (coupon.checkInThrough && checkIn > coupon.checkInThrough)
      || (coupon.minLead !== null && lead < coupon.minLead) || (coupon.maxLead !== null && lead > coupon.maxLead)) throw new Error('This code is unavailable for these booking details.');
    const eligible = rateNights.filter(night=>night.remaining>0&&coupon.packages.includes(night.kind));
    const free = Math.min(coupon.maxFree, Math.floor(eligible.length/(coupon.paidNights+coupon.value))*coupon.value);
    const nights = coupon.kind==='free-night'?eligible.sort((a,b)=>a.remaining-b.remaining).slice(0,free):eligible;
    const subtotal = nights.reduce((sum,night)=>sum+night.remaining,0);
    const raw = coupon.kind === 'percent' ? Math.round(subtotal*coupon.value/10000) : coupon.kind === 'fixed' ? coupon.value : subtotal;
    const discountCents = Math.min(subtotal,raw,coupon.maxDiscountCents ?? Infinity);
    if (discountCents <= 0) throw new Error('This code has no discount for the selected rate packages.');
    let left=discountCents;
    for (const night of nights) {
      const applied=Math.min(night.remaining,left);
      night.remaining-=applied;
      left-=applied;
      if (!left) break;
    }
    return { code:coupon.code, name:coupon.name, revision:coupon.revision, discountCents };
  });
  return applyAdjustments(base, applied);
}
