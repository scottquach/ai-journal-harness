import { parse as parseYaml } from 'yaml';

type SkillPolicy = Record<string, string[]>;

function parseToolsFromFrontmatter(content: string): string[] {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!fmMatch) return [];

    const frontmatter = parseYaml(fmMatch[1]);
    if (!frontmatter || typeof frontmatter !== 'object' || !('tools' in frontmatter)) return [];
    if (!Array.isArray(frontmatter.tools)) {
        throw new Error('SKILL.md frontmatter field "tools" must be a YAML list');
    }

    return frontmatter.tools.map((tool) => String(tool).trim()).filter(Boolean);
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function parseMcpServerName(toolName: string): string | null {
    const match = /^mcp__([^_]+)__/.exec(toolName);
    return match ? match[1] : null;
}

function skillNeedsUnavailableMcpTool(skillTools: string[] = [], availableMcpServers: string[] = []): boolean {
    const available = new Set(availableMcpServers);
    return skillTools.some((toolName) => {
        const serverName = parseMcpServerName(toolName);
        return serverName ? !available.has(serverName) : false;
    });
}

/**
 * Filter the discovered skill set down to the skills that can actually run in
 * this session, based on which MCP servers are configured.
 *
 * Non-MCP tools such as Read/Write/Edit are assumed to be available through
 * Claude Code itself. MCP-backed skills are omitted unless every referenced
 * server is configured.
 *
 * @param {Record<string, string[]>} toolsBySkill - Map of skill name → tool grants.
 * @param {{ mcpServers?: Record<string, unknown> }} options
 * @returns {string[]}
 */
function availableSkills(
    toolsBySkill: SkillPolicy = {},
    { mcpServers = {} }: { mcpServers?: Record<string, unknown> } = {},
): string[] {
    const availableMcpServers = Object.keys(mcpServers);

    return Object.keys(toolsBySkill).filter((skillName) => {
        const skillTools = toolsBySkill[skillName] ?? [];
        return !skillNeedsUnavailableMcpTool(skillTools, availableMcpServers);
    });
}

/**
 * Build the allowed-tools list for a given set of skills.
 *
 * @param {string[]} skills - Skill names to include.
 * @param {Record<string, string[]>} toolsBySkill - Map of skill name → tool grants.
 * @param {{ baseTools?: string[] }} options
 */
function toolsForSkills(
    skills: string[] = [],
    toolsBySkill: SkillPolicy = {},
    { baseTools = [] }: { baseTools?: string[] } = {},
): string[] {
    const skillTools = skills.flatMap((skill) => toolsBySkill[skill] ?? []);
    return unique([
        ...baseTools,
        'Skill',
        ...skillTools,
    ]);
}

export {
    type SkillPolicy,
    availableSkills,
    parseToolsFromFrontmatter,
    toolsForSkills,
};
