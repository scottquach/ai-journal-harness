import { readFileSync, readdirSync as fsReaddirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { parse as parseYaml } from 'yaml';

type Frontmatter = Record<string, unknown>;

type BotConfig = {
  name: string;
  description: string;
  model: string;
  tools: string[];
  directories: string[];
  systemPrompt: string;
};

type BotConfigLoaderOptions = {
  readFile?: (path: string) => string;
  readdirSync?: (path: string) => Array<string | { name: string }>;
  env?: NodeJS.ProcessEnv;
};

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    throw new Error('File must start with YAML frontmatter delimited by ---');
  }

  const withoutOpening = content.slice(4);
  const closingIdx = withoutOpening.search(/\n---(\r?\n|$)/);
  if (closingIdx === -1) throw new Error('Could not find closing --- in frontmatter');

  const yamlBlock = withoutOpening.slice(0, closingIdx);
  const body = withoutOpening.slice(closingIdx).replace(/^\n---\r?\n/, '').trim();

  const parsed = parseYaml(yamlBlock);
  return { frontmatter: parsed && typeof parsed === 'object' ? parsed as Frontmatter : {}, body };
}

function expandEnvVars(str: string, env: NodeJS.ProcessEnv): string {
  return str.replace(/\$\{([^}]+)\}/g, (match, key) => (key in env ? env[key] ?? match : match));
}

function joinPath(baseDir: string, ...parts: string[]): string {
  return baseDir.startsWith('/') ? posix.join(baseDir, ...parts) : join(baseDir, ...parts);
}

function loadBotConfig(botMdPath: string, promptsDir: string, opts: BotConfigLoaderOptions = {}): BotConfig {
  const readFile = opts.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const readdirSync = opts.readdirSync ?? ((d) => fsReaddirSync(d));
  const env = opts.env ?? process.env;
  const configDir = dirname(botMdPath);

  const { frontmatter, body } = parseFrontmatter(readFile(botMdPath));

  // Prepend CLAUDE.md identity if present
  let prompt = '';
  try {
    const identity = readFile(joinPath(configDir, 'CLAUDE.md')).trim();
    if (identity) prompt = identity + '\n\n---\n\n';
  } catch {}

  prompt += body;

  // Append supplementary prompts from promptsDir
  try {
    const files = readdirSync(promptsDir)
      .map((f) => (typeof f === 'string' ? f : f.name))
      .filter((f) => f.endsWith('.md'))
      .sort();

    for (const filename of files) {
      try {
        prompt += '\n\n---\n\n' + readFile(joinPath(promptsDir, filename)).trim();
      } catch {}
    }
  } catch {}

  return {
    name: typeof frontmatter.name === 'string' ? frontmatter.name : '',
    description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
    model: String(frontmatter.model),
    tools: Array.isArray(frontmatter.tools) ? frontmatter.tools.map(String) : [],
    directories: Array.isArray(frontmatter.directories)
      ? frontmatter.directories.map((d) => expandEnvVars(String(d), env))
      : [],
    systemPrompt: expandEnvVars(prompt, env),
  };
}

export { parseFrontmatter, loadBotConfig };
export type { BotConfig, BotConfigLoaderOptions, Frontmatter };
