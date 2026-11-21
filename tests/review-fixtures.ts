import assert from 'node:assert/strict';
import { READ_REVIEW_IMAGE, SAVE_REVIEWS, type ReviewResponse } from '../server/reviews.ts';
import type { HandlerOptions, RedisCommand } from '../server/availability.ts';
import type { ReviewRecord } from '../shared/reviews.ts';

export const reviewHeaders = { authorization:'Bearer review-test', origin:'https://mooncrabsiargao.com', host:'mooncrabsiargao.com', 'content-type':'application/json' };

export function reviewStorage() {
  const values = new Map<string, string>();
  const command: RedisCommand = async args => {
    if (args[0] === 'GET') return values.get(String(args[1])) ?? null;
    if (args[0] === 'EVAL' && args[1] === SAVE_REVIEWS) {
      const [index, original, full, thumb, oldOriginal, oldFull, oldThumb, before, after, origData, fullData, thumbData, replace] = args.slice(3).map(String);
      if ((values.get(index) ?? '') !== before) return 0;
      if (origData) { values.set(original,origData); values.set(full,fullData); values.set(thumb,thumbData); }
      values.set(index,after);
      if (replace === 'replace') [oldFull,oldThumb].forEach(key => values.delete(key));
      return 1;
    }
    if (args[0] === 'EVAL' && args[1] === READ_REVIEW_IMAGE) {
      const [index, key, id, asset, visibility, size] = args.slice(3).map(String);
      const reviews = JSON.parse(values.get(index) ?? '[]') as ReviewRecord[];
      const allowed = reviews.some(record => record.id === id &&
        ((record.photo?.id === asset && (visibility === 'admin' || record.status === 'Published'))
        || (visibility === 'admin' && size === 'original' && record.originals?.some(photo => photo.id === asset))));
      return allowed ? values.get(key) ?? null : null;
    }
    assert.fail('Unexpected command ' + args[0]);
  };
  const options: HandlerOptions = {
    command, env: {
      KV_REST_API_URL:'https://example.invalid', KV_REST_API_TOKEN:'fake',
      BOOKING_ADMIN_TOKEN:'review-test', ADMIN_WORKSPACE_ENCRYPTION_KEY:Buffer.alloc(32,29).toString('base64url'),
    },
  };
  return { options, values };
}

export function reviewResponse() {
  const headers: Record<string, string> = {};
  const response: ReviewResponse & { code: number; headers: Record<string, string>; body: unknown } = {
    code:200, headers, body:undefined as unknown,
    setHeader(name: string, value: string) { headers[name] = value; },
    status(code: number) { response.code = code; return response; },
    json(body: unknown) { response.body = body; },
    end(body: Buffer) { response.body = body; },
  };
  return response;
}
