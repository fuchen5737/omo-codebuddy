#!/usr/bin/env node
/**
 * Builds the whole CodeBuddy plugin: bundled hooks, adapted skills, copied
 * agents, generated commands, generated MCP config — then validates the result.
 *
 * `--check` verifies the built artifact instead of rewriting it, which is what
 * CI runs.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAgents } from "./build-agents.mjs";
import { buildHooks } from "./build-hooks.mjs";
import { buildSkills } from "./build-skills.mjs";
import { generateCommands } from "./generate-commands.mjs";
import { generateMcp } from "./generate-mcp.mjs";
import { validatePlugin } from "./validate-plugin.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginRoot = join(packageRoot, "plugin");

export async function buildPlugin({ check = false } = {}) {
	const steps = [];

	if (check) {
		await buildSkills({ check: true });
		await buildAgents({ check: true });
		await generateCommands({ check: true });
		await generateMcp({ check: true });
		steps.push("skills/agents/commands/mcp verified");
	} else {
		const hooks = await buildHooks();
		steps.push(`hooks bundled (${hooks.bytes} bytes)`);
		const skills = await buildSkills();
		steps.push(`${skills.skillNames.length} skills built`);
		const agents = await buildAgents();
		steps.push(`${agents.agents.length} agents copied`);
		const commands = await generateCommands();
		steps.push(`${commands.files.length} commands generated`);
		const mcp = await generateMcp();
		steps.push(`mcp servers: ${Object.keys(mcp.mcpServers).join(", ")}`);
	}

	const validation = validatePlugin(pluginRoot);
	if (!validation.ok) {
		for (const problem of validation.problems) console.error(` - ${problem}`);
		throw new Error(`plugin validation failed (${validation.problems.length} problems)`);
	}
	steps.push(
		`validated: ${validation.summary.skills} skills, ${validation.summary.agents} agents, ${validation.summary.commands} commands`,
	);

	return steps;
}

if (import.meta.main) {
	const check = process.argv.includes("--check");
	const steps = await buildPlugin({ check });
	for (const step of steps) console.log(`- ${step}`);
	console.log(check ? "plugin build check passed" : "plugin build complete");
}
