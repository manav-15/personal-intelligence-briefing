import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetAccessKeyCache,
  resolveAccessIdentity,
  type AccessBindings,
} from './access';
import {
  base64Url,
  jwksFetcher,
  signedToken,
  signingKey,
  type Signing,
} from '../test/access-tokens';
import type { Fetcher } from './discovery';

const teamDomain = 'briefing-agent.cloudflareaccess.com';
const audience = 'a'.repeat(32);
const otherAudience = 'b'.repeat(32);
const issuer = `https://${teamDomain}`;
const keysUrl = `https://${teamDomain}/cdn-cgi/access/certs`;

const bindings: AccessBindings = {
  ACCESS_TEAM_DOMAIN: teamDomain,
  ACCESS_AUD: audience,
  PRIMARY_USER_ID: 'owner-1',
};

/**
 * Signs a token for these fixtures: the suite's audience and issuer by default,
 * so a case only states the claim it is testing.
 */
function signToken(
  signing: Signing,
  overrides: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  return signedToken(
    signing,
    {
      aud: [audience],
      iss: issuer,
      sub: 'idp-subject-1',
      email: 'owner@example.com',
      ...overrides,
    },
    header,
  );
}

/**
 * Mimics the Workers runtime, which brands `fetch`: reaching it through a
 * property calls it with a foreign receiver and throws "Illegal invocation".
 * Node's fetch tolerates that receiver, so only this shape catches the mistake.
 */
function receiverStrictFetcher(sets: Signing[][]): Fetcher {
  const serve = jwksFetcher(sets).fetcher;

  return function strict(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (this !== undefined) throw new TypeError('Illegal invocation');

    return serve(input, init);
  };
}

function requestWith(token?: string, cookie?: string): Request {
  const headers = new Headers();

  if (token !== undefined) headers.set('cf-access-jwt-assertion', token);

  if (cookie !== undefined) headers.set('cookie', `CF_Authorization=${cookie}`);

  return new Request('https://briefing.example.com/api/briefings/today', {
    headers,
  });
}

beforeEach(() => {
  resetAccessKeyCache();
});
afterEach(() => {
  resetAccessKeyCache();
  vi.unstubAllGlobals();
});

