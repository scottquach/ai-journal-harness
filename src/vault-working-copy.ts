import { exec } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { tool, zodSchema } from 'ai';
import type { Tool } from 'ai';
import { z } from 'zod';

const execAsync = promisify(exec);

type WriteBuffer = Map<string, string>;

type VaultWorkingCopyOptions = {
    vaultPath: string;
};

type VaultTool = Tool<any, any>;

type VaultWorkingCopy = {
    tools: Record<string, VaultTool>;
    commitDiffs(logFn?: (msg: string) => void): string[];
};

const MUTABLE_PREFIXES = ['Journal/'];
const MUTABLE_EXACT = ['agent/memory.md'];

function isMutablePath(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    return (
        MUTABLE_PREFIXES.some((p) => normalized.startsWith(p)) ||
        MUTABLE_EXACT.includes(normalized)
    );
}

function resolveRelativePath(vaultPath: string, requestedPath: string): string {
    const normalizedVault = normalize(vaultPath);
    const fullPath = isAbsolute(requestedPath) ? requestedPath : join(vaultPath, requestedPath);
    const normalizedFull = normalize(fullPath);
    if (!normalizedFull.startsWith(normalizedVault + sep) && normalizedFull !== normalizedVault) {
        throw new Error(`Path escape attempt: ${requestedPath}`);
    }
    return normalizedFull.slice(normalizedVault.length).replace(/^[/\\]/, '').replace(/\\/g, '/');
}

function createVaultWorkingCopy(options: VaultWorkingCopyOptions): VaultWorkingCopy {
    const { vaultPath } = options;
    const writeBuffer: WriteBuffer = new Map();

    const readFileTool = tool({
        description: 'Read a file from the vault. Returns file contents as a string.',
        inputSchema: zodSchema(z.object({
            path: z.string().describe('Relative path within the vault, e.g. "Journal/2026-W21.md"'),
        })),
        execute: async ({ path }) => {
            try {
                const relativePath = resolveRelativePath(vaultPath, path);
                if (writeBuffer.has(relativePath)) {
                    return writeBuffer.get(relativePath)!;
                }
                const fullPath = join(vaultPath, relativePath);
                if (!existsSync(fullPath)) {
                    return `File not found: ${path}`;
                }
                return readFileSync(fullPath, 'utf8');
            } catch (err) {
                return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    });

    const writeFileTool = tool({
        description: 'Write content to a file in the vault. Only Journal/** and agent/memory.md are writable.',
        inputSchema: zodSchema(z.object({
            path: z.string().describe('Relative path within the vault'),
            content: z.string().describe('Full file content to write'),
        })),
        execute: async ({ path, content }) => {
            try {
                const relativePath = resolveRelativePath(vaultPath, path);
                if (!isMutablePath(relativePath)) {
                    return `Error: "${relativePath}" is read-only. Only Journal/** and agent/memory.md are writable.`;
                }
                writeBuffer.set(relativePath, content);
                return `Staged: ${relativePath}`;
            } catch (err) {
                return `Error: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    });

    const bashTool = tool({
        description: 'Execute a shell command with the vault as the working directory. Use for searching, listing, and reading files. Vault writes must go through writeFile, not shell redirection.',
        inputSchema: zodSchema(z.object({
            command: z.string().describe('Shell command to execute'),
        })),
        execute: async ({ command }) => {
            try {
                const { stdout, stderr } = await execAsync(command, {
                    cwd: vaultPath,
                    timeout: 15000,
                    maxBuffer: 1024 * 1024,
                    shell: process.platform === 'win32' ? 'bash' : '/bin/bash',
                });
                const out = stdout.trim();
                const err = stderr.trim();
                return [out, err ? `stderr: ${err}` : ''].filter(Boolean).join('\n') || '(no output)';
            } catch (err) {
                if (err && typeof err === 'object' && 'stdout' in err) {
                    const e = err as { message?: string; stdout?: string; stderr?: string };
                    return [`Error: ${e.message}`, e.stdout?.trim(), e.stderr ? `stderr: ${e.stderr.trim()}` : '']
                        .filter(Boolean)
                        .join('\n');
                }
                return `Error: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    });

    function commitDiffs(logFn?: (msg: string) => void): string[] {
        const persisted: string[] = [];
        for (const [relativePath, content] of writeBuffer) {
            const fullPath = join(vaultPath, relativePath);
            mkdirSync(dirname(fullPath), { recursive: true });
            writeFileSync(fullPath, content, 'utf8');
            persisted.push(relativePath);
            logFn?.(`persisted: ${relativePath}`);
        }
        writeBuffer.clear();
        return persisted;
    }

    return {
        tools: { readFile: readFileTool, writeFile: writeFileTool, bash: bashTool },
        commitDiffs,
    };
}

export { createVaultWorkingCopy, isMutablePath };
export type { VaultWorkingCopy, VaultWorkingCopyOptions };
