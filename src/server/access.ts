import { z } from 'zod';
import { readBoundedText } from './http';
import type { Fetcher } from './discovery';

/** Configuration that decides how one request proves who it is. */
export type AccessBindings = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_ALLOWED_IDENTITIES?: string;
  PRIMARY_USER_ID?: string;
  PREFERENCES_DIAGNOSTICS_ENABLED?: string;
};

/** A verified request identity, or a bounded refusal that leaks nothing. */
export type AccessIdentity =
  | { ok: true; userId: string; source: 'access' | 'local' }
  | { ok: false; status: 401; message: string };

const jwksSchema = z.object({
  keys: z.array(
    z.object({
      kid: z.string().min(1),
      kty: z.string(),
      alg: z.string().optional(),
      n: z.string().min(1),
      e: z.string().min(1),
      use: z.string().optional(),
    }),
  ),
});
const claimsSchema = z.looseObject({
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  iat: z.number().optional(),
  iss: z.string(),
  sub: z.string().optional(),
  email: z.string().optional(),
  common_name: z.string().optional(),
  service_token_id: z.string().optional(),
  service_token_status: z.boolean().optional(),
});

const MAX_JWKS_BYTES = 100_000;
const MAX_TOKEN_CHARACTERS = 8_000;
const JWKS_TTL_MS = 15 * 60_000;
const CLOCK_SKEW_SECONDS = 5;
const defaultUserId = 'single-user';

type AccessClaims = z.infer<typeof claimsSchema>;

const jwksCache = new Map<string, { fetchedAt: number; keys: unknown[] }>();

/**
 * Resolves the owner identity for one request.
 *
 * With Access configured, a valid `Cf-Access-Jwt-Assertion` — or the
 * `CF_Authorization` cookie a browser sends — is required and every failure is a
 * 401. Without Access configured the local diagnostic binding alone may stand in
 * for an identity, which is how local development keeps working while a
 * misconfigured deployment denies instead of admitting.
 */
export async function resolveAccessIdentity(
  bindings: AccessBindings,
  request: Request,
  fetcher: Fetcher = fetch,
): Promise<AccessIdentity> {
  const teamDomain = configuredValue(bindings.ACCESS_TEAM_DOMAIN);
  const audience = configuredValue(bindings.ACCESS_AUD);
  const userId = bindings.PRIMARY_USER_ID?.trim() || defaultUserId;

  if (teamDomain !== undefined && audience !== undefined) {
    return resolveAccessRequest({
      teamDomain,
      audience,
      userId,
      allowed: allowedIdentities(bindings.ACCESS_ALLOWED_IDENTITIES),
      request,
      fetcher,
    });
  }

  if (bindings.PREFERENCES_DIAGNOSTICS_ENABLED === 'true')
    return { ok: true, userId, source: 'local' };

  return {
    ok: false,
    status: 401,
    message: 'Authentication is not configured for this deployment.',
  };
}

type AccessRequest = {
  teamDomain: string;
  audience: string;
  userId: string;
  allowed: string[] | null;
  request: Request;
  fetcher: Fetcher;
};

async function resolveAccessRequest(
  input: AccessRequest,
): Promise<AccessIdentity> {
  const token = accessToken(input.request);

  if (token === null)
    return {
      ok: false,
      status: 401,
      message: 'Sign in through Cloudflare Access to use this app.',
    };

  if (token.length > MAX_TOKEN_CHARACTERS)
    return {
      ok: false,
      status: 401,
      message: 'The access token is too large.',
    };

  const claims = await verifiedClaims(token, input);

  if (!claims.ok) return { ok: false, status: 401, message: claims.message };

  if (input.allowed !== null && !permitsIdentity(claims.claims, input.allowed))
    return {
      ok: false,
      status: 401,
      message: 'This identity is not permitted to use this app.',
    };

  return { ok: true, userId: input.userId, source: 'access' };
}

/** Reads the token Access injects, falling back to the browser session cookie. */
function accessToken(request: Request): string | null {
  const header = request.headers.get('cf-access-jwt-assertion');

  if (header !== null && header.trim() !== '') return header.trim();

  const cookie = request.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/u.exec(cookie);

  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

async function verifiedClaims(
  token: string,
  input: AccessRequest,
): Promise<
  { ok: true; claims: AccessClaims } | { ok: false; message: string }
> {
  const parts = token.split('.');

  if (parts.length !== 3)
    return { ok: false, message: 'The access token is malformed.' };

  const [headerPart, claimsPart, signaturePart] = parts as [
    string,
    string,
    string,
  ];
  const header = decodeSegment(headerPart);

  if (
    typeof header !== 'object' ||
    header === null ||
    (header as { alg?: unknown }).alg !== 'RS256' ||
    typeof (header as { kid?: unknown }).kid !== 'string'
  )
    return { ok: false, message: 'The access token header is not supported.' };

  const kid = (header as { kid: string }).kid;
  const signature = decodeBytes(signaturePart);

  if (signature === null)
    return { ok: false, message: 'The access token signature is unreadable.' };

  const key = await signingKey(input, kid);

  if (!key.ok) return { ok: false, message: key.message };

  const encoder = new TextEncoder();
  const valid = await crypto.subtle
    .verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key.key,
      signature,
      encoder.encode(`${headerPart}.${claimsPart}`),
    )
    .catch(() => false);

  if (!valid)
    return { ok: false, message: 'The access token signature is invalid.' };

  const parsed = claimsSchema.safeParse(decodeSegment(claimsPart));

  if (!parsed.success)
    return { ok: false, message: 'The access token claims are malformed.' };

  const claims = parsed.data;
  const now = Math.floor(Date.now() / 1_000);

  if (claims.exp + CLOCK_SKEW_SECONDS < now)
    return { ok: false, message: 'The access token has expired.' };

  if (claims.iss !== `https://${input.teamDomain}`)
    return { ok: false, message: 'The access token issuer is not trusted.' };

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (!audiences.includes(input.audience))
    return {
      ok: false,
      message: 'The access token is for another application.',
    };

  return { ok: true, claims };
}

