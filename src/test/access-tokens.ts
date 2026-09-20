import type { Fetcher } from '../server/discovery';

/** One generated signing key with the JWK document served in the fixture set. */
export type Signing = {
  kid: string;
  privateKey: CryptoKey;
  jwk: Record<string, unknown>;
};

/** Generates one signing key with a public JWK for the fixture key set. */
export async function signingKey(kid: string): Promise<Signing> {
  const generated = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

  // The platform typings return a union without overloads; narrow it here.
  if (!('privateKey' in generated))
    throw new Error('Expected a generated RSA key pair.');
  const exported = await crypto.subtle.exportKey('jwk', generated.publicKey);

  if (!('kty' in exported)) throw new Error('Expected a JWK export.');

  return { kid, privateKey: generated.privateKey, jwk: { ...exported, kid } };
}

/** Encodes one JWT segment the way the Access tokens do. */
export function base64Url(value: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  let binary = '';

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/**
 * Signs one RS256 token shaped like an Access assertion.
 *
 * `claims` must carry the audience and issuer under test; `iat` and `exp`
 * default to an hour of validity so callers only state what they assert.
 */
export async function signedToken(
  signing: Signing,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const tokenHeader = base64Url(
    JSON.stringify({ alg: 'RS256', kid: signing.kid, ...header }),
  );
  const payload = base64Url(
    JSON.stringify({ iat: now, exp: now + 3_600, ...claims }),
  );
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    signing.privateKey,
    new TextEncoder().encode(`${tokenHeader}.${payload}`),
  );

  return `${tokenHeader}.${payload}.${base64Url(signature)}`;
}

/** Serves a JWKS document, recording requests so refresh and URL are observable. */
export function jwksFetcher(sets: Signing[][]): {
  fetcher: Fetcher;
  calls: () => number;
  urls: () => string[];
} {
  let calls = 0;
  const urls: string[] = [];

  const fetcher: Fetcher = (input) => {
    const set = sets[Math.min(calls, sets.length - 1)] ?? [];

    urls.push(input instanceof Request ? input.url : String(input));
    calls += 1;

    return Promise.resolve(
      Response.json({ keys: set.map((entry) => entry.jwk) }, { status: 200 }),
    );
  };

  return { fetcher, calls: () => calls, urls: () => urls };
}
