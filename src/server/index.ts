import { Hono } from 'hono';
import { routeAgentRequest } from 'agents';
import { chatsRoutes } from './routes/chats';
import { feasibilityRoutes } from './routes/feasibility';
import { briefingsRoutes } from './routes/briefings';
import { healthHandler } from './routes/health';
import { identityRoutes } from './routes/identity';
import { inspectionRoutes } from './routes/inspection';
import { preferencesRoutes } from './routes/preferences';
import {
  allowMethods,
  noStore,
  requireIdentity,
  sameOrigin,
  type Env,
  type HttpEnv,
} from './routes/policy';
import {
  startDueScheduledBriefing,
  type ScheduledBriefingStartResult,
} from './scheduled-briefing';

export { PersonalBriefingAgent } from './preferences-agent';
export { BriefingWorkflow } from './briefing-workflow';
export { SearxngContainer } from './searxng-container';

/** Worker API composition; Static Assets owns frontend routing. */
const app = new Hono<HttpEnv>();

app.all('/api/health', allowMethods('GET'), noStore);
app.get('/api/health', healthHandler);
app.route('/api/identity', identityRoutes);
app.route('/api/preferences', preferencesRoutes);
app.route('/api/briefings', briefingsRoutes);
app.route('/api/chats', chatsRoutes);
app.route('/api/inspection', inspectionRoutes);
app.route('/api/feasibility', feasibilityRoutes);
app.use('/agents/*', requireIdentity);
app.use('/agents/*', sameOrigin('Cross-origin Agent access is not allowed.'));
app.all('/agents/*', async (c) => {
  // A client names the instance in the path; it may only address its own owner.
  const segments = new URL(c.req.url).pathname.split('/').filter(Boolean);

  if (segments[1] !== 'personal-briefing' || segments[2] !== c.get('userId'))
    return c.json({ error: 'Agent route not found.' }, 404);

  const response = await routeAgentRequest(c.req.raw, c.env);

  return response ?? c.json({ error: 'Agent route not found.' }, 404);
});
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((_error, c) => c.json({ error: 'Internal server error' }, 500));

/**
 * Worker entry: HTTP plus the cron tick that reserves a due daily briefing.
 *
 * The tick bypasses HTTP and Access entirely; it reads only its own bindings.
 */
export default {
  fetch: app.fetch,
  scheduled(
    controller: ScheduledController,
    env: Env,
  ): Promise<ScheduledBriefingStartResult> {
    return startDueScheduledBriefing(env, new Date(controller.scheduledTime));
  },
};
