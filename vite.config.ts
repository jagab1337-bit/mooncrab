import { defineConfig, loadEnv } from 'vite';
import { createAvailabilityHandler, createAdminAvailabilityHandler } from './server/availability.ts';
import { createBookingRequestHandler, createAdminBookingRequestsHandler } from './server/booking-requests.ts';

// Run the same handlers locally that Vercel serves in production.
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  const routes = new Map([
    ['/api/availability', createAvailabilityHandler({ env })],
    ['/api/admin/availability', createAdminAvailabilityHandler({ env })],
    ['/api/booking-requests', createBookingRequestHandler({ env })],
    ['/api/admin/booking-requests', createAdminBookingRequestsHandler({ env })],
  ]);
  return {
    plugins: [{ name: 'mooncrab-local-api', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url || '/', 'http://localhost');
        const handler = routes.get(url.pathname);
        if (!handler) return next();
        let size = 0;
        let body = '';
        try {
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 16384) {
              response.writeHead(413, { 'Content-Type': 'application/json' });
              response.end(JSON.stringify({ error: 'Request too large' })); return;
            }
            body += chunk.toString();
          }
          const res = {
            setHeader(name: string, value: string) { response.setHeader(name, value); },
            status(code: number) { response.statusCode = code; return res; },
            json(value: unknown) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); },
          };
          await handler({ method: request.method, headers: request.headers, query: Object.fromEntries(url.searchParams), ...(body ? { body: JSON.parse(body) } : {}) }, res);
        } catch {
          if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Unable to process request' }));
        }
      });
    } }],
  };
});
