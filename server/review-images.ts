import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { MAX_REVIEW_IMAGE_BYTES, type Redaction, type ReviewRecord } from '../shared/reviews.ts';
import { encrypt } from './private-files.ts';

const MAX_PIXELS = 20_000_000;

function validRedaction(value: unknown): value is Redaction {
  if (!value || typeof value !== 'object') return false;
  const { x, y, width, height } = value as Redaction;
  return [x, y, width, height].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
    && width > 0 && height > 0 && x + width <= 1.000001 && y + height <= 1.000001;
}

export async function prepareReviewImage(data: unknown, redactions: unknown, key: Buffer) {
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_REVIEW_IMAGE_BYTES / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || !Array.isArray(redactions) || redactions.length > 20
    || !redactions.every(validRedaction)) throw new Error('Choose a JPG, PNG or WebP up to 2 MiB with up to 20 redactions.');
  const original = Buffer.from(data, 'base64');
  if (original.length > MAX_REVIEW_IMAGE_BYTES || original.toString('base64') !== data) throw new Error('Invalid image data.');
  const decoder = sharp(original, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
  const metadata = await decoder.metadata();
  const format = metadata.format;
  if (!format || !['jpeg', 'png', 'webp'].includes(format) || (metadata.pages ?? 1) > 1) throw new Error('Choose a single JPG, PNG or WebP image.');
  if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 12_000) throw new Error('Image dimensions are too large.');
  const { data: pixels, info } = await decoder.autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const opaque = Buffer.from([17, 17, 17, 255]);
  for (const rect of redactions) {
    const left = Math.min(width - 1, Math.floor(rect.x * width));
    const top = Math.min(height - 1, Math.floor(rect.y * height));
    const right = Math.min(width, Math.ceil((rect.x + rect.width) * width));
    const bottom = Math.min(height, Math.ceil((rect.y + rect.height) * height));
    for (let y = top; y < bottom; y++) pixels.fill(opaque, (y * width + left) * channels, (y * width + right) * channels);
  }
  const display = sharp(pixels, { raw: { width, height, channels } });
  let full = await display.clone().webp({ quality: 92 }).toBuffer();
  if (full.length > MAX_REVIEW_IMAGE_BYTES) full = await display.clone().webp({ quality: 78 }).toBuffer();
  if (full.length > MAX_REVIEW_IMAGE_BYTES) throw new Error('Choose an image with a smaller file size or fewer pixels.');
  const thumb = await display.resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const id = randomUUID();
  const photo: NonNullable<ReviewRecord['photo']> = {
    id, width, height, mime: 'image/' + format, redactions,
    bytes: original.length + full.length + thumb.length, originalBytes: original.length,
  };
  return { photo, original: encrypt(original, key, id), full: full.toString('base64'), thumb: thumb.toString('base64') };
}
