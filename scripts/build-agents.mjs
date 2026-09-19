#!/usr/bin/env node
/**
 * Builds `plugin/agents/` from this repository's own `agents/` tree.
 *
 * The agent definitions are vendored from oh-my-openagent, where they are
 * EXTRACTED from omo's own agent sources (see NOTICE.md and AGENTS.md). Here
 * they are the source of truth: this script validates their CodeBuddy
 * frontmatter, applies the optional per-agent model binding from
 * `agent-models.json`, and copies them into the plugin.
 *
 * Validation is deliberately strict — a CodeBuddy agent without `name` or
 * `description` is silently unusable, so the build fails instead.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(packageRoot, "agents");
const targetRoot = join(packageRoot, "plugin", "agents");
const bindingPath = join(packageRoot, "agent-models.json");

const REQUIRED_FIELDS = ["name", "description"];

/**
 * @param {string} content
 * @returns {{ fields: Record<string, string>, body: string } | null}
 */
export function parseFrontmatter(content) {
	if (!content.startsWith("---\n")) return null;
	const end = content.indexOf("\n---", 4);
	if (end === -1) return null;
	/** @type {Record<string, string>} */
	const fields = {};
	for (const line of content.slice(4, end).split(/\r?\n/)) {
		const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
		if (match) fields[match[1]] = match[2];
	}
	return { fields, body: content.slice(end + 4) };
}

export function validateAgentFile(name, content) {
	const parsed = parseFrontmatter(content);
	if (parsed === null) throw new Error(`agents/${name}: missing frontmatter block`);
	for (const field of REQUIRED_FIELDS) {
		if (typeof parsed.fields[field] !== "string" || parsed.fields[field].trim().length === 0) {
			throw new Error(`agents/${name}: frontmatter is missing ${field}`);
		}
	}
	if (parsed.body.trim().length < 200) throw new Error(`agents/${name}: body looks too short to be an agent prompt`);
	return parsed;
}

/** Sets, replaces, or removes one frontmatter field without touching the rest. */
export function withFrontmatterField(content, field, value) {
	const end = content.indexOf("\n---", 4);
	if (end === -1) return content;
	const lines = content.slice(4, end).split("\n");
	const pattern = new RegExp(`^${field}\\s*:`);
	const index = lines.findIndex((line) => pattern.test(line));
	const hasValue = value !== undefined && value !== null && String(value).trim().length > 0;

	if (!hasValue) {
		if (index === -1) return content;
		lines.splice(index, 1);
	} else if (index === -1) {
		lines.push(`${field}: ${value}`);
	} else {
		lines[index] = `${field}: ${value}`;
	}
	return `---\n${lines.join("\n")}${content.slice(end)}`;
}

/**
 * Applies `agent-models.json` to one agent file.
 *
 * CodeBuddy resolves a subagent's model from its own frontmatter, and there is
 * no runtime channel to pick a model per call (the `task` tool has no model
 * parameter and hooks cannot rewrite a model choice), so binding a model to a
 * ROLE here is what makes "route the work to the right model" possible.
 */
export function applyModelBinding(fileName, content, binding) {
	const agentName = fileName.replace(/\.md$/, "");
	let next = withFrontmatterField(content, "model", binding?.agents?.[agentName]);
	next = withFrontmatterField(next, "effort", binding?.effort?.[agentName]);
	return next;
}

export function normalizeBinding(parsed, knownAgents) {
	const agents = isRecord(parsed?.agents) ? parsed.agents : {};
	const effort = isRecord(parsed?.effort) ? parsed.effort : {};
	const unknown = [...Object.keys(agents), ...Object.keys(effort)].filter((name) => !knownAgents.includes(name));
	if (unknown.length > 0) {
		throw new Error(`agent-models.json names unknown agents: ${[...new Set(unknown)].join(", ")}`);
	}
	return { agents, effort };
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadModelBinding(knownAgents) {
	if (!existsSync(bindingPath)) return { agents: {}, effort: {} };
	let parsed = null;
	try {
		parsed = JSON.parse(await readFile(bindingPath, "utf8"));
	} catch (error) {
		throw new Error(`agent-models.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	return normalizeBinding(parsed, knownAgents);
}

export async function buildAgents({ check = false } = {}) {
	const files = (await readdir(sourceRoot)).filter((file) => file.endsWith(".md")).sort();
	if (files.length === 0) throw new Error("no agent sources found");

	const binding = await loadModelBinding(files.map((file) => file.replace(/\.md$/, "")));

	const rendered = new Map();
	for (const file of files) {
		const content = await readFile(join(sourceRoot, file), "utf8");
		validateAgentFile(file, content);
		const bound = applyModelBinding(file, content, binding);
		rendered.set(file, bound.endsWith("\n") ? bound : `${bound}\n`);
	}

	if (check) {
		for (const [file, expected] of rendered) {
			let actual = null;
			try {
				actual = await readFile(join(targetRoot, file), "utf8");
			} catch {
				throw new Error(`agent copy missing: ${file}`);
			}
			if (actual !== expected) throw new Error(`agent copy is stale: ${file}`);
		}
		return { agents: [...rendered.keys()], binding };
	}

	await rm(targetRoot, { recursive: true, force: true });
	await mkdir(targetRoot, { recursive: true });
	for (const [file, content] of rendered) {
		await writeFile(join(targetRoot, file), content, "utf8");
	}
	return { agents: [...rendered.keys()], binding };
}

if (import.meta.main) {
	const check = process.argv.includes("--check");
	const { agents, binding } = await buildAgents({ check });
	const bound = Object.entries(binding.agents).filter(([, value]) => String(value).trim().length > 0);
	console.log(check ? `agent check passed (${agents.length})` : `built ${agents.length} agents: ${agents.join(", ")}`);
	console.log(
		bound.length === 0
			? "model binding: none configured (agents run on the session default model)"
			: `model binding: ${bound.map(([name, model]) => `${name}→${model}`).join(", ")}`,
	);
}
