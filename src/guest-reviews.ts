import { reviewImageUrl, type PublicReview } from '../shared/reviews.ts';
import { CHANNELS, escapeHtml, externalArrow } from './business.ts';
import { reviewLabel, reviewLabelMarkup, translateReviewLabels } from './review-labels.ts';
import { currentLanguage } from './appearance.ts';
import './guest-reviews.css';

export function reviewCard(review: PublicReview, images?: { thumb: string; full: string }): string {
  const thumb = images?.thumb ?? (review.photo ? reviewImageUrl(review, 'thumb') : '');
  const full = images?.full ?? (review.photo ? reviewImageUrl(review, 'full') : '');
  const photo = thumb && full ? `<a class="review-image" href="${escapeHtml(full)}" data-photo-viewer aria-haspopup="dialog" aria-label="${escapeHtml(reviewLabel('fullImage') + ' · ' + review.alt)}" style="--review-position:${review.cropX}% ${review.cropY}%"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(review.alt)}" loading="lazy" decoding="async" width="720" height="405"><span aria-hidden="true">${reviewLabelMarkup('fullImage')}</span></a>` : '';
  const date = review.date ? `<time datetime="${escapeHtml(review.date)}">${new Intl.DateTimeFormat(currentLanguage(), { dateStyle:'medium', timeZone:'UTC' }).format(new Date(review.date + 'T00:00:00Z'))}</time>` : '';
  const rating = review.rating === null ? '' : `<span class="review-rating">${review.scale === 5 ? `<span class="review-stars" aria-hidden="true" style="--review-rating:${review.rating * 20}%">★★★★★</span>` : ''}<span>${review.rating}/${review.scale}</span></span>`;
  const quote = review.text ? `<blockquote class="review-quote" dir="auto"${review.text.length > 650 ? ' tabindex="0"' : ''}>${review.text.split(/\n\s*\n/).map((p,i,a) => `<p>${i === 0 ? '“' : ''}${escapeHtml(p)}${i === a.length - 1 ? '”' : ''}</p>`).join('')}</blockquote>` : '';
  return `<article class="review-card"><div class="review-main">${review.featured ? `<p class="review-featured">${reviewLabelMarkup('featured')}</p>` : ''}${photo}${quote}</div>
  <footer class="review-author">${rating}${review.name ? `<strong dir="auto">${escapeHtml(review.name)}</strong>` : ''}<span class="review-source">${escapeHtml(review.sourceName ?? review.source)}${date ? ` · ${date}` : ''}</span>${review.url ? `<a href="${escapeHtml(review.url)}" target="_blank" rel="noopener noreferrer">${reviewLabelMarkup('readSource')} ${externalArrow}</a>` : ''}</footer></article>`;
}

export function renderReviews(): string {
  return `<section class="section reviews-section" id="reviews" aria-labelledby="guest-reviews-title"><div class="wrap">
    <div class="section-top"><div><p class="eyebrow">A STAY, IN YOUR WORDS</p><h2 id="guest-reviews-title"><span data-review-label="heading">What our <em>guests say.</em></span></h2></div>
    <div class="review-navigation" hidden>
      <button type="button" data-review-step="-1" aria-label="${reviewLabel('previous')}">←</button>
      <button type="button" data-review-step="1" aria-label="${reviewLabel('next')}">→</button>
    </div></div>
    <div data-review-results><p role="status">${reviewLabelMarkup('loading')}</p></div>
  </div></section>`;
}

export function mountGuestReviews(): void {
  const section = document.getElementById('reviews');
  if (!section) return;
  const results = section.querySelector<HTMLElement>('[data-review-results]')!;
  const nav = section.querySelector<HTMLElement>('.review-navigation')!;
  const buttons = [...nav.querySelectorAll('button')];
  let version: string | undefined;
  let pending = false;
  let track: HTMLElement | undefined;
  const syncControls = () => {
    nav.hidden = !track || track.scrollWidth <= track.clientWidth + 2;
    if (!track) return;
    buttons[0].disabled = track.scrollLeft <= 2;
    buttons[1].disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
  };
  const observer = new ResizeObserver(syncControls);
  observer.observe(results);
  const updateLabels = () => {
    translateReviewLabels(section);
    // Keep the existing English typographic accent.
    if (currentLanguage() === 'en') section.querySelector('[data-review-label="heading"]')!.innerHTML = 'What our <em>guests say.</em>';
    buttons.forEach((button,index) => button.setAttribute('aria-label', reviewLabel(index ? 'next' : 'previous')));
    results.querySelectorAll<HTMLAnchorElement>('.review-image').forEach(link =>
      link.setAttribute('aria-label', reviewLabel('fullImage') + ' · ' + (link.querySelector('img')?.alt ?? '')));
  };
  async function refresh() {
    if (pending || document.hidden) return;
    pending = true;
    try {
      const response = await fetch('/api/config?reviews=1', { cache:'no-store', signal:AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error('Reviews unavailable');
      const { reviews } = await response.json() as { reviews: PublicReview[] };
      const updated = JSON.stringify(reviews);
      if (version === updated) return;
      const scrollLeft = track?.scrollLeft ?? 0;
      results.innerHTML = reviews.length
        ? `<div class="review-track${reviews.length === 1 ? ' review-track-single' : reviews.length === 2 ? ' review-track-pair' : ''}" dir="ltr">${reviews.map(review => reviewCard(review)).join('')}</div>`
        : `<div class="review-invitation"><p>${reviewLabelMarkup('empty')}</p><a class="text-link" href="${CHANNELS.maps}" target="_blank" rel="noopener noreferrer">${reviewLabelMarkup('google')} ${externalArrow}</a></div>`;
      track = results.querySelector<HTMLElement>('.review-track') ?? undefined;
      if (track) {
        track.scrollLeft = scrollLeft;
        track.addEventListener('scroll', syncControls, { passive:true });
      }
      syncControls();
      version = updated;
    } catch {
      results.innerHTML = `<p role="status">${reviewLabelMarkup('unavailable')}</p>`;
      version = undefined;
      track = undefined;
      syncControls();
    } finally { pending = false; }
  }
  nav.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-review-step]');
    const card = track?.firstElementChild;
    if (!track || !card || !button) return;
    const distance = card.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap);
    track.scrollBy({ left: Number(button.dataset.reviewStep) * distance, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  document.addEventListener('mooncrab-language-change', updateLabels);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('focus', () => void refresh());
  window.setInterval(() => void refresh(), 60_000);
  updateLabels();
  void refresh();
}
