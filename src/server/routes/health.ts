import type { Context } from 'hono';
import type { z } from 'zod';
import type { healthSchema } from '../../shared/health';
import type { HttpEnv } from './policy';

/** Returns the existing shared health contract. */
export function healthHandler(c: Context<HttpEnv>): Response {
  const health: z.infer<typeof healthSchema> = { status: 'ok' };

  return c.json(health);
}
