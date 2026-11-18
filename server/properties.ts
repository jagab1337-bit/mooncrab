import type { HandlerOptions } from './availability.ts';
import { shortText, uuidPattern, workspaceRecords } from './workspace-records.ts';

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

function validateProperty(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const property = value as Record<string, unknown>;
  const { name, address, mapsUrl, description, contacts, notes, folder, fileIds, links } = property;
  if (!shortText(name, 120) || !name.trim() || !shortText(address, 500) || !shortText(description, 4000)
    || !shortText(contacts, 1000) || !shortText(notes, 5000) || !shortText(folder, 80)
    || (mapsUrl !== '' && !httpsUrl(mapsUrl)) || !validFileIds(fileIds) || !validLinks(links)) return null;
  return { name: name.trim(), address, mapsUrl, description, contacts, notes, folder, fileIds, links: links.map(({label, url}) => ({label, url})) };
}
export const createPropertiesHandler = (options?: HandlerOptions) => workspaceRecords('properties', validateProperty, options);
