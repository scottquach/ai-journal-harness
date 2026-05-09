import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { TZDate } from '@date-fns/tz';
import { addDays, endOfDay, startOfDay } from 'date-fns';
import ical from 'node-ical';
import { z } from 'zod';

type ParsedCalendar = Record<string, any>;

type CalendarEvent = {
    uid: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    location: string;
    description: string;
    calendar: string;
    status: string;
};

type CalendarFetchOptions = {
    daysAhead?: number;
    startDate?: string;
    endDate?: string;
    search?: string;
};

type CalendarFetchResult = {
    events: CalendarEvent[];
    warnings: string[];
};

function getCalendarTimezone(): string {
    return process.env.BOT_TIMEZONE ?? 'America/Chicago';
}

function createZonedDay(dateString: string, timeZone: string): Date {
    const [year, month, day] = dateString.split('-').map(Number);
    return TZDate.tz(timeZone, year, month - 1, day);
}

function parseDateInput(dateString: string, timeZone: string, now = new Date()): Date {
    const normalized = dateString.trim().toLowerCase();
    const today = startOfDay(TZDate.tz(timeZone, now.getTime()));

    if (normalized === 'today') return today;
    if (normalized === 'tomorrow') return addDays(today, 1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return createZonedDay(normalized, timeZone);

    throw new Error(`Invalid calendar date: "${dateString}". Use YYYY-MM-DD, today, or tomorrow.`);
}

function getDefaultStartDate(now = new Date(), timeZone = getCalendarTimezone()): Date {
    return startOfDay(TZDate.tz(timeZone, now.getTime()));
}

/**
 * Fetch and parse events from a single iCal URL.
 * Returns raw parsed calendar data keyed by UID.
 */
async function fetchIcal(url: string, timeoutMs = 10000): Promise<ParsedCalendar> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        const text = await response.text();
        return ical.sync.parseICS(text);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Normalize a single event (or recurring instance) into a flat object.
 */
function normalizeEvent(instance: any, calendarLabel: string): CalendarEvent {
    const timeZone = getCalendarTimezone();
    const startRaw = instance.start instanceof Date ? instance.start : new Date(instance.start);
    const endRaw =
        instance.end instanceof Date
            ? instance.end
            : instance.start instanceof Date
              ? instance.start
              : new Date(instance.start);
    const isAllDay = Boolean(instance.isFullDay ?? (instance.event?.datetype === 'date'));
    const start = TZDate.tz(timeZone, startRaw.getTime());
    const end = TZDate.tz(timeZone, endRaw.getTime());

    return {
        uid: instance.event?.uid ?? instance.uid ?? '',
        title: instance.summary ?? instance.event?.summary ?? '',
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: isAllDay,
        location: instance.event?.location ?? instance.location ?? '',
        description: instance.event?.description ?? instance.description ?? '',
        calendar: calendarLabel,
        status: (instance.event?.status ?? instance.status ?? 'CONFIRMED').toUpperCase(),
    };
}

/**
 * Extract events from parsed iCal data within a date range.
 * Handles both single and recurring events via expandRecurringEvent.
 */
function extractEvents(parsed: ParsedCalendar, from: Date, to: Date, calendarLabel: string): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    for (const [, entry] of Object.entries(parsed)) {
        if (entry.type !== 'VEVENT') continue;

        const instances = ical.expandRecurringEvent(entry as any, {
            from,
            to,
            expandOngoing: true,
        });

        for (const instance of instances) {
            events.push(normalizeEvent(instance, calendarLabel));
        }
    }
    return events;
}

/**
 * Fetch calendar events from multiple iCal URLs and return a merged, sorted list.
 *
 * @param {string[]} urls - iCal feed URLs
 * @param {string[]} labels - Human-readable labels for each URL
 * @param {object} options
 * @param {number} [options.daysAhead=14] - Days into the future to fetch
 * @param {string} [options.startDate] - ISO date string for range start (defaults to today)
 * @param {string} [options.endDate] - ISO date string for range end (overrides daysAhead)
 * @param {string} [options.search] - Case-insensitive text filter on title/description
 * @returns {Promise<{events: object[], warnings: string[]}>}
 */
async function fetchCalendarEvents(urls: string[], labels: string[], options: CalendarFetchOptions = {}): Promise<CalendarFetchResult> {
    const { daysAhead = 14, startDate, endDate, search } = options;
    const timeZone = getCalendarTimezone();

    const from = startDate
        ? startOfDay(parseDateInput(startDate, timeZone))
        : getDefaultStartDate(new Date(), timeZone);
    const to = endDate ? endOfDay(parseDateInput(endDate, timeZone)) : addDays(from, daysAhead);

    const results = await Promise.allSettled(urls.map((url) => fetchIcal(url)));

    const allEvents: CalendarEvent[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const label = labels[i] || `Calendar ${i + 1}`;
        if (result.status === 'fulfilled') {
            const events = extractEvents(result.value, from, to, label);
            allEvents.push(...events);
        } else {
            const reason = result.reason instanceof Error ? result.reason.message : 'Unknown error';
            warnings.push(`Failed to fetch "${label}": ${reason}`);
        }
    }

    // Deduplicate by UID (keep first occurrence)
    const seen = new Set<string>();
    const deduped: CalendarEvent[] = [];
    for (const event of allEvents) {
        const key = event.uid + '|' + event.start;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(event);
    }

    // Sort by start time
    deduped.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    // Apply search filter
    let filtered = deduped;
    if (search) {
        const q = search.toLowerCase();
        filtered = deduped.filter((e) => e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
    }

    return { events: filtered, warnings };
}

/**
 * Create an in-process MCP server that exposes a get_calendar_events tool.
 *
 * @param {string[]} urls - iCal feed URLs
 * @param {string[]} labels - Human-readable labels for each URL
 * @returns {McpSdkServerConfigWithInstance}
 */
function createCalendarServer(urls: string[], labels: string[]) {
    return createSdkMcpServer({
        name: 'calendar',
        version: '1.0.0',
        tools: [
            tool(
                'get_calendar_events',
                'Fetch upcoming calendar events from all configured calendars. Returns a merged, sorted list of events.',
                {
                    days_ahead: z.number().optional().describe('Number of days into the future to fetch (default: 14)'),
                    start_date: z
                        .string()
                        .optional()
                        .describe('Date for range start: YYYY-MM-DD, today, or tomorrow. Defaults to today.'),
                    end_date: z
                        .string()
                        .optional()
                        .describe('Date for range end: YYYY-MM-DD, today, or tomorrow. Overrides days_ahead if provided.'),
                    search: z
                        .string()
                        .optional()
                        .describe('Case-insensitive text filter on event title and description'),
                },
                async (args) => {
                    const { events, warnings } = await fetchCalendarEvents(urls, labels, {
                        daysAhead: args.days_ahead,
                        startDate: args.start_date,
                        endDate: args.end_date,
                        search: args.search,
                    });

                    let text = JSON.stringify(events, null, 2);
                    if (warnings.length > 0) {
                        text += '\n\nWarnings:\n' + warnings.map((w) => `- ${w}`).join('\n');
                    }
                    if (events.length === 0 && warnings.length === 0) {
                        text = 'No events found in the requested date range.';
                    }

                    return { content: [{ type: 'text', text }] };
                },
            ),
        ],
    });
}

export {
    createCalendarServer,
    fetchCalendarEvents,
    extractEvents,
};
export type { CalendarEvent, CalendarFetchOptions, CalendarFetchResult, ParsedCalendar };
