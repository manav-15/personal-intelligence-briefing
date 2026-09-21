import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeAgentRequest } from 'agents';
import app from './index';

vi.mock('agents', () => ({
  routeAgentRequest: vi.fn(() => Promise.resolve(new Response('routed'))),
}));

const origin = 'https://briefing.test';
const local = {
  INSPECTION_ENABLED: 'true',
  PREFERENCES_DIAGNOSTICS_ENABLED: 'true',
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('diagnostic security boundary', () => {
  it.each(['GET', 'HEAD', 'POST', 'OPTIONS'])(
    'hides disabled diagnostics before processing %s',
    async (method) => {
      const fetcher = vi.fn();

      vi.stubGlobal('fetch', fetcher);
      const response = await app.fetch(
        new Request(`${origin}/api/feasibility/discovery?provider=unknown`, {
          method,
          headers: { Origin: 'https://other.test' },
        }),
        {},
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('requires identity even when inspection is enabled', async () => {
    const fetcher = vi.fn();

    vi.stubGlobal('fetch', fetcher);
    const response = await app.fetch(
      new Request(`${origin}/api/feasibility/discovery`),
      { INSPECTION_ENABLED: 'true' },
    );

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects cross-origin discovery before fetching providers', async () => {
    const fetcher = vi.fn();

    vi.stubGlobal('fetch', fetcher);
    const response = await app.fetch(
      new Request(`${origin}/api/feasibility/discovery`, {
        headers: { Origin: 'https://other.test' },
      }),
      local,
    );

    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Agent routing security boundary', () => {
  it.each([
    '/agents/personal-briefing/other-owner',
    '/agents/personal-briefing/other-owner/get-messages',
    '/agents/personal-briefing/other-owner/sub/child/name',
    '/agents/another-binding/single-user',
    '/agents/another-binding/single-user/get-messages',
    '/agents/personal-briefing',
    '/agents/personal-briefing/%73ingle-user/get-messages',
  ])('rejects unauthorized target %s before SDK dispatch', async (path) => {
    const response = await app.fetch(new Request(origin + path), local);

    expect(response.status).toBe(404);
    expect(routeAgentRequest).not.toHaveBeenCalled();
  });

  it('requires authentication for the owner transport', async () => {
    const response = await app.fetch(
      new Request(`${origin}/agents/personal-briefing/single-user`),
      {},
    );

    expect(response.status).toBe(401);
    expect(routeAgentRequest).not.toHaveBeenCalled();
  });

  it.each([
    { Origin: 'https://other.test' },
    { Origin: 'https://other.test', Upgrade: 'websocket' },
    { Origin: 'null', Upgrade: 'websocket' },
    { 'Sec-Fetch-Site': 'cross-site', Upgrade: 'websocket' },
  ])('rejects cross-origin transport requests: %j', async (headers) => {
    const response = await app.fetch(
      new Request(`${origin}/agents/personal-briefing/single-user`, {
        headers: new Headers(headers),
      }),
      local,
    );

    expect(response.status).toBe(403);
    expect(routeAgentRequest).not.toHaveBeenCalled();
  });

  it.each(['', '/get-messages'])(
    'preserves the configured owner route with suffix %s',
    async (suffix) => {
      const request = new Request(
        `${origin}/agents/personal-briefing/owner-1${suffix}`,
        { headers: { Origin: origin } },
      );
      const env = { ...local, PRIMARY_USER_ID: 'owner-1' };
      const response = await app.fetch(request, env);

      expect(response.status).toBe(200);
      expect(routeAgentRequest).toHaveBeenCalledWith(request, env);
    },
  );

  it('allows a same-origin WebSocket handshake to reach the SDK', async () => {
    const response = await app.fetch(
      new Request(`${origin}/agents/personal-briefing/single-user`, {
        headers: { Origin: origin, Upgrade: 'websocket' },
      }),
      local,
    );

    expect(response.status).toBe(200);
    expect(routeAgentRequest).toHaveBeenCalledOnce();
  });
});
