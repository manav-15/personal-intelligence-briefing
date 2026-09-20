import { describe, expect, it } from 'vitest';
import {
  decodeGoogleNewsPublisherUrl,
  decodedPublisherUrl,
  googleArticleId,
} from './google-news-decoder';
import type { Fetcher } from './types';

const sourceUrl = 'https://news.google.com/rss/articles/opaque-id?oc=5';
const decoderPayload = `)]}'\n\n${JSON.stringify([
  [
    'wrb.fr',
    'Fbv4je',
    JSON.stringify([null, 'https://publisher.example/article']),
  ],
])}`;

describe('Google News publisher-link decoder', () => {
  it('accepts only a Google RSS article identifier', () => {
    expect(googleArticleId(sourceUrl)).toBe('opaque-id');
    expect(
      googleArticleId('https://news.google.com/read/opaque-id'),
    ).toBeNull();
    expect(googleArticleId('https://publisher.example/article')).toBeNull();
  });

  it('decodes a bounded parameter page and batchexecute result', async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fetcher: Fetcher = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);

      calls.push({ url, method: init?.method });

      return Promise.resolve(
        url.includes('/rss/articles/')
          ? new Response(
              '<div data-n-a-sg="signature" data-n-a-ts="123"></div>',
            )
          : new Response(decoderPayload),
      );
    };

    await expect(
      decodeGoogleNewsPublisherUrl(sourceUrl, fetcher),
    ).resolves.toEqual({
      ok: true,
      publisherUrl: 'https://publisher.example/article',
    });
    expect(calls).toEqual([
      {
        url: 'https://news.google.com/rss/articles/opaque-id',
        method: undefined,
      },
      {
        url: 'https://news.google.com/_/DotsSplashUi/data/batchexecute',
        method: 'POST',
      },
    ]);
  });

  it('contains malformed and challenge responses without returning a Google URL', async () => {
    await expect(
      decodeGoogleNewsPublisherUrl(sourceUrl, () =>
        Promise.resolve(new Response('captcha')),
      ),
    ).resolves.toEqual({
      ok: false,
      message: 'Google News challenged publisher-link decoding.',
    });
    expect(decodedPublisherUrl('not JSON')).toBeNull();
    expect(
      decodedPublisherUrl(
        `)]}'\n\n${JSON.stringify([
          [
            'wrb.fr',
            'Fbv4je',
            JSON.stringify([null, 'https://news.google.com/read/again']),
          ],
        ])}`,
      ),
    ).toBeNull();
  });
});
