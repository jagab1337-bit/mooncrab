import type { HandlerOptions } from './availability.ts';
import { httpsUrl, validFileIds, validLinks } from './workspace-fields.ts';
import { shortText, workspaceRecords, type WorkspaceRecord } from './workspace-records.ts';

const cleanLinks = (links: {label:string; url:string}[]) => links.map(({label,url}) => ({label,url}));

function validateNote(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const { title, body, fileIds, links } = value as Record<string, unknown>;
  if (!shortText(title, 120) || !title.trim() || !shortText(body, 12000)
    || !validFileIds(fileIds) || !validLinks(links)) return null;
  return { title:title.trim(), body, fileIds, links:cleanLinks(links) };
}

function asNote(record: WorkspaceRecord): WorkspaceRecord {
  const row = record as WorkspaceRecord & Record<string, unknown>;
  if (typeof row.title === 'string') return record;
  const body = [
    row.description, row.notes,
    row.folder ? `Folder: ${row.folder}` : '',
    row.address ? `Address: ${row.address}` : '',
    row.contacts ? `Contacts: ${row.contacts}` : '',
    httpsUrl(row.mapsUrl) ? `Map: ${row.mapsUrl}` : '',
  ].filter(value => typeof value === 'string' && value.trim()).join('\n\n');
  const links = validLinks(row.links) ? cleanLinks(row.links) : [];
  if (httpsUrl(row.mapsUrl) && links.length < 20 && !links.some(link => link.url === row.mapsUrl)) {
    links.push({label:'Map',url:row.mapsUrl});
  }
  return { id:row.id, revision:row.revision, createdAt:row.createdAt, updatedAt:row.updatedAt,
    title:row.name, body, links, fileIds:row.fileIds } as WorkspaceRecord;
}

// Keep the original collection and IDs so former property notes and files remain accessible.
export const createNotesHandler = (options?: HandlerOptions) => workspaceRecords('properties', validateNote, options, undefined, {
  view: state => ({ records:state.records.map(asNote) }),
});
