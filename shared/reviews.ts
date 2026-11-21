export const REVIEW_SOURCES = ['Airbnb', 'Booking.com', 'Google', 'WhatsApp', 'Direct', 'Other'] as const;
export const REVIEW_STATUSES = ['Draft', 'Published', 'Hidden', 'Archived'] as const;
export const MAX_REVIEW_IMAGE_BYTES = 2 * 1024 * 1024;

export type ReviewSource = typeof REVIEW_SOURCES[number];
export type ReviewStatus = typeof REVIEW_STATUSES[number];
export type Redaction = { x: number; y: number; width: number; height: number };
export type ReviewOriginal = { id: string; bytes: number; mime: string };
export type ReviewPhoto = { id: string; width: number; height: number };
export type PublicReview = {
  id: string;
  name: string;
  text: string;
  source: ReviewSource;
  sourceName?: string;
  date: string;
  rating: number | null;
  scale: 5 | 10;
  url: string;
  featured: boolean;
  photo?: ReviewPhoto;
  alt: string;
  cropX: number;
  cropY: number;
};
export type ReviewRecord = PublicReview & {
  status: ReviewStatus;
  notes: string;
  approved: boolean;
  revision: string;
  photo?: ReviewPhoto & { bytes: number; mime: string; originalBytes: number; redactions: Redaction[] };
  originals?: ReviewOriginal[];
};

export function reviewImageUrl(review: PublicReview, kind: 'thumb' | 'full'): string {
  return '/api/config?reviewImage=' + encodeURIComponent(review.id) + '&asset=' + encodeURIComponent(review.photo?.id ?? '') + '&size=' + kind;
}
