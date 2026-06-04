export const MINUTES_IN_DAY = 24 * 60;
/** Wheel-scroll granularity for the manual time input. */
export const TIME_STEP_MINUTES = 5;

export const minutesToTime = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

export const timeToMinutes = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

export const buildTimeOptions = (
  startMinutes: number,
  endMinutes: number,
  stepMinutes: number,
) => {
  const out: string[] = [];
  for (let total = startMinutes; total <= endMinutes; total += stepMinutes) {
    out.push(minutesToTime(total));
  }
  return out;
};

/** Common exam start/end times (08:00–19:00, every 30 minutes) as one-click chips. */
export const COMMON_TIMES = buildTimeOptions(8 * 60, 19 * 60, 30);

/**
 * Parse a loosely-typed time string into a normalized "HH:mm", or null when
 * invalid. Accepts a half- or full-width colon, e.g. "9:5" -> "09:05".
 */
export function parseTimeInput(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})[:：](\d{1,2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Step a "HH:mm" time by whole grid units (e.g. 5 minutes), snapping
 * off-grid values to the grid first. Returns a normalized "HH:mm" clamped to
 * a single day.
 */
export function stepTime(time: string, direction: 1 | -1, stepMinutes: number): string {
  const current = timeToMinutes(time);
  const stepped =
    direction > 0
      ? Math.floor(current / stepMinutes) * stepMinutes + stepMinutes
      : Math.ceil(current / stepMinutes) * stepMinutes - stepMinutes;
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY - 1, stepped));
  return minutesToTime(clamped);
}
