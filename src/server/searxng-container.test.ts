import { getContainer } from '@cloudflare/containers';
import { describe, expect, it, vi } from 'vitest';
import {
  createSearxngContainerFetcher,
  type SearxngContainer,
} from './searxng-container';

describe('SearXNG Container fetch adapter', () => {
  it('forwards an internal request to the stable private container instance', async () => {
    const response = new Response('{"results":[]}', {
      headers: { 'content-type': 'application/json' },
    });
    const fetch = vi.fn().mockResolvedValue(response);
    const binding = {} as DurableObjectNamespace<SearxngContainer>;

    vi.mocked(getContainer).mockReturnValue({ fetch } as never);
    const request = createSearxngContainerFetcher(binding);
    const actual = await request('http://searxng.internal/search?q=Liverpool');

    expect(getContainer).toHaveBeenCalledWith(binding, 'briefing-search');
    expect(fetch).toHaveBeenCalledWith(expect.any(Request));
    expect(actual).toBe(response);
  });
});
