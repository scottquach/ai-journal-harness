import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import ical from 'node-ical';
import { extractEvents, fetchCalendarEvents } from './calendar.js';

const originalBotTimezone = process.env.BOT_TIMEZONE;

// Minimal valid iCal for a single timed event
function makeIcs({ uid = 'evt-1', summary = 'Test Event', dtstart = '20260405T090000Z', dtend = '20260405T100000Z', location = '', description = '', status = 'CONFIRMED', rrule = '' } = {}) {
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//Test//EN',
        `BEGIN:VEVENT`,
        `UID:${uid}`,
        `SUMMARY:${summary}`,
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        location ? `LOCATION:${location}` : '',
        description ? `DESCRIPTION:${description}` : '',
        `STATUS:${status}`,
        rrule ? `RRULE:${rrule}` : '',
        `END:VEVENT`,
        'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
}

// All-day event uses DATE format (no time)
function makeAllDayIcs({ uid = 'allday-1', summary = 'All Day', dtstart = '20260405', dtend = '20260406' } = {}) {
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `SUMMARY:${summary}`,
        `DTSTART;VALUE=DATE:${dtstart}`,
        `DTEND;VALUE=DATE:${dtend}`,
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');
}

// Mock global fetch
let fetchMock: any;
beforeEach(() => {
    fetchMock = mock.fn();
    global.fetch = fetchMock;
});
afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
    if (originalBotTimezone === undefined) delete process.env.BOT_TIMEZONE;
    else process.env.BOT_TIMEZONE = originalBotTimezone;
    delete (globalThis as any).fetch;
});

function mockFetchResponse(body: string, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        text: async () => body,
    };
}

