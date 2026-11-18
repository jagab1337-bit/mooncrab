import { randomUUID } from 'node:crypto';
import { authorizeAdmin, sameOrigin } from './admin-auth.ts';
import { configured, createRedisCommand, setHeaders } from './availability.ts';
import type { ApiRequest, ApiResponse, HandlerOptions } from './availability.ts';

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const shortText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export type WorkspaceRecord = { id: string; revision: string; createdAt: string; updatedAt: string };
export type WorkspaceState = { records: WorkspaceRecord[]; imports: string[]; metadata?: unknown };
type WorkspaceAction = { action?: string; id?: string; revision?: string; record?: unknown; records?: unknown[]; importId?: string };
type WorkspaceExtension = {
  view: (state: WorkspaceState) => Record<string, unknown>;
  prepare?: (state: WorkspaceState, record: Record<string, unknown>, previous: WorkspaceRecord | undefined) => Record<string, unknown> | null;
  mutate?: (state: WorkspaceState, body: WorkspaceAction) => { status: number; error: string } | null;
};

const SAVE_SCRIPT = `
local old = redis.call('GET', KEYS[1]) or ''
if old ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

export function workspaceRecords(
  section: string,
  validate: (value: unknown) => Record<string, unknown> | null,
  options: HandlerOptions = {},
  transform?: (record: Record<string, unknown>, previous: Record<string, unknown> | undefined, timestamp: string) => Record<string, unknown>,
  extension?: WorkspaceExtension,
) {
  const env = options.env ?? process.env;
  const command = options.command ?? createRedisCommand(env);
  const key = `mooncrab:workspace:${section}`;
  return async (req: ApiRequest, res: ApiResponse) => {
    setHeaders(res);
    if (!['GET', 'POST'].includes(req.method || '')) {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    if (!await authorizeAdmin(req, env, command) || (req.method === 'POST' && !sameOrigin(req))) {
      res.status(401).json({ error: 'Sign in through the owner dashboard.' });
      return;
    }
    if (!configured(env)) {
      res.status(503).json({ error: 'Workspace storage is unavailable.' });
      return;
    }
    try {
      const raw = await command(['GET', key]);
      const state: WorkspaceState = typeof raw === 'string' ? JSON.parse(raw) : { records: [], imports: [] };
      const view = () => ({ records: state.records, ...extension?.view(state) });
      if (req.method === 'GET') { res.status(200).json(view()); return; }
      if (typeof req.headers['content-type'] !== 'string' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'])) {
        res.status(415).json({ error: 'Send a JSON request.' });
        return;
      }
      const body = req.body as WorkspaceAction | undefined;
      const timestamp = (options.now ?? (() => new Date()))().toISOString();
      const wrapped = (data: Record<string, unknown>, previous?: WorkspaceRecord) => ({
        ...data, id: previous?.id ?? randomUUID(), revision: randomUUID(),
        createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp,
      });
      let saved: WorkspaceRecord | undefined;
      if (section === 'finance' && body?.action === 'import' && body.importId === 'payable-2026-11' && Array.isArray(body.records) && body.records.length === 18) {
        if (state.imports.includes(body.importId)) { res.status(200).json({ ...view(), imported: false }); return; }
        const rows = body.records.map(validate);
        if (rows.some(row => !row || row.kind !== 'out' || !String(row.date).startsWith('2026-11-'))
          || rows.reduce((sum, row) => sum + Number(row?.cents), 0) !== 9858300) {
          res.status(400).json({ error: 'The November import must contain all 18 payable rows totaling ₱98,583.00.' });
          return;
        }
        state.records.push(...rows.map(row => wrapped(row!)));
        state.imports.push(body.importId);
      } else if (body?.action === 'save' || body?.action === 'delete') {
        const index = body.id ? state.records.findIndex(record => record.id === body.id) : -1;
        const previous = state.records[index];
        if (body.id && (!previous || previous.revision !== body.revision)) {
          res.status(409).json({ error: 'This record changed in another session. Refresh before editing again.' });
          return;
        }
        if (body.action === 'delete') {
          if (!previous) { res.status(404).json({ error: 'Record not found.' }); return; }
          state.records.splice(index, 1);
        } else {
          const validated = validate(body.record);
          const record = validated && extension?.prepare ? extension.prepare(state, validated, previous) : validated;
          if (!record) { res.status(400).json({ error: 'Review the required fields and amounts.' }); return; }
          saved = wrapped(transform ? transform(record, previous as Record<string, unknown> | undefined, timestamp) : record, previous);
          if (previous) state.records[index] = saved;
          else state.records.push(saved);
        }
      } else if (extension?.mutate && body) {
        const error = extension.mutate(state, body);
        if (error) { res.status(error.status).json({ error: error.error }); return; }
      } else { res.status(400).json({ error: 'Choose a supported record action.' }); return; }
      const encoded = JSON.stringify(state);
      if (encoded.length > 1_000_000) { res.status(413).json({ error: 'Workspace record limit reached.' }); return; }
      const result = await command(['EVAL', SAVE_SCRIPT, 1, key, typeof raw === 'string' ? raw : '', encoded]);
      if (result !== 1) { res.status(409).json({ error: 'Another update just saved. Refresh and try again.' }); return; }
      res.status(200).json({ ...view(), record: saved, imported: body?.action === 'import' });
    } catch {
      res.status(503).json({ error: 'Workspace storage could not be reached. Try again.' });
    }
  };
}