describe('cloudflare access identity', () => {
  it('accepts a valid token from the header and resolves the owner id', async () => {
    const signing = await signingKey('kid-1');
    const { fetcher, urls } = jwksFetcher([[signing]]);
    const identity = await resolveAccessIdentity(
      bindings,
      requestWith(await signToken(signing)),
      fetcher,
    );

    expect(identity).toEqual({ ok: true, userId: 'owner-1', source: 'access' });
    expect(urls()).toEqual([keysUrl]);
  });

  it('invokes the fetcher as a plain function, as the runtime requires', async () => {
    const signing = await signingKey('kid-1');

    const identity = await resolveAccessIdentity(
      bindings,
      requestWith(await signToken(signing)),
      receiverStrictFetcher([[signing]]),
    );

    expect(identity).toMatchObject({ ok: true, userId: 'owner-1' });
  });

  it('accepts the browser cookie when no header is present', async () => {
    const signing = await signingKey('kid-1');
    const { fetcher } = jwksFetcher([[signing]]);
    const token = await signToken(signing);

    await expect(
      resolveAccessIdentity(bindings, requestWith(undefined, token), fetcher),
    ).resolves.toMatchObject({ ok: true, userId: 'owner-1' });
  });

  it('rejects a missing token, the wrong audience, and the wrong issuer', async () => {
    const signing = await signingKey('kid-1');
    const { fetcher } = jwksFetcher([[signing]]);

    await expect(
      resolveAccessIdentity(bindings, requestWith(), fetcher),
    ).resolves.toMatchObject({ ok: false, status: 401 });
    await expect(
      resolveAccessIdentity(
        bindings,
        requestWith(await signToken(signing, { aud: [otherAudience] })),
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: false, status: 401 });
    await expect(
      resolveAccessIdentity(
        bindings,
        requestWith(
          await signToken(signing, { iss: 'https://evil.example.com' }),
        ),
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it('rejects an expired token', async () => {
    const signing = await signingKey('kid-1');
    const { fetcher } = jwksFetcher([[signing]]);
    const past = Math.floor(Date.now() / 1_000) - 7_200;
    const identity = await resolveAccessIdentity(
      bindings,
      requestWith(await signToken(signing, { exp: past, iat: past - 60 })),
      fetcher,
    );

    expect(identity).toMatchObject({ ok: false, status: 401 });
    expect(identity.ok ? '' : identity.message).toContain('expired');
  });

  it('rejects a tampered payload and an unsupported algorithm', async () => {
    const signing = await signingKey('kid-1');
    const { fetcher } = jwksFetcher([[signing]]);
    const token = await signToken(signing);
    const [header, , signature] = token.split('.') as [string, string, string];
    const forged = `${header}.${base64Url(JSON.stringify({ aud: [audience], exp: 9_999_999_999, iss: issuer }))}.${signature}`;
    const unsigned = await signToken(signing, {}, { alg: 'none' });

    await expect(
      resolveAccessIdentity(bindings, requestWith(forged), fetcher),
    ).resolves.toMatchObject({ ok: false, status: 401 });
    await expect(
      resolveAccessIdentity(bindings, requestWith(unsigned), fetcher),
    ).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it('refreshes the key set once when the token names an unknown key', async () => {
    const first = await signingKey('kid-1');
    const rotated = await signingKey('kid-2');
    const { fetcher, calls } = jwksFetcher([[first], [rotated]]);
    const identity = await resolveAccessIdentity(
      bindings,
      requestWith(await signToken(rotated)),
      fetcher,
    );

    expect(identity).toMatchObject({ ok: true });
    expect(calls()).toBe(2);
  });

  it('fails closed when the key set cannot be fetched', async () => {
    const signing = await signingKey('kid-1');
    const failing: Fetcher = () =>
      Promise.resolve(new Response('nope', { status: 500 }));
    const identity = await resolveAccessIdentity(
      bindings,
      requestWith(await signToken(signing)),
      failing,
    );

    expect(identity).toMatchObject({ ok: false, status: 401 });
  });

  it('maps a service token to the same owner and enforces the allowlist', async () => {
    const signing = await signingKey('kid-1');
    const { fetcher } = jwksFetcher([[signing]]);
    const serviceToken = await signToken(signing, {
      sub: '',
      common_name: 'client-id-1.access',
      service_token_id: 'client-id-1',
      service_token_status: true,
      email: undefined,
    });
    const allowed: AccessBindings = {
      ...bindings,
      ACCESS_ALLOWED_IDENTITIES: 'client-id-1, idp-subject-1',
    };

    await expect(
      resolveAccessIdentity(allowed, requestWith(serviceToken), fetcher),
    ).resolves.toMatchObject({ ok: true, userId: 'owner-1' });
    await expect(
      resolveAccessIdentity(
        { ...allowed, ACCESS_ALLOWED_IDENTITIES: 'someone-else' },
        requestWith(await signToken(signing)),
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it('treats empty Access values as unconfigured, keeping local development working', async () => {
    await expect(
      resolveAccessIdentity(
        {
          ACCESS_TEAM_DOMAIN: '',
          ACCESS_AUD: '   ',
          PREFERENCES_DIAGNOSTICS_ENABLED: 'true',
        },
        requestWith(),
      ),
    ).resolves.toMatchObject({
      ok: true,
      source: 'local',
      userId: 'single-user',
    });
  });

  it('requires Access when it is configured, even with the local flag set', async () => {
    const signing = await signingKey('kid-1');
    const { fetcher } = jwksFetcher([[signing]]);
    const localToo: AccessBindings = {
      ...bindings,
      PREFERENCES_DIAGNOSTICS_ENABLED: 'true',
    };

    await expect(
      resolveAccessIdentity(localToo, requestWith(), fetcher),
    ).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it('allows the local placeholder only under the local diagnostic flag', async () => {
    await expect(
      resolveAccessIdentity(
        { PREFERENCES_DIAGNOSTICS_ENABLED: 'true' },
        requestWith(),
      ),
    ).resolves.toEqual({ ok: true, userId: 'single-user', source: 'local' });
    await expect(
      resolveAccessIdentity({}, requestWith()),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('honours a configured primary owner id in both modes', async () => {
    await expect(
      resolveAccessIdentity(
        { PREFERENCES_DIAGNOSTICS_ENABLED: 'true', PRIMARY_USER_ID: 'manav' },
        requestWith(),
      ),
    ).resolves.toEqual({ ok: true, userId: 'manav', source: 'local' });
  });

  it('rejects an oversized token without touching the key set', async () => {
    const { fetcher, calls } = jwksFetcher([[]]);
    const identity = await resolveAccessIdentity(
      bindings,
      requestWith('x'.repeat(8_001)),
      fetcher,
    );

    expect(identity).toMatchObject({ ok: false, status: 401 });
    expect(calls()).toBe(0);
  });
});
