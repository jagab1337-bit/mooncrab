import { randomUUID } from 'node:crypto';
import { authorizeAdmin, sameOrigin } from './admin-auth.ts';
import { configured, createRedisCommand, isValidDate, manilaDate, setHeaders, type ApiRequest, type ApiResponse, type HandlerOptions } from './availability.ts';
import { decrypt } from './private-files.ts';
import { shortText, uuidPattern } from './workspace-records.ts';
import { REVIEW_SOURCES, REVIEW_STATUSES, MAX_REVIEW_IMAGE_BYTES, type PublicReview, type ReviewRecord, type ReviewSource, type ReviewStatus } from '../shared/reviews.ts';

const INDEX = 'mooncrab:reviews:v1';
const ASSET = 'mooncrab:reviews:image:';
const MAX_BYTES = 48 * 1024 * 1024;
const MAX_RECORDS = 100;

export const SAVE_REVIEWS = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
if ARGV[3] ~= '' then
  redis.call('SET', KEYS[2], ARGV[3])
  redis.call('SET', KEYS[3], ARGV[4])
  redis.call('SET', KEYS[4], ARGV[5])
end
redis.call('SET', KEYS[1], ARGV[2])
if ARGV[6] == 'replace' then redis.call('DEL', KEYS[6], KEYS[7]) end
return 1
`;

export const READ_REVIEW_IMAGE = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
for _, review in ipairs(cjson.decode(raw)) do
  if review.id == ARGV[1] then
    if review.photo and review.photo.id == ARGV[2] and (ARGV[3] == 'admin' or review.status == 'Published') then
      return redis.call('GET', KEYS[2])
    end
    if ARGV[3] == 'admin' and ARGV[4] == 'original' and review.originals then
      for _, original in ipairs(review.originals) do
        if original.id == ARGV[2] then return redis.call('GET', KEYS[2]) end
      end
    end
  end
end
return nil
`;

const initialReview: ReviewRecord = {
  id: '41989ed6-1f4a-4e18-a246-8235ca4d477a',
  revision: '1ad55747-b2d4-430b-aef0-f634e00d793f',
  name: 'Nikki', source: 'Airbnb', rating: 5, scale: 5, date: '', featured: false, status: 'Published', approved: true,
  url: 'https://www.airbnb.com/rooms/1817049407925156122',
  text: 'Had a wonderful stay! The place was clean and comfortable. Kile was incredibly accommodating and communication was excellent from booking until check-out. Everything was smooth and hassle-free.\n\nYou can tell the host put thought and effort into making guests feel welcome. Definitely a great place to stay and I’m happy to be among the first guests to experience it. Looking forward to seeing this Airbnb grow! Highly recommended and thank you Kile I can’t wait to be back 🤍',
  notes: 'Owner-provided Airbnb review. Original date was relative, so no date was inferred.',
  alt: '', cropX: 50, cropY: 50,
};

const idValid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);
const statuses = new Set<string>(REVIEW_STATUSES);
const sources = new Set<string>(REVIEW_SOURCES);
const byFeatured = (a: ReviewRecord, b: ReviewRecord) => Number(b.featured) - Number(a.featured);
const privateText = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\s().-]*){8,15}|(?:booking|reservation)\s+(?:reference|confirmation|code|id)\s*[:#]\s*\w+/i;

function sourceUrl(value: string, source: ReviewSource) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password
      || [...url.searchParams.keys()].some(key => /^(token|auth|email|phone|pin|password|booking_?id|reservation_?id)$/i.test(key))) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (source === 'Airbnb' && !['airbnb.com','airbnb.co.uk','airbnb.com.ph','airbnb.ca','airbnb.com.au','airbnb.fr','airbnb.de','airbnb.it','airbnb.es'].includes(host)) return null;
    if (source === 'Booking.com' && !['booking.com','secure.booking.com'].includes(host)) return null;
    if (source === 'Google' && !['google.com','maps.google.com','maps.app.goo.gl','g.page','share.google'].includes(host)) return null;
    if (source === 'WhatsApp') return null;
    return url.href;
  } catch { return null; }
}

