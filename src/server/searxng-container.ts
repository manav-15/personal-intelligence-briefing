import { Container, getContainer } from '@cloudflare/containers';
import type { Fetcher } from './discovery';

/** Runtime binding required to start the private SearXNG process. */
export type SearxngContainerEnv = {
  SEARXNG_SECRET: string;
};

/**
 * Private, single-instance SearXNG process used only through a Worker binding.
 *
 * SearXNG needs outbound access to reach its configured search engines. It has
 * no public route: callers use the Durable Object binding through
 * `createSearxngContainerFetcher`.
 */
export class SearxngContainer extends Container<SearxngContainerEnv> {
  defaultPort = 8080;
  sleepAfter = '10m';
  enableInternet = true;

  /** Supplies the deployment secret when the container starts. */
  constructor(ctx: DurableObjectState<object>, env: SearxngContainerEnv) {
    super(ctx, env);
    this.envVars = { SEARXNG_SECRET: env.SEARXNG_SECRET };
  }
}

/**
 * Adapts the stable private container instance to the discovery fetch boundary.
 *
 * The request host is deliberately internal-only. The Container SDK forwards
 * its path and request data to the configured default port without exposing an
 * externally reachable SearXNG origin.
 */
export function createSearxngContainerFetcher(
  binding: DurableObjectNamespace<SearxngContainer>,
): Fetcher {
  const container = getContainer(binding, 'briefing-search');

  return async (input, init) => {
    const request = requestFrom(input, init);

    return container.fetch(request);
  };
}

function requestFrom(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) return new Request(input, init);

  return new Request(input, init);
}

/** Internal base URL used only as a path carrier for Container SDK requests. */
export const searxngContainerBaseUrl = 'http://searxng.internal';
