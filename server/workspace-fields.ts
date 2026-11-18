import { shortText, uuidPattern } from './workspace-records.ts';

export function httpsUrl(value: unknown): value is string {
  if (!shortText(value, 1000)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

export function validFileIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 50
    && value.every(id => typeof id === 'string' && uuidPattern.test(id)) && new Set(value).size === value.length;
}

export function validLinks(value: unknown): value is { label: string; url: string }[] {
  return Array.isArray(value) && value.length <= 20 && value.every(link => link && shortText(link.label, 120) && link.label.trim() && httpsUrl(link.url));
}