function validateReview(record: unknown, now: Date) {
  if (!record || typeof record !== 'object') return null;
  const { name, text, source, sourceName = '', date, rating, scale, url, featured, notes, alt, cropX, cropY } = record as Record<string, unknown>;
  if (!shortText(name, 100) || !shortText(text, 4000) || !shortText(notes, 1500) || !shortText(alt, 180) || !shortText(url, 400) || !shortText(sourceName, 80)
    || typeof source !== 'string' || !sources.has(source) || typeof date !== 'string' || (date && (!isValidDate(date) || date > manilaDate(now)))
    || (scale !== 5 && scale !== 10) || (rating !== null && (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0 || rating > scale))
    || typeof featured !== 'boolean' || ![cropX, cropY].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100)) return null;
  const link = sourceUrl(url.trim(), source as ReviewSource);
  if (link === null) return null;
  return { name: name.trim(), text: text.trim(), source: source as ReviewSource, ...(source === 'Other' && sourceName.trim() ? { sourceName:sourceName.trim() } : {}),
    date, rating, scale: scale as 5 | 10, url: link, featured, notes: notes.trim(),
    alt: alt.trim(), cropX: cropX as number, cropY: cropY as number };
}

function publicReview(review: ReviewRecord): PublicReview {
  const { id, name, text, source, sourceName, date, rating, scale, url, featured, alt, cropX, cropY, photo } = review;
  return { id, name, text, source, sourceName, date, rating, scale, url, featured, alt, cropX, cropY,
    ...(photo ? { photo: { id: photo.id, width: photo.width, height: photo.height } } : {}) };
}

function reviewBytes({ photo, originals }: Pick<ReviewRecord, 'photo' | 'originals'>) {
  return (photo?.bytes ?? 0) + (originals ?? []).reduce((sum, item) => sum + item.bytes, 0);
}

function imageKeys(id?: string) {
  return ['original', 'full', 'thumb'].map(kind => ASSET + (id ?? 'unused') + ':' + kind);
}

export type ReviewResponse = ApiResponse & { end?: (body: Buffer) => void };

