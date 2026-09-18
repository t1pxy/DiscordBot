/** Parses a `YYYY-MM-DD` + `HH:mm` pair (interpreted as Thai local time, UTC+7) into a UTC epoch ms. */
export function parseThaiDate(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return Date.UTC(year, month - 1, day, hour - 7, minute);
}

/** Formats an epoch ms as a Discord timestamp: absolute + relative, e.g. `<t:...:F> (<t:...:R>)`. */
export function discordTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}