describe('fetchCalendarEvents', () => {
    it('returns events within the date range', async () => {
        const ics = makeIcs({ dtstart: '20260405T090000Z', dtend: '20260405T100000Z' });
        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        const { events, warnings } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            ['Test'],
            { startDate: '2026-04-01', endDate: '2026-04-10' },
        );

        assert.equal(warnings.length, 0);
        assert.equal(events.length, 1);
        assert.equal(events[0].title, 'Test Event');
        assert.equal(events[0].calendar, 'Test');
    });

    it('filters out events outside the date range', async () => {
        const ics = makeIcs({ dtstart: '20260420T090000Z', dtend: '20260420T100000Z' });
        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        const { events } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            ['Test'],
            { startDate: '2026-04-01', endDate: '2026-04-10' },
        );

        assert.equal(events.length, 0);
    });

    it('merges events from multiple calendars', async () => {
        const ics1 = makeIcs({ uid: 'a', summary: 'Event A', dtstart: '20260405T090000Z', dtend: '20260405T100000Z' });
        const ics2 = makeIcs({ uid: 'b', summary: 'Event B', dtstart: '20260406T140000Z', dtend: '20260406T150000Z' });

        let callIdx = 0;
        fetchMock.mock.mockImplementation(async () => {
            return mockFetchResponse(callIdx++ === 0 ? ics1 : ics2);
        });

        const { events, warnings } = await fetchCalendarEvents(
            ['https://a.com/cal.ics', 'https://b.com/cal.ics'],
            ['Work', 'Personal'],
            { startDate: '2026-04-01', endDate: '2026-04-10' },
        );

        assert.equal(warnings.length, 0);
        assert.equal(events.length, 2);
        assert.equal(events[0].title, 'Event A');
        assert.equal(events[0].calendar, 'Work');
        assert.equal(events[1].title, 'Event B');
        assert.equal(events[1].calendar, 'Personal');
    });

    it('deduplicates events with the same UID and start time', async () => {
        const ics = makeIcs({ uid: 'dup', summary: 'Dup Event', dtstart: '20260405T090000Z', dtend: '20260405T100000Z' });
        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        const { events } = await fetchCalendarEvents(
            ['https://a.com/cal.ics', 'https://b.com/cal.ics'],
            ['Cal A', 'Cal B'],
            { startDate: '2026-04-01', endDate: '2026-04-10' },
        );

        assert.equal(events.length, 1);
    });

    it('handles partial failure with warnings', async () => {
        const ics = makeIcs({ dtstart: '20260405T090000Z', dtend: '20260405T100000Z' });
        let callIdx = 0;
        fetchMock.mock.mockImplementation(async () => {
            if (callIdx++ === 0) throw new Error('Network error');
            return mockFetchResponse(ics);
        });

        const { events, warnings } = await fetchCalendarEvents(
            ['https://bad.com/cal.ics', 'https://good.com/cal.ics'],
            ['Bad', 'Good'],
            { startDate: '2026-04-01', endDate: '2026-04-10' },
        );

        assert.equal(events.length, 1);
        assert.equal(warnings.length, 1);
        assert.ok(warnings[0].includes('Bad'));
        assert.ok(warnings[0].includes('Network error'));
    });

    it('applies search filter on title', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:1',
            'SUMMARY:Team Standup',
            'DTSTART:20260405T090000Z',
            'DTEND:20260405T093000Z',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:2',
            'SUMMARY:Lunch Break',
            'DTSTART:20260405T120000Z',
            'DTEND:20260405T130000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\r\n');

        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        const { events } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            ['Test'],
            { startDate: '2026-04-01', endDate: '2026-04-10', search: 'standup' },
        );

        assert.equal(events.length, 1);
        assert.equal(events[0].title, 'Team Standup');
    });

    it('defaults to 14 days ahead when no end_date or days_ahead given', async () => {
        const ics = makeIcs({ dtstart: '20260405T090000Z', dtend: '20260405T100000Z' });
        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        // This should not throw; just verify it runs with defaults
        const { events } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            ['Test'],
        );

        // Result depends on current date vs event date, just verify no crash
        assert.ok(Array.isArray(events));
    });

    it('uses the configured timezone when defaulting start_date to today', async () => {
        process.env.BOT_TIMEZONE = 'America/Chicago';
        mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-04T01:30:00.000Z') });

        const ics = makeIcs({
            summary: 'Late Tonight Local',
            dtstart: '20260404T001500Z',
            dtend: '20260404T011500Z',
        });
        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        const { events, warnings } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            ['Test'],
        );

        assert.equal(warnings.length, 0);
        assert.equal(events.length, 1);
        assert.equal(events[0].title, 'Late Tonight Local');
    });

    it('accepts today as an explicit date range', async () => {
        process.env.BOT_TIMEZONE = 'America/Chicago';
        mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-05T18:00:00.000Z') });

        const ics = makeIcs({
            summary: 'Afternoon Event',
            dtstart: '20260405T200000Z',
            dtend: '20260405T210000Z',
        });
        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        const { events, warnings } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            ['Test'],
            { startDate: 'today', endDate: 'today' },
        );

        assert.equal(warnings.length, 0);
        assert.equal(events.length, 1);
        assert.equal(events[0].title, 'Afternoon Event');
    });

    it('accepts tomorrow as an explicit date range', async () => {
        process.env.BOT_TIMEZONE = 'America/Chicago';
        mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-05T18:00:00.000Z') });

        const ics = makeIcs({
            summary: 'Tomorrow Event',
            dtstart: '20260406T150000Z',
            dtend: '20260406T160000Z',
        });
        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        const { events } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            ['Test'],
            { startDate: 'tomorrow', endDate: 'tomorrow' },
        );

        assert.equal(events.length, 1);
        assert.equal(events[0].title, 'Tomorrow Event');
    });

    it('sorts events by start time', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:late',
            'SUMMARY:Late Event',
            'DTSTART:20260406T140000Z',
            'DTEND:20260406T150000Z',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:early',
            'SUMMARY:Early Event',
            'DTSTART:20260405T080000Z',
            'DTEND:20260405T090000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\r\n');

        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        const { events } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            ['Test'],
            { startDate: '2026-04-01', endDate: '2026-04-10' },
        );

        assert.equal(events.length, 2);
        assert.equal(events[0].title, 'Early Event');
        assert.equal(events[1].title, 'Late Event');
    });

    it('handles all-day events', async () => {
        const ics = makeAllDayIcs();
        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        const { events } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            ['Test'],
            { startDate: '2026-04-01', endDate: '2026-04-10' },
        );

        assert.equal(events.length, 1);
        assert.equal(events[0].title, 'All Day');
        assert.equal(events[0].allDay, true);
    });

    it('uses default label when none provided', async () => {
        const ics = makeIcs({ dtstart: '20260405T090000Z', dtend: '20260405T100000Z' });
        fetchMock.mock.mockImplementation(async () => mockFetchResponse(ics));

        const { events } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            [],
            { startDate: '2026-04-01', endDate: '2026-04-10' },
        );

        assert.equal(events[0].calendar, 'Calendar 1');
    });

    it('returns empty when all sources fail', async () => {
        fetchMock.mock.mockImplementation(async () => { throw new Error('fail'); });

        const { events, warnings } = await fetchCalendarEvents(
            ['https://bad.com/cal.ics'],
            ['Bad'],
            { startDate: '2026-04-01', endDate: '2026-04-10' },
        );

        assert.equal(events.length, 0);
        assert.equal(warnings.length, 1);
    });

    it('handles HTTP error responses', async () => {
        fetchMock.mock.mockImplementation(async () => mockFetchResponse('Not Found', 404));

        const { events, warnings } = await fetchCalendarEvents(
            ['https://example.com/cal.ics'],
            ['Test'],
            { startDate: '2026-04-01', endDate: '2026-04-10' },
        );

        assert.equal(events.length, 0);
        assert.equal(warnings.length, 1);
        assert.ok(warnings[0].includes('404'));
    });
});

describe('extractEvents', () => {
    it('extracts events from parsed iCal data', () => {
        const icsText = makeIcs({ dtstart: '20260405T090000Z', dtend: '20260405T100000Z', location: 'Office' });
        const parsed = ical.sync.parseICS(icsText);
        const from = new Date('2026-04-01');
        const to = new Date('2026-04-10');

        const events = extractEvents(parsed, from, to, 'Work');

        assert.equal(events.length, 1);
        assert.equal(events[0].title, 'Test Event');
        assert.equal(events[0].location, 'Office');
        assert.equal(events[0].calendar, 'Work');
    });
});