async function signingKey(
  input: AccessRequest,
  kid: string,
): Promise<{ ok: true; key: CryptoKey } | { ok: false; message: string }> {
  const cached = await keysFor(input, false);
  const fromCache = cached.ok ? findJwk(cached.keys, kid) : null;

  if (fromCache !== null) return importKey(fromCache);

  // An unknown key id is the documented rotation signal: refresh exactly once.
  const refreshed = await keysFor(input, true);

  if (!refreshed.ok) return { ok: false, message: refreshed.message };

  const jwk = findJwk(refreshed.keys, kid);

  return jwk === null
    ? { ok: false, message: 'The access token uses an unknown signing key.' }
    : importKey(jwk);
}

async function keysFor(
  input: AccessRequest,
  force: boolean,
): Promise<{ ok: true; keys: unknown[] } | { ok: false; message: string }> {
  const cached = jwksCache.get(input.teamDomain);

  if (
    !force &&
    cached !== undefined &&
    Date.now() - cached.fetchedAt < JWKS_TTL_MS
  )
    return { ok: true, keys: cached.keys };

  try {
    // Borrowed into a local first: the Workers runtime brands `fetch`, so
    // reaching it through a property calls it with the wrong receiver and
    // throws "Illegal invocation" — a failure Node's fetch never reproduces.
    const fetchKeys = input.fetcher;
    const response = await fetchKeys(
      `https://${input.teamDomain}/cdn-cgi/access/certs`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const text = await readBoundedText(response, MAX_JWKS_BYTES);

    if (!response.ok || text === null) {
      // Never fall back to skipping verification because the keys are missing.
      return {
        ok: false,
        message: `Cloudflare Access keys were unavailable (HTTP ${String(response.status)}).`,
      };
    }

    const parsed = jwksSchema.safeParse(JSON.parse(text) as unknown);

    if (!parsed.success)
      return { ok: false, message: 'Cloudflare Access keys were malformed.' };

    jwksCache.set(input.teamDomain, {
      fetchedAt: Date.now(),
      keys: parsed.data.keys,
    });

    return { ok: true, keys: parsed.data.keys };
  } catch {
    return {
      ok: false,
      message: 'Cloudflare Access keys could not be fetched.',
    };
  }
}

function findJwk(keys: unknown[], kid: string): unknown {
  return (
    keys.find(
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        (candidate as { kid?: unknown }).kid === kid,
    ) ?? null
  );
}

async function importKey(
  jwk: unknown,
): Promise<{ ok: true; key: CryptoKey } | { ok: false; message: string }> {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    return { ok: true, key };
  } catch {
    return { ok: false, message: 'The access signing key is unusable.' };
  }
}

/**
 * Reads one optional binding, treating an empty value as absent.
 *
 * Local development blanks the Access bindings in the gitignored `.dev.vars`, so
 * the Worker falls back to the local owner; only a non-empty value turns the
 * Access verifier on.
 */
function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * Reads the configured allowlist, or null when the Access policy is the gate.
 */
function allowedIdentities(value: string | undefined): string[] | null {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');

  return entries.length === 0 ? null : entries;
}

/** Matches a user or service-token identity against the allowlist. */
function permitsIdentity(claims: AccessClaims, allowed: string[]): boolean {
  return [
    claims.sub,
    claims.common_name,
    claims.service_token_id,
    claims.email,
  ].some(
    (candidate) =>
      candidate !== undefined && allowed.includes(candidate.toLowerCase()),
  );
}

function decodeSegment(segment: string): unknown {
  const bytes = decodeBytes(segment);

  if (bytes === null) return null;

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function decodeBytes(segment: string): Uint8Array | null {
  try {
    const binary = atob(
      segment
        .replaceAll('-', '+')
        .replaceAll('_', '/')
        .padEnd(Math.ceil(segment.length / 4) * 4, '='),
    );

    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Records one refused request so `wrangler tail` can name the failing check.
 *
 * The reason and the route are logged; the token, cookie, and any claim are not,
 * because a denial is exactly when that material is least trustworthy.
 */
export function logAccessDenial(message: string, request: Request): void {
  const { pathname } = new URL(request.url);

  console.warn(`access denied: ${message} [${request.method} ${pathname}]`);
}

/** Clears the memoized Access keys; tests use it to isolate cases. */
export function resetAccessKeyCache(): void {
  jwksCache.clear();
}
