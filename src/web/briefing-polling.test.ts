import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollBriefingRun } from './briefing-polling';

const runId = 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee';
const running = {
  runId,
  status: 'running',
  failureMessage: null,
  collectionFailures: [],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('briefing polling', () => {
  it('waits two seconds between completed requests and stops on failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(running))
      .mockResolvedValueOnce(
        Response.json({
          ...running,
          status: 'failed',
          failureMessage: 'No usable evidence.',
        }),
      );

    vi.stubGlobal('fetch', fetcher);
    const update = vi.fn();
    const stop = pollBriefingRun(runId, update, vi.fn());

    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed' }),
      undefined,
    );
    stop();
  });

  it('retries a failed final edition read before announcing publication', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...running, status: 'published' }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ ...running, status: 'published' }))
      .mockResolvedValueOnce(Response.json({ briefing: null }));

    vi.stubGlobal('fetch', fetcher);
    const update = vi.fn();
    const error = vi.fn();
    const stop = pollBriefingRun(runId, update, error);

    await vi.advanceTimersByTimeAsync(0);
    expect(update).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published' }),
      null,
    );
    stop();
  });

  it('does not overlap slow requests or update an unmounted screen', async () => {
    let resolve: (response: Response) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );

    vi.stubGlobal('fetch', fetcher);
    const update = vi.fn();
    const stop = pollBriefingRun(runId, update, vi.fn());

    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    stop();
    resolve(Response.json(running));
    await vi.advanceTimersByTimeAsync(10000);
    expect(update).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
