import type { z } from 'zod';
import type { healthSchema } from '../shared/health';

/**
 * Worker HTTP entrypoint. Static Assets serve the application; this handler
 * owns first-party API routes that must never fall through to the SPA.
 */
export default {
  /** Returns the versioned health contract or a JSON error for unsupported routes. */
  fetch(request: Request): Response {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET') {
        return Response.json(
          { error: 'Method not allowed' },
          { status: 405, headers: { Allow: 'GET' } },
        );
      }

      const health: z.infer<typeof healthSchema> = { status: 'ok' };
      return Response.json(health, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
} satisfies ExportedHandler;
