#!/usr/bin/env node
// @three-ws/marketplace-mcp — MCP server entry point.
//
// Gives any AI assistant browse/discovery of the three.ws marketplace over
// stdio:
//   • browse_agents     — search & page the agent marketplace
//   • agent_detail      — fetch one agent by id
//   • agent_categories  — list agent categories with counts
//   • browse_skills     — search & page the skills catalog
//   • skill_categories  — list skill categories with counts
//
// A thin, read-only wrapper over the PUBLIC three.ws API (/api/marketplace and
// /api/skills). No keys, no signer, no payment — point THREE_WS_BASE at a
// deployment and go. Creating or publishing agents and skills is the
// authenticated write path on the HTTP API; this MCP exposes browse only.
//
// Run standalone:
//   node packages/marketplace-mcp/src/index.js
//
// Or wire into Claude Code / Cursor — see README.md.

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { def as browseAgents } from './tools/browse-agents.js';
import { def as agentDetail } from './tools/agent-detail.js';
import { def as agentCategories } from './tools/agent-categories.js';
import { def as browseSkills } from './tools/browse-skills.js';
import { def as skillCategories } from './tools/skill-categories.js';

// Single source of truth for the advertised server version — package.json.
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

export const TOOLS = [browseAgents, agentDetail, agentCategories, browseSkills, skillCategories];

/**
 * Construct a fully-registered McpServer without connecting a transport.
 * Registration is env-free, so this is safe to import from tests.
 * @returns {McpServer}
 */
export function buildServer() {
	const server = new McpServer(
		{ name: 'marketplace-mcp', title: 'three.ws Marketplace', version: PKG_VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				'three.ws Marketplace MCP — browse and discover the public three.ws agent marketplace and skills ' +
				'catalog. browse_agents searches and pages published agents (filter by category and query, sort by ' +
				'recommended/recent/popular/top_rated); agent_detail fetches one agent by id; agent_categories lists ' +
				'the agent categories with counts. browse_skills searches and pages the skills catalog (sort by ' +
				'popular/new/az); skill_categories lists the skill categories with counts. All data comes live from ' +
				'the public three.ws /api/marketplace and /api/skills endpoints — no API key, signer, or payment ' +
				'required. Creating or publishing agents and skills is the authenticated write path on the HTTP API; ' +
				'this server exposes browse/discovery only.',
		},
	);

	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
				annotations: tool.annotations,
			},
			async (args, extra) => {
				try {
					const result = await tool.handler(args, extra);
					const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
					return { content: [{ type: 'text', text }] };
				} catch (err) {
					const payload = {
						ok: false,
						error: err?.code || 'unhandled',
						message: err?.message || String(err),
						...(err?.status ? { status: err.status } : {}),
					};
					return {
						content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
						isError: true,
					};
				}
			},
		);
	}

	return server;
}

async function main() {
	const server = buildServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error(`[marketplace-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
}

// Connect stdio ONLY when this file is the process entry point. Importing the
// module (tests, embedding) must not grab the transport. realpath both sides:
// npm bin shims are symlinks, so argv[1] may differ from import.meta.url.
function isProcessEntryPoint() {
	if (!process.argv[1]) return false;
	try {
		return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
	} catch {
		return false;
	}
}

if (isProcessEntryPoint()) {
	main().catch((err) => {
		console.error('[marketplace-mcp] fatal:', err);
		process.exit(1);
	});
}
