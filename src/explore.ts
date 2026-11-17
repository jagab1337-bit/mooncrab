import { arrow, book, header, footer, home } from './site.ts';
import { destinations, directionsUrl } from './destinations.ts';
import type { DestinationGuide } from './destinations.ts';
import { destinationPhotos } from './destination-photos.ts';
import './explore.css';

const root = '/explore-siargao';
const siteOrigin = 'https://mooncrabsiargao.com';
const published = '2026-11-18';
function escape(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
const link = (guide: DestinationGuide) => `${root}/${guide.slug}`;
const photos = (guide: DestinationGuide) => destinationPhotos[guide.slug] || [];

function photograph(guide: DestinationGuide, index = 0, eager = false): string {
  const photo = photos(guide)[index];
  if (!photo) return '';
  return `<a class="explore-photo-link" href="${escape(photo.fullSrc || photo.src)}" data-photo-viewer data-caption="${escape(photo.alt)}" aria-label="View full photo: ${escape(photo.alt)}"><img src="${escape(photo.src)}" alt="${escape(photo.alt)}" width="${photo.width}" height="${photo.height}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'}><span class="explore-photo-expand" aria-hidden="true">${arrow}</span></a>`;
}

function photoCredit(guide: DestinationGuide, index = 0): string {
  const photo = photos(guide)[index];
  if (!photo) return '';
  return `<span class="explore-credit">Photo: <a href="${escape(photo.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escape(photo.author)}</a> · <a href="${escape(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escape(photo.license)}</a></span>`;
}

function card(guide: DestinationGuide, index = 0): string {
  const photo = photos(guide)[0];
  return `<article class="destination-card" data-category="${escape(guide.category)}" data-search="${escape(`${guide.title} ${guide.category} ${guide.teaser}`.toLowerCase())}"><a class="destination-card-photo" href="${link(guide)}" aria-label="Read the ${escape(guide.title)} guide">${photo ? `<img src="${escape(photo.src)}" alt="${escape(photo.alt)}" width="${photo.width}" height="${photo.height}" loading="lazy">` : `<span class="destination-card-illustration" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>`}<span class="destination-card-category">${escape(guide.category)}</span></a><div class="destination-card-credit">${photoCredit(guide)}</div><div class="destination-card-copy"><h3><a href="${link(guide)}">${escape(guide.title)}</a></h3><p>${escape(guide.teaser)}</p><a class="text-link" href="${link(guide)}">Discover this place ${arrow}</a></div></article>`;
}

export function renderExplorePreview(): string {
  const shortNames: Record<string,string> = { 'cloud-9':'Cloud 9', 'guyam-island':'Guyam Island', 'daku-island':'Daku Island', 'naked-island':'Naked Island', 'sugba-lagoon':'Sugba Lagoon', 'magpupungko-rock-pools':'Magpupungko', 'maasin-river':'Maasin River', 'general-luna':'General Luna' };
  return `<section class="section explore-preview" id="explore"><div class="wrap"><div class="section-top"><div><p class="eyebrow">EIGHT PLACES. YOUR KIND OF ISLAND DAY.</p><h2>Explore <em>Siargao.</em></h2></div><div><p>First waves, hidden pools, and a boat ride away.<br>Find the day that feels like you.</p><a class="text-link" href="${root}">All eight island guides ${arrow}</a></div></div>
    <div class="island-carousel" data-explore-carousel role="region" aria-roledescription="carousel" aria-label="Explore Siargao destinations">
      <p class="carousel-hint" id="explore-carousel-help">Swipe through the island, or choose a photograph below.</p>
      <div class="island-carousel-track" id="explore-carousel-track" tabindex="0" aria-label="Destination guides" aria-describedby="explore-carousel-help">
        ${destinations.map((guide,index)=>{const photo=photos(guide)[0];return `<article class="island-carousel-slide" role="group" aria-roledescription="slide" aria-label="${index+1} of ${destinations.length}: ${escape(guide.title)}" data-title="${escape(guide.title)}"><figure class="island-carousel-photo"><a href="${link(guide)}" aria-label="Read the ${escape(guide.title)} guide"><img src="${escape(photo.src)}" alt="${escape(photo.alt)}" width="${photo.width}" height="${photo.height}" loading="lazy"></a><figcaption>${photoCredit(guide)}</figcaption></figure><div class="island-carousel-copy"><p class="eyebrow">${escape(guide.category)}</p><h3><a href="${link(guide)}">${escape(guide.title)}</a></h3><p>${escape(guide.teaser)}</p><a class="text-link" href="${link(guide)}">Discover this place ${arrow}</a></div></article>`;}).join('')}
      </div>
      <div class="island-carousel-navigation"><p class="island-carousel-status" role="status" aria-live="polite" aria-atomic="true"><span data-carousel-count>01 / 08</span><span data-carousel-title>${escape(destinations[0].title)}</span></p><div class="island-carousel-arrows"><button type="button" aria-label="Previous destination" aria-controls="explore-carousel-track" data-carousel-previous disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20 12H4m6-6-6 6 6 6"/></svg></button><button type="button" aria-label="Next destination" aria-controls="explore-carousel-track" data-carousel-next><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button></div></div>
      <div class="island-carousel-thumbnails" role="group" aria-label="Choose a destination">${destinations.map((guide,index)=>{const photo=photos(guide)[0];return `<button class="island-carousel-thumbnail" type="button" aria-label="Show ${escape(guide.title)}" aria-controls="explore-carousel-track"${index===0?' aria-current="true"':''}><img src="${escape(photo.src)}" alt="" width="${photo.width}" height="${photo.height}" loading="lazy"><span>${shortNames[guide.slug]}</span></button>`;}).join('')}</div>
    </div></div></section>`;
}

function setMeta(title: string, description: string, path: string, image?: string): void {
  document.title = `${title} — Moon Crab Siargao`;
  for (const [key, value] of [['description', description], ['og:title', document.title], ['og:description', description], ['og:type', path === root ? 'website' : 'article'], ['og:url', `${siteOrigin}${path}`], ...(image ? [['og:image', `${siteOrigin}${image}`]] : [])]) {
    const attribute = key.startsWith('og:') ? 'property' : 'name';
    let node = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    if (!node) { node = document.createElement('meta'); node.setAttribute(attribute, key); document.head.append(node); }
    node.content = value;
  }
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
  canonical.href = `${siteOrigin}${path}`;
  document.querySelector('#explore-structured-data')?.remove();
}

function collection(app: HTMLElement): void {
  setMeta('Explore Siargao · Island travel guides', 'Eight thoughtful Siargao guides, with routes from Moon Crab, local visitor tips, genuine photography, and places to discover around General Luna.', root, photos(destinations[0])[0]?.src);
  app.innerHTML = `${header()}<main id="main" class="explore-index wrap"><div class="explore-page-intro"><div><p class="eyebrow">MOON CRAB ISLAND JOURNAL</p><h1>More island.<br><em>At your own pace.</em></h1></div><div><p>Explore Siargao 🌴</p><p>Discover the island, one adventure at a time. Start with a little curiosity; our guides take care of the practical details.</p><a class="under-link" href="${home}#location">Every journey starts at Moon Crab ${arrow}</a></div></div><section class="explore-feature" aria-label="Featured destination"><div>${photograph(destinations[0], 0, true)}<div class="explore-feature-credit">${photoCredit(destinations[0])}</div></div><div class="explore-feature-copy"><p class="eyebrow">FIRST LIGHT, FIRST WAVE</p><h2>A morning<br>at <em>Cloud 9.</em></h2><p>${escape(destinations[0].teaser)}</p><a class="text-link" href="${link(destinations[0])}">Read the guide ${arrow}</a></div></section><section class="explore-library" aria-labelledby="explore-library-title"><div class="explore-library-heading"><div><p class="eyebrow">EIGHT PLACES. PLENTY OF POSSIBILITIES.</p><h2 id="explore-library-title">Find your kind<br>of <em>island day.</em></h2></div><label class="explore-search">Find a place or activity<input id="explore-search" type="search" placeholder="Try islands, surfing, or river…" autocomplete="off"></label></div><div class="explore-filters" role="group" aria-label="Filter destinations">${['All places', 'Surf & coast', 'Island hopping', 'Nature & water', 'Town & table'].map((category, index) => `<button type="button" data-filter="${escape(category)}" aria-pressed="${index === 0}">${escape(category)}</button>`).join('')}</div><p class="explore-result-count" role="status" aria-live="polite">8 island guides</p><div class="destination-grid" id="destination-grid">${destinations.map(card).join('')}</div><p class="explore-no-results" hidden>No guides match that search. Try another place or choose “All places”.</p></section><aside class="explore-help"><div><p class="eyebrow">LET’S MAKE THE DAY EASY</p><h2>A little help<br><em>goes a long way.</em></h2></div><div><p>We can help coordinate island tours with local operators, arrange airport transfers, and ask about a motorbike at a friendlier guest rate.</p><a class="text-link" href="${book}?interest=island-tours#booking-form">Plan an island day with us ${arrow}</a></div></aside></main>${footer()}`;
  let active = 'All places';
  const input = document.querySelector<HTMLInputElement>('#explore-search')!;
  const cards = [...document.querySelectorAll<HTMLElement>('.destination-card')];
  const update = () => {
    const query = input.value.trim().toLocaleLowerCase();
    let count = 0;
    cards.forEach(item => { const show = (active === 'All places' || item.dataset.category === active) && (item.dataset.search || '').includes(query); item.hidden = !show; if (show) count++; });
    document.querySelector('.explore-result-count')!.textContent = `${count} island ${count === 1 ? 'guide' : 'guides'}`;
    (document.querySelector('.explore-no-results') as HTMLElement).hidden = count !== 0;
  };
  input.addEventListener('input', update);
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => button.addEventListener('click', () => {
    active = button.dataset.filter!;
    document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    update();
  }));
}

