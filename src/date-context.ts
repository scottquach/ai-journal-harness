const TIMEZONE = process.env.BOT_TIMEZONE ?? 'America/Chicago';

type ContextExtras = Record<string, string | number | boolean | null | undefined>;

function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function computeDateContext() {
  const now = new Date();
  const today = localDate(now, TIMEZONE);
  const currentTime = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);

  // Reconstruct a "week start" Date by parsing today's date in the target timezone
  const [year, month, day] = today.split('-').map(Number);
  const localNow = new Date(year, month - 1, day);
  const weekStart = new Date(localNow);
  weekStart.setDate(localNow.getDate() - localNow.getDay());
  const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

  const jan1 = new Date(weekStart.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((weekStart.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);

  return { today, currentTime, weekStartStr, weekNum, year: weekStart.getFullYear() };
}

/**
 * Build a [Context: ...] string from the current date/time plus any caller-supplied extras.
 * Extra entries are appended as  key="value"  pairs after the standard fields.
 */
function buildContextString(extras: ContextExtras = {}): string {
  const { today, currentTime, weekStartStr, weekNum } = computeDateContext();
  let context = `today is ${today}, current time is ${currentTime}, timezone is ${TIMEZONE}, current week starts ${weekStartStr}, week number ${weekNum}`;
  for (const [key, value] of Object.entries(extras)) {
    context += `, ${key}="${value}"`;
  }
  return `[Context: ${context}]`;
}

export { type ContextExtras, localDate, computeDateContext, buildContextString };
