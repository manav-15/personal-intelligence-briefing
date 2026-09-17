/** Removes executable markup/tags and decodes common HTML entities into plain text. */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (entity: string, number: string) => {
      const value = number.toLowerCase().startsWith('x')
        ? Number.parseInt(number.slice(1), 16)
        : Number(number);
      return value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : entity;
    })
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Qualifies an informative description, rejecting empty or repeated-headline metadata. */
export function hasInformativeDescription(
  title: string,
  description: string,
): boolean {
  if (
    /follow this (section|tag)|update your preferences|enable javascript|accept (all )?cookies|sign in to (continue|read)/iu.test(
      description,
    )
  )
    return false;
  const normalize = (text: string) =>
    text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const words = normalize(description);
  const headline = new Set(normalize(title));
  return (
    description.length >= 80 &&
    words.length >= 12 &&
    new Set(words.filter((word) => !headline.has(word))).size >= 3
  );
}
