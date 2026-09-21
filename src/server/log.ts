/**
 * One structured event for Cloudflare Workers Logs. Every call emits a single
 * JSON line so the dashboard can index `event` and the numeric fields.
 *
 * Callers pass identifiers, counts, durations, and bounded code-owned messages.
 * Article text, model output, prompts, credentials, and user-authored wording
 * never belong in a log line: the platform persists these events.
 */
export function logEvent(
  event: string,
  fields: Record<string, string | number | boolean | null | string[]> = {},
  level: 'info' | 'warn' = 'info',
): void {
  const line = JSON.stringify({ event, ...fields });

  if (level === 'warn') {
    console.warn(line);

    return;
  }

  console.log(line);
}

/**
 * Extracts one bounded message from a thrown value. Thrown messages carry field
 * paths and status text; model output and request bodies are never part of them,
 * so the result is safe to log.
 */
export function boundedMessage(error: unknown, limit = 300): string {
  if (error instanceof Error && error.message.trim())
    return error.message.slice(0, limit);

  return 'Unknown error.';
}
