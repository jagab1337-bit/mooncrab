import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCodes, PACKAGES, priceWithCoupons, type Coupon } from '../shared/coupons.ts';
import { calculatePricing } from '../shared/pricing.ts';

const at='2026-11-19T08:00:00.000Z', today='2026-11-19', arrival='2026-12-17';
const discount:Coupon={code:'ISLAND10',name:'Island offer',description:'',notes:'',kind:'percent',value:1000,rooms:['KASAG'],packages:PACKAGES,
  minCents:0,minNights:2,maxNights:null,startsAt:null,endsAt:null,checkInFrom:null,checkInThrough:null,minLead:null,maxLead:null,
  limit:null,perGuest:null,maxDiscountCents:null,paidNights:3,maxFree:1,combinable:false,status:'active',revision:'rule-1',createdAt:at,updatedAt:at};
const quote=(nights:number, rules:Coupon[], guests=2)=>priceWithCoupons(calculatePricing(nights,guests),rules,arrival,today,at);

test('normalized codes discount the room, preserve guest fees, and recalculate the deposit',()=>{
  assert.deepEqual(normalizeCodes([' island10 ']),['ISLAND10']);
  assert.equal(normalizeCodes(['ISLAND10','island10']),null);
  const discounted=quote(7,[discount],3);
  assert.equal(discounted.originalTotalPhp,11500);
  assert.equal(discounted.discountPhp,800);
  assert.equal(discounted.totalPhp,10700);
  assert.equal(discounted.depositPhp,5350);
  assert.equal(discounted.coupons?.[0].revision,'rule-1');
});

test('free nights use the actual package rate and do not extend the stay',()=>{
  const rule={...discount,kind:'free-night' as const,value:1,paidNights:6 as const};
  const discounted=quote(7,[rule]);
  assert.equal(discounted.nights,7);
  assert.equal(discounted.discountPhp,1142.85);
  assert.equal(discounted.totalPhp,6857.15);
  assert.equal(discounted.depositPhp,3428.58);
  assert.throws(()=>quote(6,[rule]));
});

test('room, lead time, expiry, packages, and stacking are enforced',()=>{
  for (const invalid of [{rooms:['OTHER']},{startsAt:'2026-12-01T00:00:00.000Z'},{endsAt:at},
    {minLead:29},{maxLead:27},{minNights:8},{maxNights:6},{status:'inactive' as const},{packages:['monthly' as const]}]) {
    assert.throws(()=>quote(7,[{...discount,...invalid}]));
  }
  assert.throws(()=>quote(7,[discount,{...discount,code:'TWO'}]),/cannot be combined/);
  const fixed={...discount,kind:'fixed' as const,value:200000,packages:['nightly' as const],combinable:true};
  assert.throws(()=>quote(8,[fixed,{...fixed,code:'MORE'}]),/no discount/);
  assert.equal(quote(3,[{...fixed,value:900000}]).totalPhp,0);
});