export function createReviewHandler(admin: boolean, options: HandlerOptions = {}) {
  const env = options.env ?? process.env;
  const command = options.command ?? createRedisCommand(env);
  return async (req: ApiRequest, res: ReviewResponse) => {
    setHeaders(res);
    if (req.method !== 'GET' && !(admin && req.method === 'POST')) {
      res.setHeader('Allow', admin ? 'GET, POST' : 'GET');
      res.status(405).json({ error: 'Method not allowed.' }); return;
    }
    if (admin && (!await authorizeAdmin(req, env, command) || (req.method === 'POST' && !sameOrigin(req)))) {
      res.status(401).json({ error: 'Sign in through the owner dashboard.' }); return;
    }
    if (!configured(env)) { res.status(503).json({ error: 'Review storage is unavailable.' }); return; }
    const key = Buffer.from(env.ADMIN_WORKSPACE_ENCRYPTION_KEY ?? '', 'base64url');
    const fail = (status: number, error: string) => res.status(status).json({ error });
    try {
      const image = req.query?.reviewImage;
      if (image !== undefined) {
        const { size, asset } = req.query!;
        if (!idValid(image) || !idValid(asset) || !(size === 'thumb' || size === 'full' || (admin && size === 'original'))) {
          fail(404, 'Review image not found.'); return;
        }
        const data = await command(['EVAL', READ_REVIEW_IMAGE, 2, INDEX, ASSET + asset + ':' + size, image, asset, admin ? 'admin' : 'public', size]);
        if (typeof data !== 'string') { fail(404, 'Review image not found.'); return; }
        if (admin) {
          if (size === 'original' && key.length !== 32) { fail(503, 'Private image storage is unavailable.'); return; }
          res.status(200).json({ data: size === 'original' ? decrypt(data, key, asset).toString('base64') : data });
        } else {
          res.setHeader('Content-Type', 'image/webp');
          res.status(200);
          res.end!(Buffer.from(data, 'base64'));
        }
        return;
      }
      const raw = await command(['GET', INDEX]);
      const reviews: ReviewRecord[] = typeof raw === 'string' ? JSON.parse(raw) : [{ ...initialReview }];
      const view = () => ({ reviews: [...reviews].sort(byFeatured), maxImageBytes: MAX_REVIEW_IMAGE_BYTES, imageUploads: key.length === 32 });
      if (req.method === 'GET') {
        res.status(200).json(admin ? view() : { reviews: reviews.filter(review => review.status === 'Published').sort(byFeatured).map(publicReview) });
        return;
      }
      if (typeof req.headers['content-type'] !== 'string' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'])) {
        fail(415, 'Send a JSON request.'); return;
      }
      const body = req.body as Record<string, unknown> | undefined;
      if (!idValid(body?.id)) { fail(400, 'Invalid review identifier.'); return; }
      const index = reviews.findIndex(review => review.id === body.id);
      const previous = reviews[index];
      if (body.action === 'create' && previous) { res.status(200).json(view()); return; }
      if (body.action !== 'create' && (!previous || body.revision !== previous.revision)) {
        fail(409, 'This review changed. Refresh the list before trying again.'); return;
      }
      let prepared: Awaited<ReturnType<typeof import('./review-images.ts').prepareReviewImage>> | undefined;
      let removeOld = false;
      if (body.action === 'create' || body.action === 'save') {
        const draft = validateReview(body.record, (options.now ?? (() => new Date()))());
        if (!draft || typeof body.status !== 'string' || !statuses.has(body.status)
          || (body.status !== 'Draft' && body.status !== 'Published' && body.status !== previous?.status)) {
          fail(400, 'Check the review information, source link, rating and date.'); return;
        }
        if (!previous && reviews.length >= MAX_RECORDS) { fail(409, 'The review library is full.'); return; }
        if (body.image !== undefined) {
          if (key.length !== 32) { fail(503, 'Private image storage is unavailable.'); return; }
          if (typeof body.image !== 'object' || body.image === null) { fail(400, 'Invalid review image.'); return; }
          const { data, redactions } = body.image as Record<string, unknown>;
          try { prepared = await (await import('./review-images.ts')).prepareReviewImage(data, redactions, key); }
          catch { fail(400, 'Choose a single JPG, PNG or WebP up to 2 MiB and 20 megapixels.'); return; }
        }
        const photo = prepared?.photo ?? (body.removeImage === true ? undefined : previous?.photo);
        if (!draft.text && !photo) { fail(400, 'Add review text or a photo.'); return; }
        if (photo && !draft.alt) { fail(400, 'Describe the image for visitors using screen readers.'); return; }
        removeOld = !!previous?.photo && previous.photo.id !== photo?.id;
        const originals = [...(previous?.originals ?? [])];
        if (removeOld && previous?.photo) {
          const { id, mime, originalBytes } = previous.photo;
          originals.push({ id, mime, bytes: originalBytes });
        }
        const storage = reviews.reduce((sum, review) => review.id === body.id ? sum : sum + reviewBytes(review), 0)
          + reviewBytes({ photo, originals });
        if (storage > MAX_BYTES) { fail(409, 'Review image storage is full.'); return; }
        const status = body.status as ReviewStatus;
        const approved = body.approved === true;
        if (status === 'Published' && !approved) { fail(400, 'Confirm permission and check for private details before publishing.'); return; }
        if (status === 'Published' && privateText.test([draft.name, draft.text, draft.alt, draft.sourceName].join(' ').replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, ''))) {
          fail(400, 'Remove phone numbers, email addresses and booking references from the public fields.'); return;
        }
        const record: ReviewRecord = { ...draft, id: body.id, revision: randomUUID(), status, approved, photo, ...(originals.length ? { originals } : {}) };
        if (previous) reviews[index] = record;
        else reviews.push(record);
      } else if (body.action === 'status' && typeof body.status === 'string' && statuses.has(body.status) && body.status !== 'Published') {
        reviews[index] = { ...previous, revision: randomUUID(), status: body.status as ReviewStatus };
      } else if (body.action === 'move' && (body.direction === -1 || body.direction === 1)) {
        let other = index + body.direction;
        while (reviews[other] && (reviews[other].featured !== previous.featured || reviews[other].status === 'Archived')) other += body.direction;
        if (!reviews[other] || previous.status === 'Archived') { res.status(200).json(view()); return; }
        [reviews[index], reviews[other]] = [{ ...reviews[other], revision: randomUUID() }, { ...previous, revision: randomUUID() }];
      } else { fail(400, 'Choose a valid review action.'); return; }
      const stored = await command(['EVAL', SAVE_REVIEWS, 7, INDEX, ...imageKeys(prepared?.photo.id), ...imageKeys(previous?.photo?.id),
        typeof raw === 'string' ? raw : '', JSON.stringify(reviews), prepared?.original ?? '', prepared?.full ?? '', prepared?.thumb ?? '',
        removeOld ? 'replace' : 'keep']);
      if (stored !== 1) { fail(409, 'The review library changed. Refresh before trying again.'); return; }
      res.status(200).json(view());
    } catch {
      fail(503, 'The review library could not be reached. Try again shortly.');
    }
  };
}
