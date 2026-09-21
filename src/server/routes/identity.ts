import { Hono } from 'hono';
import { identitySchema } from '../../shared/identity';
import {
  allowMethods,
  noStore,
  requireIdentity,
  sameOrigin,
  type HttpEnv,
} from './policy';

/**
 * Reports the owner id this request resolved to.
 *
 * The browser needs it to address its own Agent instance, which the Agent route
 * validates against the same resolved identity. Nothing else is exposed.
 */
export const identityRoutes = new Hono<HttpEnv>();

identityRoutes.use('*', requireIdentity);
identityRoutes.use(
  '*',
  sameOrigin('Cross-origin identity access is not allowed.'),
);
identityRoutes.all('/', allowMethods('GET'));
identityRoutes.get('/', noStore, (c) =>
  c.json(identitySchema.parse({ userId: c.get('userId') })),
);