function article(app: HTMLElement, guide: DestinationGuide): void {
  const photoList = photos(guide);
  const path = link(guide);
  setMeta(`${guide.title} · A guide from Moon Crab`, `${guide.teaser} Plan the journey from Moon Crab Siargao with transport notes, local tips, and genuine destination photos.`, path, photoList[0]?.src);
  const related = guide.related.map(slug => destinations.find(item => item.slug === slug)!).filter(Boolean);
  app.innerHTML = `${header()}<main id="main" class="explore-article"><div class="wrap"><nav class="explore-breadcrumb" aria-label="Breadcrumb"><a href="${home}">Moon Crab</a><span aria-hidden="true">/</span><a href="${root}">Explore Siargao</a><span aria-hidden="true">/</span><span>${escape(guide.title)}</span></nav><div class="guide-heading"><p class="eyebrow">${escape(guide.eyebrow)}</p><h1>${escape(guide.title)}</h1><p>${escape(guide.teaser)}</p><div class="guide-byline"><span>${escape(guide.category)}</span><span>Moon Crab island notes</span></div></div><figure class="guide-cover">${photograph(guide, 0, true)}<figcaption>${photoCredit(guide)}</figcaption></figure><div class="guide-content"><aside class="guide-side"><p class="eyebrow">IN THIS GUIDE</p><nav aria-label="Article sections"><a href="#introduction">A little introduction</a><a href="#getting-there">From Moon Crab</a><a href="#things-to-do">Things to do</a><a href="#local-tips">Before you go</a><a href="#photo-gallery">A closer look</a></nav><a class="guide-side-directions" href="${escape(directionsUrl(guide))}" target="_blank" rel="noopener noreferrer">${guide.route.boat ? 'Route to the boat departure' : 'Open live directions'} ${arrow}</a></aside><div class="guide-body"><section id="introduction" class="guide-introduction" aria-labelledby="guide-introduction-title"><p class="eyebrow">${escape(guide.category)}</p><h2 id="guide-introduction-title">A little change<br>of <em>scenery.</em></h2><p>${escape(guide.introduction)}</p><p>${escape(guide.description)}</p></section><section class="guide-journey" id="getting-there" aria-labelledby="journey-title"><p class="eyebrow">YOUR JOURNEY, FROM OUR DOOR</p><h2 id="journey-title">Getting there<br>from <em>Moon Crab.</em></h2><dl><div><dt>Starting point</dt><dd>Moon Crab Siargao<br><small>Pangitlogan Street, Purok 5 · General Luna</small></dd></div><div><dt>Destination</dt><dd>${escape(guide.route.destination)}</dd></div><div><dt>Travel by</dt><dd>${escape(guide.route.transport)}</dd></div>${guide.route.departurePoint ? `<div><dt>Boat departure</dt><dd>${escape(guide.route.departurePoint)}</dd></div>` : ''}</dl><ol>${guide.route.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol><p class="guide-travel-note">${guide.route.boat ? 'Allow for the road transfer, registration, and boat journey. Departure times and crossing conditions vary; confirm your meeting point and return with the operator.' : 'Road conditions, traffic, and your transport choice affect the journey. Use the live map for a current route and estimate from Moon Crab’s exact pin.'}</p><a class="button" href="${escape(directionsUrl(guide))}" target="_blank" rel="noopener noreferrer">Get directions from Moon Crab ${arrow}</a>${guide.route.boat ? '<p class="guide-boat-note">The map ends at the mainland departure point. Continue to the destination by boat; there is no direct driving route.</p>' : ''}</section><section class="guide-activities" id="things-to-do"><p class="eyebrow">MAKE A LITTLE TIME FOR</p><h2>Things <em>to do.</em></h2><ul>${guide.activities.map(activity => `<li>${escape(activity)}</li>`).join('')}</ul></section><section class="guide-tips" id="local-tips"><p class="eyebrow">GOOD TO KNOW</p><h2>Before <em>you go.</em></h2><ul>${guide.tips.map(tip => `<li>${escape(tip)}</li>`).join('')}</ul></section></div></div><section class="guide-gallery" id="photo-gallery" aria-labelledby="guide-gallery-title"><div class="section-top"><div><p class="eyebrow">REAL PLACES. REAL ISLAND DAYS.</p><h2 id="guide-gallery-title">A closer <em>look.</em></h2></div><p>Select a photograph to see its full frame.</p></div><div class="guide-gallery-grid">${photoList.map((photo, index) => `<figure>${photograph(guide, index)}<figcaption><span>${escape(photo.caption)}</span>${photoCredit(guide, index)}</figcaption></figure>`).join('')}</div></section><div class="guide-source-note"><p>Plan with local advice. Access, activities, and conditions can change.</p><details><summary>Guide sources & photo credits</summary><ul>${guide.sources.map(source => `<li><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}</a></li>`).join('')}</ul><p>Original guide by Moon Crab Siargao. Researched November 18, 2026. Photo sources and reuse licences are credited alongside each image. Display copies are resized WebP; full-frame source images retain their original dimensions. No destination photograph is presented as a Moon Crab property photograph.</p></details></div><section class="guide-related" aria-labelledby="related-title"><div class="section-top"><div><p class="eyebrow">WHILE YOU’RE HERE</p><h2 id="related-title">Another kind<br>of <em>island day.</em></h2></div><a class="text-link" href="${root}">See every guide ${arrow}</a></div><div class="destination-grid">${related.map(card).join('')}</div></section></div><section class="guide-booking"><div class="wrap"><div><p class="eyebrow">MOON CRAB SIARGAO</p><h2>Make Moon Crab<br>your <em>island home.</em></h2></div><div><p>Explore Siargao by day and unwind at Moon Crab after your island adventures.</p><a class="button button-light" href="${book}">View our room ${arrow}</a></div></div></section></main>${footer()}`;
  const structured = document.createElement('script');
  structured.type = 'application/ld+json'; structured.id = 'explore-structured-data';
  structured.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: `${guide.title} · A guide from Moon Crab`, description: guide.teaser, url: `${siteOrigin}${path}`, mainEntityOfPage: `${siteOrigin}${path}`, datePublished: published, dateModified: published, author: { '@type': 'Organization', name: 'Moon Crab Siargao', url: siteOrigin }, publisher: { '@type': 'Organization', name: 'Moon Crab Siargao', url: siteOrigin }, image: photoList.map(photo => `${siteOrigin}${photo.src}`), articleSection: guide.category, inLanguage: 'en', about: { '@type': 'TouristAttraction', name: guide.title }, locationCreated: { '@type': 'Place', name: 'Moon Crab Siargao', geo: { '@type': 'GeoCoordinates', latitude: 9.7925151, longitude: 126.1527111 } } });
  document.head.append(structured);
}

export function renderExplore(app: HTMLElement, pathname = location.pathname): void {
  const slug = pathname.replace(/\/$/, '').slice(root.length).replace(/^\//, '');
  if (!slug) { collection(app); return; }
  const guide = destinations.find(item => item.slug === slug);
  if (guide) { article(app, guide); return; }
  document.title = 'Guide not found — Moon Crab Siargao';
  app.innerHTML = `${header()}<main id="main" class="wrap explore-missing"><p class="eyebrow">A LITTLE DETOUR</p><h1>That guide<br>isn’t <em>here.</em></h1><p>Find a new island day in our Siargao journal.</p><a class="button" href="${root}">Explore Siargao ${arrow}</a></main>${footer()}`;
}
