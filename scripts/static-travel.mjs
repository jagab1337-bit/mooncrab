import fs from 'node:fs/promises';
import path from 'node:path';
import { destinations, directionsUrl } from '../src/destinations.ts';
import { destinationPhotos } from '../src/destination-photos.ts';
const origin='https://mooncrabsiargao.com';
const root='/explore-siargao';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const template=await fs.readFile('dist/index.html','utf8');
const bookingTitle = 'Book Your Stay | Moon Crab Siargao';
const bookingDescription = 'Check live availability and request a stay at KASAG, Mooncrab’s private room in General Luna, Siargao.';

function meta(html, attribute, key, value) {
  return html.replace(new RegExp(`<meta ${attribute}="${key}"[^>]*>`), `<meta ${attribute}="${key}" content="${escape(value)}" />`);
}

function pageMetadata(title, description, route) {
  const url = origin + route;
  const html = template.replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}" />`);
  const primary = [['name','description',description], ['property','og:title',title], ['property','og:description',description],
    ['property','og:url',url], ['name','twitter:title',title], ['name','twitter:description',description]];
  return primary.reduce((document, [attribute, key, value]) => meta(document, attribute, key, value), html);
}

await fs.writeFile('dist/booking.html', pageMetadata(bookingTitle, bookingDescription, '/booking'));

for(const guide of [null,...destinations]){
  const route=guide?`${root}/${guide.slug}`:root;
  const title=guide?`${guide.title} · Explore Siargao | Mooncrab`:'Explore Siargao · Island travel guides | Mooncrab';
  const description=guide?guide.teaser:'Eight considered guides to Siargao, with practical routes from Moon Crab in General Luna, local tips, and island photography.';
  const photos=guide?destinationPhotos[guide.slug]||[]:[];
  const credit=photo=>`<small>Photo: <a href="${escape(photo.sourceUrl)}">${escape(photo.author)}</a> · <a href="${escape(photo.licenseUrl)}">${escape(photo.license)}</a></small>`;
  const list=items=>`<ul>${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`;
  const body=guide?`<p class="eyebrow">${escape(guide.category)}</p><h1>${escape(guide.title)}</h1><p>${escape(guide.introduction)}</p><h2>Getting there from Moon Crab</h2><p>Start: Moon Crab Siargao, Pangitlogan Street, General Luna.</p><p>${escape(guide.route.transport)}</p>${list(guide.route.steps)}<p>Travel times vary with traffic, weather, sea conditions, and operator arrangements.</p><a href="${escape(directionsUrl(guide))}">Get Directions from Moon Crab</a><h2>A little closer look</h2><p>${escape(guide.description)}</p><h2>Things to do</h2>${list(guide.activities)}<h2>Local tips</h2>${list(guide.tips)}<h2>A look around</h2>${photos.map(photo=>`<figure><a href="${escape(photo.fullSrc)}"><img src="${escape(photo.src)}" alt="${escape(photo.alt)}" width="${photo.width}" height="${photo.height}"></a><figcaption>${credit(photo)}</figcaption></figure>`).join('')}<h2>More island days</h2>${list(guide.related.map(slug=>destinations.find(item=>item.slug===slug)).filter(Boolean).map(item=>item.title))}<p>${guide.related.map(slug=>`<a href="${root}/${slug}">${escape(destinations.find(item=>item.slug===slug)?.title||slug)}</a>`).join(' · ')}</p>`:`<p class="eyebrow">FIELD NOTES FROM OUR ISLAND</p><h1>Explore Siargao</h1><p>${escape(description)}</p>${destinations.map(item=>`<article><h2><a href="${root}/${item.slug}">${escape(item.title)}</a></h2><p>${escape(item.teaser)}</p></article>`).join('')}`;
  const structured=guide?{'@context':'https://schema.org','@type':'BlogPosting',headline:guide.title,description,datePublished:'2026-11-18',dateModified:'2026-11-18',mainEntityOfPage:origin+route,image:photos.map(photo=>origin+photo.src),author:{'@type':'Organization',name:'Moon Crab Siargao',url:origin},publisher:{'@type':'Organization',name:'Moon Crab Siargao',url:origin}}:{'@context':'https://schema.org','@type':'CollectionPage',name:'Explore Siargao',url:origin+route};
  const html=pageMetadata(title, description, route)
    .replace('</head>',`<script id="explore-structured-data" type="application/ld+json">${JSON.stringify(structured).replace(/</g,'\\u003c')}</script></head>`).replace('<div id="app"></div>',`<div id="app"><header class="header"><div class="header-inner"><a href="/"><img class="brand-logo" src="/images/mooncrab-logo.webp?v=20261119" alt="Moon Crab Siargao" width="1200" height="960"></a><a href="/booking">Plan your stay</a></div></header><main id="main" class="section wrap">${body}<p><a href="/booking">Make Moon Crab your island home · View our room</a></p><p><a href="${root}">All Siargao guides</a> · <a href="/">Moon Crab Siargao</a></p></main></div>`);
  const destination=path.join('dist',route.slice(1),'index.html');await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,html);
}
console.log('Generated nine travel documents with static content, metadata, canonical URLs and structured data.');
