import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDynamicScheduler } from './dynamic-scheduler.js';

function makeFakeBot() {
    return {
        telegram: {
            async sendMessage() {
                return undefined;
            },
        },
    };
}

function makeFakeCron() {
    return {
        schedule() {
            return {
                stop() {
                    return undefined;
                },
            };
        },
    };
}

test('dynamic scheduler mirrors persisted schedules to the memory vault', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'dynamic-scheduler-test-'));
    const persistPath = join(tempDirectory, 'schedules', 'dynamic-schedules.json');
    const persistMirrorPath = join(tempDirectory, 'memory', 'vault', 'schedules', 'dynamic-schedules.json');

    try {
        const scheduler = createDynamicScheduler({
            bot: makeFakeBot(),
            runParentAgent: null,
            persistPath,
            persistMirrorPath,
            timezone: 'America/Los_Angeles',
            cron: makeFakeCron(),
        });

        const id = scheduler.scheduleMessage({
            label: 'Mirror Check',
            message: 'Visible from Obsidian',
            schedule: '0 9 * * *',
        });

        assert.deepEqual(
            JSON.parse(readFileSync(persistMirrorPath, 'utf8')),
            JSON.parse(readFileSync(persistPath, 'utf8')),
        );

        scheduler.cancelSchedule(id);

        assert.deepEqual(JSON.parse(readFileSync(persistMirrorPath, 'utf8')), []);
    } finally {
        rmSync(tempDirectory, { force: true, recursive: true });
    }
});
