import type { MiddlewareHandler } from 'hono';
import type { PreferencesAgentEnv } from '../preferences-agent';
import type { BriefingWorkflowParams } from '../briefing-workflow';

/** Optional local diagnostic bindings; production enables neither diagnostic flag. */
export type Env = Partial<PreferencesAgentEnv> & {
  BRIEFING_WORKFLOW?: Workflow<BriefingWorkflowParams>;
  INSPECTION_ENABLED?: string;
  SEARXNG_BASE_URL?: string;
};

/** Hono binding contract shared by the Worker and route groups. */
export type HttpEnv = { Bindings: Env };

/** Disables caching wherever a route group's original policy requires it. */
export const noStore: MiddlewareHandler<HttpEnv> = async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
};

/** Hides a diagnostic group before origin, method, or input validation. */
export function diagnosticEnabled(
  flag: 'INSPECTION_ENABLED' | 'PREFERENCES_DIAGNOSTICS_ENABLED',
  error: string,
): MiddlewareHandler<HttpEnv> {
  return async (c, next) => {
    // Hono permits fetch(request) without bindings, despite Context's Env type.
    const bindings = c.env as Env | undefined;

    if (bindings?.[flag] !== 'true') return c.json({ error }, 404);
    await next();
  };
}

/** Rejects explicit cross-origin requests while permitting non-browser reads. */
export function sameOrigin(error: string): MiddlewareHandler<HttpEnv> {
  return async (c, next) => {
    const origin = c.req.header('origin');

    if (
      (origin !== undefined && origin !== new URL(c.req.url).origin) ||
      c.req.header('sec-fetch-site') === 'cross-site'
    ) {
      return c.json({ error }, 403);
    }
    await next();
  };
}

/** Checks the raw method so Hono's automatic HEAD-to-GET dispatch cannot admit HEAD. */
export function allowMethods(...methods: string[]): MiddlewareHandler<HttpEnv> {
  return async (c, next) => {
    if (!methods.includes(c.req.raw.method)) {
      c.header('Allow', methods.join(', '));

      return c.json({ error: 'Method not allowed' }, 405);
    }
    await next();
  };
}
