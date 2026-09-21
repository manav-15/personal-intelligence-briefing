import type { BriefingItem } from '../shared/briefings';

/** Evidence strength stored with one citation, as published by composition. */
export type CitationTier = BriefingItem['citations'][number]['evidenceTier'];

/**
 * Describes the citation tiers in plain words.
 *
 * The collapsed Sources summary states this beside the count, so folding the
 * citation list away never hides that a story was answered from a limited
 * source description rather than article evidence.
 */
export function evidenceSummary(tiers: readonly CitationTier[]): string {
  const article = tiers.filter((tier) => tier === 'article').length;
  const limited = tiers.length - article;
  const parts: string[] = [];

  if (article > 0)
    parts.push(
      article === tiers.length
        ? 'all article evidence'
        : `${String(article)} article evidence`,
    );

  if (limited === 1) parts.push('1 limited description');

  if (limited > 1) parts.push(`${String(limited)} limited descriptions`);

  return parts.join(' · ');
}
