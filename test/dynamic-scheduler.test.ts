import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDynamicScheduler } from '../src/dynamic-scheduler.js';

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

test('dynamic scheduler mirrors persisted schedules to the agent folder', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'dynamic-scheduler-test-'));
    const persistPath = join(tempDirectory, 'schedules', 'dynamic-schedules.json');
    const persistMirrorPath = join(tempDirectory, 'agent', 'dynamic-schedules.md');

    try {
        const scheduler = createDynamicScheduler({
            bot: makeFakeBot(),
            dispatchTurn: null,
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

        const persisted = JSON.parse(readFileSync(persistPath, 'utf8'));
        const mirrored = readFileSync(persistMirrorPath, 'utf8');

        assert.equal(persisted[0].id, id);
        assert.match(mirrored, /# Dynamic Schedules/);
        assert.match(mirrored, /Mirror Check/);
        assert.match(mirrored, /Visible from Obsidian/);

        scheduler.cancelSchedule(id);

        assert.deepEqual(JSON.parse(readFileSync(persistPath, 'utf8')), []);
        assert.match(readFileSync(persistMirrorPath, 'utf8'), /No active dynamic schedules\./);
    } finally {
        rmSync(tempDirectory, { force: true, recursive: true });
    }
});
