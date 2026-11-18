import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { authorizeAdmin, sameOrigin } from './admin-auth.ts';
import { configured, createRedisCommand, setHeaders } from './availability.ts';
import type { ApiRequest, ApiResponse, HandlerOptions } from './availability.ts';
import { shortText, uuidPattern } from './workspace-records.ts';

const INDEX = 'mooncrab:private-files:index';
const PREFIX = 'mooncrab:private-files:bytes:';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_STORAGE = 48 * 1024 * 1024;
const mimeTypes: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain',
};
type Metadata = { id: string; name: string; folder: string; mime: string; bytes: number; sha256: string; createdAt: string; updatedAt: string };

function validBytes(extension: string, bytes: Buffer): boolean {
  const header = bytes.subarray(0, 16);
  switch (extension) {
    case 'pdf': return header.subarray(0, 5).toString() === '%PDF-';
    case 'jpg': case 'jpeg': return header.subarray(0, 3).toString('hex') === 'ffd8ff';
    case 'png': return header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    case 'webp': return header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP';
    case 'heic': return header.subarray(4, 8).toString() === 'ftyp' && /^(heic|heix|mif1|msf1|hevc)$/.test(header.subarray(8, 12).toString());
    case 'doc': case 'xls': return header.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1';
    case 'docx': case 'xlsx': return header.subarray(0, 4).toString('hex') === '504b0304';
    case 'txt': try { return !bytes.includes(0) && !!new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return false; }
    default: return false;
  }
}
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function encrypt(bytes: Buffer, key: Buffer, id: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
function decrypt(value: string, key: Buffer, id: string): Buffer {
  const stored = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, stored.subarray(0, 12));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(stored.subarray(12, 28));
  return Buffer.concat([decipher.update(stored.subarray(28)), decipher.final()]);
}

const UPDATE = `
local old = redis.call('GET', KEYS[1]) or ''
if old ~= ARGV[1] then return 0 end
if ARGV[3] == 'upload' then redis.call('SET', KEYS[2], ARGV[4]) end
if ARGV[3] == 'delete' then redis.call('DEL', KEYS[2]) end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

function cleanName(value: unknown): string | null {
  if (!shortText(value, 180)) return null;
  const name = value.trim().replace(/[\\/:*?"<>|\x7f]/g, '_');
  return name && !name.startsWith('.') ? name : null;
}

export function createPrivateFilesHandler(options: HandlerOptions = {}) {
  const env = options.env ?? process.env;
  const command = options.command ?? createRedisCommand(env);
  return async (req: ApiRequest, res: ApiResponse) => {
    setHeaders(res);
    if (!['GET', 'POST'].includes(req.method || '')) { res.status(405).json({ error: 'Method not allowed.' }); return; }
    if (!await authorizeAdmin(req, env, command) || (req.method === 'POST' && !sameOrigin(req))) {
      res.status(401).json({ error: 'Sign in through the owner dashboard.' });
      return;
    }
    const key = Buffer.from(env.ADMIN_WORKSPACE_ENCRYPTION_KEY || '', 'base64url');
    if (!configured(env) || key.length !== 32) {
      res.status(503).json({ error: 'Private files require a server-managed 256-bit encryption key and storage connection.' });
      return;
    }
    try {
      const raw = await command(['GET', INDEX]);
      const files: Metadata[] = typeof raw === 'string' ? JSON.parse(raw) : [];
      if (req.method === 'GET') {
        const id = req.query?.file;
        if (id === undefined) { res.status(200).json({ files, maxBytes: MAX_BYTES }); return; }
        const record = typeof id === 'string' && uuidPattern.test(id) ? files.find(file => file.id === id) : undefined;
        if (!record) { res.status(404).json({ error: 'File not found.' }); return; }
        const encrypted = await command(['GET', PREFIX + record.id]);
        if (typeof encrypted !== 'string') { res.status(404).json({ error: 'File not found.' }); return; }
        const bytes = decrypt(encrypted, key, record.id);
        if (bytes.length !== record.bytes || digest(bytes) !== record.sha256) throw new Error('File integrity check failed');
        res.status(200).json({ file: record, data: bytes.toString('base64') });
        return;
      }
      if (typeof req.headers['content-type'] !== 'string' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'])) {
        res.status(415).json({ error: 'Send a JSON request.' }); return;
      }
      const body = req.body as { action?: string; id?: string; name?: string; folder?: string; data?: string } | undefined;
      const timestamp = (options.now ?? (() => new Date()))().toISOString();
      let id = body?.id;
      let encrypted = '';
      if (body?.action === 'upload') {
        const name = cleanName(body.name);
        const extension = name?.split('.').pop()?.toLowerCase() ?? '';
        const mime = mimeTypes[extension];
        if (!name || !mime || !shortText(body.folder, 80) || typeof body.data !== 'string'
          || body.data.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) {
          res.status(400).json({ error: 'Choose a supported file up to 2 MiB.' }); return;
        }
        const bytes = Buffer.from(body.data, 'base64');
        if (bytes.length > MAX_BYTES || !validBytes(extension, bytes)) {
          res.status(400).json({ error: 'The contents do not match the file extension or size limit.' }); return;
        }
        if (files.length >= 200 || files.reduce((sum, file) => sum + file.bytes, bytes.length) > MAX_STORAGE) {
          res.status(409).json({ error: 'Private file storage is full.' }); return;
        }
        id = randomUUID();
        encrypted = encrypt(bytes, key, id);
        files.push({ id, name, folder: body.folder.trim(), mime, bytes: bytes.length, sha256: digest(bytes), createdAt: timestamp, updatedAt: timestamp });
      } else if (body?.action === 'rename' || body?.action === 'delete') {
        const index = files.findIndex(file => file.id === id);
        if (index < 0) { res.status(404).json({ error: 'File not found.' }); return; }
        if (body.action === 'delete') files.splice(index, 1);
        else {
          const name = cleanName(body.name);
          const original = files[index];
          if (!name || name.split('.').pop()?.toLowerCase() !== original.name.split('.').pop()?.toLowerCase() || !shortText(body.folder, 80)) {
            res.status(400).json({ error: 'Enter a file name with the original extension and a short folder name.' }); return;
          }
          files[index] = { ...original, name, folder: body.folder.trim(), updatedAt: timestamp };
        }
      } else { res.status(400).json({ error: 'Choose upload, rename or delete.' }); return; }
      if (await command(['EVAL', UPDATE, 2, INDEX, PREFIX + id, typeof raw === 'string' ? raw : '', JSON.stringify(files), body.action, encrypted]) !== 1) {
        res.status(409).json({ error: 'The file library changed. Refresh before trying again.' });
        return;
      }
      res.status(200).json({ files, id, maxBytes: MAX_BYTES });
    } catch {
      res.status(503).json({ error: 'Private file storage could not be reached or verified.' });
    }
  };
}
