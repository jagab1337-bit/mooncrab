import { createFinanceHandler } from './finance.ts';
import { createPrivateFilesHandler } from './private-files.ts';
import { createProjectsHandler } from './projects.ts';
import { createPropertiesHandler } from './properties.ts';
import type { ApiRequest, ApiResponse, HandlerOptions } from './availability.ts';

export function createWorkspaceHandler(options: HandlerOptions = {}) {
  const routes = new Map([
    ['finance', createFinanceHandler(options)],
    ['files', createPrivateFilesHandler(options)],
    ['projects', createProjectsHandler(options)],
    ['properties', createPropertiesHandler(options)],
  ]);
  return async (req: ApiRequest, res: ApiResponse) => {
    const section = req.query?.section;
    const handler = typeof section === 'string' ? routes.get(section) : undefined;
    if (handler) await handler(req, res);
    else res.status(404).json({ error: 'Workspace section not found.' });
  };
}
