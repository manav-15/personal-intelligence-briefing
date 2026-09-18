/** Reads actual streamed bytes within a bound; null means the body was too large. */
export async function readBoundedText(
  response: Pick<Response, 'body' | 'headers'>,
  maximumBytes: number,
): Promise<string | null> {
  if (Number(response.headers.get('content-length')) > maximumBytes) {
    await response.body?.cancel();

    return null;
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;
    bytes += value.byteLength;

    if (bytes > maximumBytes) {
      await reader.cancel();

      return null;
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}
