import { CHANNELS, CONTACTS, externalArrow, escapeHtml } from './business.ts';

export type VerifiedReview = { name: string; excerpt: string; source: 'Airbnb'|'Booking.com'|'Google'; url: string; rating?: string };
// Transcribed from the Airbnb screenshot supplied by the owner. See content/REVIEWS.md.
export const verifiedReviews: VerifiedReview[] = [{
  name: 'Nikki', source: 'Airbnb', rating: '5/5', url: CHANNELS.airbnb,
  excerpt: 'Had a wonderful stay! The place was clean and comfortable. Kile was incredibly accommodating and communication was excellent from booking until check-out. Everything was smooth and hassle-free.\n\nYou can tell the host put thought and effort into making guests feel welcome. Definitely a great place to stay and I’m happy to be among the first guests to experience it. Looking forward to seeing this Airbnb grow! Highly recommended and thank you Kile I can’t wait to be back 🤍',
}];
function reviewCard(review: VerifiedReview): string {
  const paragraphs = review.excerpt.split('\n\n');
  const stars = review.rating === '5/5' ? `<span class="review-stars" role="img" aria-label="5 out of 5 stars">${Array.from({length:5},()=>'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.7 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.3l6.3-.9Z"/></svg>').join('')}</span>` : '';
  return `<blockquote class="review-card"><div class="review-quote">${paragraphs.map((paragraph,index)=>`<p>${index===0?'“':''}${escapeHtml(paragraph)}${index===paragraphs.length-1?'”':''}</p>`).join('')}</div><footer class="review-author">${stars}<strong>${escapeHtml(review.name)}</strong><span>${review.rating?`${escapeHtml(review.rating)} · `:''}${review.source} guest</span><a href="${escapeHtml(review.url)}" target="_blank" rel="noopener noreferrer">Read on ${review.source} ${externalArrow}</a></footer></blockquote>`;
}
export function renderReviews(reviews: VerifiedReview[] = verifiedReviews): string {
  return `<section class="section reviews-section" id="reviews"><div class="wrap"><div class="section-top"><div><p class="eyebrow">A STAY, IN YOUR WORDS</p><h2>What our <em>guests say.</em></h2></div><p>Small stays leave their own memories.<br>We’d love to hear about yours.</p></div>${reviews.length ? `<div class="review-grid${reviews.length===1?' review-grid-single':''}">${reviews.map(reviewCard).join('')}</div>` : `<div class="review-invitation"><p>Stayed with us? Share your Mooncrab story.</p><a class="text-link" href="${CHANNELS.maps}" target="_blank" rel="noopener noreferrer">Find us on Google & leave a review ${externalArrow}</a></div>`}</div></section>`;
}
export function renderSocial(): string {
  return `<section class="section social-section"><div class="wrap social-grid"><div><p class="eyebrow">FOLLOW OUR ISLAND LIFE</p><h2>A little more<br><em>Mooncrab.</em></h2><p>Room details, island days, and the little things that make this place ours. Find us on Instagram and Facebook.</p><div class="social-actions"><a class="button" data-contact="instagramUrl" href="${CONTACTS.instagramUrl}" target="_blank" rel="noopener noreferrer">Instagram ${externalArrow}</a><a class="under-link" data-contact="facebookUrl" href="${CONTACTS.facebookUrl}" target="_blank" rel="noopener noreferrer">Facebook ${externalArrow}</a></div></div><div class="social-images"><a href="/images/full/dining.webp" data-photo-viewer data-caption="The shared dining space at Mooncrab"><img src="/images/dining.webp" alt="Wooden dining table and island details at Mooncrab" loading="lazy" width="1448" height="1086"></a><a href="/images/full/exterior.webp" data-photo-viewer data-caption="A quiet corner outside Mooncrab"><img src="/images/exterior.webp" alt="Mooncrab’s outdoor space in General Luna" loading="lazy" width="1024" height="1536"></a></div></div></section>`;
}
export function renderChannelLinks(): string {
  return `<div class="channel-links"><span>Or reserve through</span><a href="${CHANNELS.airbnb}" target="_blank" rel="noopener noreferrer">Airbnb ${externalArrow}</a><a href="${CHANNELS.booking}" target="_blank" rel="noopener noreferrer">Booking.com ${externalArrow}</a></div>`;
}
