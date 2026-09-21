/**
 * Calendar date and minutes-from-midnight in one IANA timezone.
 */
export type LocalClock = {
  date: string;
  minutes: number;
};

/**
 * Reads the local calendar date and clock in `timezone` at `now`.
 *
 * `date` is `YYYY-MM-DD`. `minutes` is hours and minutes from local midnight,
 * using a 24-hour clock so 08:00 is 480.
 */
export function localClock(now: Date, timezone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const year = readPart(parts, 'year');
  const month = readPart(parts, 'month');
  const day = readPart(parts, 'day');
  const hour = readPart(parts, 'hour');
  const minute = readPart(parts, 'minute');

  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new Error(
      'Timezone formatting did not return a complete local clock.',
    );
  }

  return {
    date: `${year}-${month}-${day}`,
    minutes: Number(hour) * 60 + Number(minute),
  };
}

/**
 * Local calendar date `YYYY-MM-DD` in `timezone` at `now`.
 */
export function localDate(now: Date, timezone: string): string {
  return localClock(now, timezone).date;
}

/**
 * Whether `now` is at or after `schedule.localTime` on that local calendar date.
 */
export function isScheduledTimeReached(
  now: Date,
  schedule: { localTime: string; timezone: string },
): { due: boolean; date: string } {
  const clock = localClock(now, schedule.timezone);
  const [hours, minutes] = schedule.localTime.split(':');

  return {
    date: clock.date,
    due: clock.minutes >= Number(hours) * 60 + Number(minutes),
  };
}

function readPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string | undefined {
  return parts.find((part) => part.type === type)?.value;
}
