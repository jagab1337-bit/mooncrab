# Explore Siargao

Eight original destination guides are implemented under `/explore-siargao` in the existing Vite application. Each introduction contains 100–180 words. All route links start at Moon Crab’s owner-supplied, verified coordinates `9.7925151,126.1527111`.

## Transport policy

- Cloud 9, Magpupungko, Maasin River, and the General Luna visitor area use road directions from Moon Crab.
- Guyam, Daku, and Naked Island use a road route to the General Luna tourism port / wharf, followed by an explicitly described boat journey. No direct driving route to an island is offered.
- Sugba Lagoon uses a road route to the Del Carmen Tourism Center, followed by a local pump boat. Its directions link ends on the mainland.
- Exact distance and travel-time figures from the property were not independently established. No approximate numbers are invented. The guides explain variability and link to live directions using the actual origin.
- Fees, hours, trip schedules, operator availability, tides, and current access are not guaranteed. Guests are directed to the relevant local operators. Magpupungko’s low-tide requirement and boat/weather dependencies are explicit.
- Older Maasin imagery can be misleading: the formerly famous leaning palm fell in February 2023. The guide does not promise a rope swing or that former photo opportunity.

## Content and SEO

`src/destinations.ts` contains original copy, activities, practical tips, related-guide slugs, and fact-check sources. Source links appear in each guide’s disclosure. No blog text is copied. `src/explore.ts` sets unique page titles, descriptions, canonical links, Open Graph tags, and BlogPosting structured data. The full collection supports category filters and text search. The root build integration should prerender these routes for search engines that do not run JavaScript.

## Photography

See `DESTINATION-PHOTO-CREDITS.md` and `destination-photos.json` for per-file creators, original URLs, licences, and transformations. Images depict the actual destination and are genuine photographs. Required attribution is visible alongside each article image. Full images preserve their original frame. Display cards use CSS covers; their article galleries link to uncropped source images.
