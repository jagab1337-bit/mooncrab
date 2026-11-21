import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const logo = readFileSync(new URL('../public/images/mooncrab-logo-email-solid.png', import.meta.url));

export function inlineMoonCrabLogo(html: string) {
  const cid = `mooncrab-logo.${randomUUID()}@mooncrabsiargao.com`;
  const brandedHtml = html.replace(
    /src="https:\/\/mooncrabsiargao\.com\/(?:images\/mooncrab-logo-email-solid|email-signature\/mooncrab-logo-solid)\.png"/g,
    `src="cid:${cid}"`,
  );
  return {
    html: brandedHtml,
    attachments: [{ filename: 'moon-crab-logo.png', content: logo, contentType: 'image/png', cid, contentDisposition: 'inline' }],
  };
}
