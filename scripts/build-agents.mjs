#!/usr/bin/env node
/**
 * Builds `plugin/agents/` from this repository's own `agents/` tree.
 *
 * The agent definitions are vendored from oh-my-openagent, where they are
 * EXTRACTED from omo's own agent sources (see NOTICE.md and AGENTS.md). Here
 * they are the source of truth: this script validates their CodeBuddy
 * frontmatter and copies them into the plugin.
 *
 * Validation is deliberately strict — a CodeBuddy agent without `name` or
 * `description` is silently unusable, so the build fails instead.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(packageRoot, "agents");
const targetRoot = join(packageRoot, "plugin", "agents");

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

export async function buildAgents({ check = false } = {}) {
	const files = (await readdir(sourceRoot)).filter((file) => file.endsWith(".md")).sort();
	if (files.length === 0) throw new Error("no agent sources found");

	const rendered = new Map();
	for (const file of files) {
		const content = await readFile(join(sourceRoot, file), "utf8");
		validateAgentFile(file, content);
		rendered.set(file, content.endsWith("\n") ? content : `${content}\n`);
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
		return { agents: [...rendered.keys()] };
	}

	await rm(targetRoot, { recursive: true, force: true });
	await mkdir(targetRoot, { recursive: true });
	for (const [file, content] of rendered) {
		await writeFile(join(targetRoot, file), content, "utf8");
	}
	return { agents: [...rendered.keys()] };
}

if (import.meta.main) {
	const check = process.argv.includes("--check");
	const { agents } = await buildAgents({ check });
	console.log(check ? `agent check passed (${agents.length})` : `built ${agents.length} agents: ${agents.join(", ")}`);
}
