import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAgentRegistry } from './agent-registry.js';

test('loadAgentRegistry hydrates parent config', () => {
    const files = {
        '/project/agents/registry.json': JSON.stringify({
            parent: { id: 'parent', description: 'Parent router', botConfigPath: 'parent/BOT.md' },
        }),
        '/project/agents/parent/BOT.md': `---
name: parent
model: haiku
tools:
  - Skill
directories:
  - \${VAULT_PATH}
---

Parent instructions.
`,
    };

    const readFile = (path) => {
        if (files[path]) return files[path];
        throw Object.assign(new Error(`Missing file: ${path}`), { code: 'ENOENT' });
    };

    const registry = loadAgentRegistry('/project/agents/registry.json', {
        env: { VAULT_PATH: '/vault' },
        readFile,
        readdirSync: () => {
            throw Object.assign(new Error('Missing directory'), { code: 'ENOENT' });
        },
    });

    assert.equal(registry.parent.id, 'parent');
    assert.equal(registry.parent.description, 'Parent router');
    assert.deepEqual(registry.directories, ['/vault']);
    assert.match(registry.parent.systemPrompt, /Parent instructions/);
});

test('loadAgentRegistry throws when parent config is missing', () => {
    const files = {
        '/project/agents/registry.json': JSON.stringify({
            agents: [{ id: 'legacy-child', botConfigPath: 'child/BOT.md' }],
        }),
    };

    const readFile = (path) => {
        if (files[path]) return files[path];
        throw Object.assign(new Error(`Missing file: ${path}`), { code: 'ENOENT' });
    };

    assert.throws(
        () => loadAgentRegistry('/project/agents/registry.json', {
            readFile,
            readdirSync: () => {
                throw Object.assign(new Error('Missing directory'), { code: 'ENOENT' });
            },
        }),
        /Agent registry missing required field: parent/
    );
});
