import { describe, expect, it } from 'vitest';
import { healthSchema } from '../shared/health';
import worker from './index';

describe('Worker HTTP interface', () => {
  it('rejects unknown discovery providers before making external requests', async () => {
    const response = await worker.fetch(
      new Request(
        'https://briefing.test/api/feasibility/discovery?provider=unknown',
      ),
    );
    expect(response.status).toBe(400);
  });
  it('returns the shared health contract without caching', async () => {
    const response = await worker.fetch(
      new Request('https://briefing.test/api/health'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(healthSchema.parse(await response.json())).toEqual({ status: 'ok' });
  });

  it('rejects unsupported methods', async () => {
    const response = await worker.fetch(
      new Request('https://briefing.test/api/health', { method: 'POST' }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    const response = await worker.fetch(
      new Request('https://briefing.test/api/missing'),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });
});
