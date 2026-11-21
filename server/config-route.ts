import { createPublicConfigHandler } from './business-settings.ts';
import { createReviewHandler, type ReviewResponse } from './reviews.ts';
import type { ApiRequest, HandlerOptions } from './availability.ts';

export function createConfigRoute(options: HandlerOptions = {}) {
  const config = createPublicConfigHandler(options);
  const reviews = createReviewHandler(false, options);
  return (req: ApiRequest, res: ReviewResponse) =>
    req.query?.reviews === '1' || req.query?.reviewImage !== undefined ? reviews(req, res) : config(req, res);
}
