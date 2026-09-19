import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adaptSkillForCodeBuddy, insertCodeBuddyCompatibility, stripSection } from "../scripts/build-skills.mjs";
import {
	applyModelBinding,
	normalizeBinding,
	parseFrontmatter,
	validateAgentFile,
} from "../scripts/build-agents.mjs";
import { buildMcpConfig } from "../scripts/generate-mcp.mjs";
import { parseArgs, marketplaceDir, installedPluginDir, settingsPathFor } from "../scripts/install-local.mjs";
import { validatePlugin } from "../scripts/validate-plugin.mjs";

const pluginRoot = join(import.meta.dirname, "..", "plugin");

describe("skill adaptation", () => {
	test("strips other harnesses' compatibility sections", () => {
		const content = [
			"# Skill",
			"",
			"body",
			"",
			"## Codex Harness Tool Compatibility",
			"",
			"old guidance",
			"",
			"## Next",
			"",
			"tail",
		].join("\n");
		const stripped = stripSection(content, "## Codex Harness Tool Compatibility");
		expect(stripped).not.toContain("old guidance");
		expect(stripped).toContain("## Next");
		expect(stripped).toContain("tail");
	});

	test("inserts the CodeBuddy section only for OpenCode vocabulary", () => {
		const pure = "# Skill\n\nplain prose about editing files\n";
		expect(insertCodeBuddyCompatibility(pure)).toBe(pure);

		const opencode = '# Skill\n\ncall call_omo_agent(subagent_type="explore")\n';
		const adapted = insertCodeBuddyCompatibility(opencode);
		expect(adapted).toContain("## CodeBuddy Harness Tool Compatibility");
		expect(adapted.indexOf("## CodeBuddy")).toBeLessThan(adapted.indexOf("call_omo_agent"));
	});

	test("normalizes harness session prefixes and skill invocations", () => {
		const adapted = adaptSkillForCodeBuddy(
			"# S\n\nrecord under `codex:<session_id>` and `senpi:<session_id>`; see `/skill:ulw-plan`\n",
		);
		expect(adapted).toContain("`codebuddy:<session_id>`");
		expect(adapted).not.toContain("codex:");
		expect(adapted).toContain("`/omo:ulw-plan`");
	});

	test("is idempotent", () => {
		const once = adaptSkillForCodeBuddy("# S\n\ncall_omo_agent(...)\n");
		expect(adaptSkillForCodeBuddy(once)).toBe(once);
	});

	test("is idempotent with a mid-file section and no frontmatter", () => {
		const source = [
			"# Skill",
			"",
			"intro",
			"",
			"## CodeBuddy Harness Tool Compatibility",
			"",
			"old guidance",
			"",
			"## Usage",
			"",
			"call_omo_agent(...)",
		].join("\n");
		const once = adaptSkillForCodeBuddy(source);
		expect(adaptSkillForCodeBuddy(once)).toBe(once);
		expect(once).toContain("## Usage");
		expect(once).not.toContain("old guidance");
	});

	test("is idempotent on the built artifacts", () => {
		for (const name of ["init-deep", "refactor", "review-work", "ulw-execute", "ultrawork"]) {
			const path = join(pluginRoot, "skills", name, "SKILL.md");
			if (!existsSync(path)) continue;
			const content = readFileSync(path, "utf8");
			expect(adaptSkillForCodeBuddy(content)).toBe(content);
		}
	});
});

describe("agent sources", () => {
	test("every vendored agent has the frontmatter CodeBuddy requires", () => {
		const dir = join(import.meta.dirname, "..", "agents");
		const files = readdirSync(dir).filter((file) => file.endsWith(".md"));
		expect(files.length).toBeGreaterThanOrEqual(7);
		for (const file of files) {
			const content = readFileSync(join(dir, file), "utf8");
			const parsed = validateAgentFile(file, content);
			expect(typeof parsed.fields.name).toBe("string");
			expect(typeof parsed.fields.description).toBe("string");
		}
	});

	test("rejects an agent without frontmatter", () => {
		expect(parseFrontmatter("# no frontmatter\n")).toBeNull();
		expect(() => validateAgentFile("x.md", "# nope\n")).toThrow();
	});

	test("applies the configured model and effort to the frontmatter", () => {
		const source = `---\nname: oracle\ndescription: d\ntools: Read\n---\n\n${"x".repeat(300)}`;
		const bound = applyModelBinding("oracle.md", source, {
			agents: { oracle: "gpt-6-astra" },
			effort: { oracle: "high" },
		});
		const parsed = parseFrontmatter(bound);
		expect(parsed?.fields.model).toBe("gpt-6-astra");
		expect(parsed?.fields.effort).toBe("high");
		expect(parsed?.fields.tools).toBe("Read");
	});

	test("replaces an existing model line instead of duplicating it", () => {
		const source = `---\nname: oracle\ndescription: d\nmodel: old-model\n---\n\n${"x".repeat(300)}`;
		const bound = applyModelBinding("oracle.md", source, { agents: { oracle: "new-model" }, effort: {} });
		expect(bound.match(/^model:/gm)?.length).toBe(1);
		expect(parseFrontmatter(bound)?.fields.model).toBe("new-model");
	});

	test("drops the model line when the binding is cleared", () => {
		const source = `---\nname: oracle\ndescription: d\nmodel: old-model\neffort: high\n---\n\n${"x".repeat(300)}`;
		const cleared = applyModelBinding("oracle.md", source, { agents: {}, effort: {} });
		const fields = parseFrontmatter(cleared)?.fields ?? {};
		expect(fields.model).toBeUndefined();
		expect(fields.effort).toBeUndefined();
		expect(fields.description).toBe("d");
	});

	test("rejects a binding that names an unknown agent", () => {
		expect(() => normalizeBinding({ agents: { nope: "m" } }, ["oracle"])).toThrow(/unknown agents/);
		expect(() => normalizeBinding({ agents: { oracle: "m" } }, ["oracle"])).not.toThrow();
	});

	test("leaves agents untouched when nothing is configured", () => {
		const source = `---\nname: explore\ndescription: d\n---\n\n${"x".repeat(300)}`;
		expect(applyModelBinding("explore.md", source, { agents: {}, effort: {} })).toBe(source);
	});

	test("rejects an agent with a stub body", () => {
		expect(() => validateAgentFile("x.md", "---\nname: x\ndescription: y\n---\n\nshort\n")).toThrow(/too short/);
	});
});

describe("mcp config", () => {
	test("always declares the remote servers", () => {
		const config = buildMcpConfig();
		expect(Object.keys(config.mcpServers)).toEqual(["context7", "grep_app"]);
	});

	test("declares local servers only when staged", () => {
		const servers = buildMcpConfig({ hasLsp: true, hasAstGrep: true }).mcpServers as Record<
			string,
			{ command?: string; args?: string[] }
		>;
		expect(servers.lsp?.command).toBe("node");
		expect(servers.lsp?.args?.[0]).toContain("${CODEBUDDY_PLUGIN_ROOT}");
		expect(servers.ast_grep).toBeDefined();
	});
});

describe("installer paths", () => {
	test("derives the marketplace and plugin paths from the root", () => {
		expect(marketplaceDir("/tmp/cb")).toBe("/tmp/cb/plugins/omo-local");
		expect(installedPluginDir("/tmp/cb")).toBe("/tmp/cb/plugins/omo-local/plugins/omo");
	});

	test("resolves the settings file per scope", () => {
		expect(settingsPathFor("user", "/tmp/cb", "/proj")).toBe("/tmp/cb/settings.json");
		expect(settingsPathFor("project", "/tmp/cb", "/proj")).toBe("/proj/.codebuddy/settings.json");
		expect(settingsPathFor("local", "/tmp/cb", "/proj")).toBe("/proj/.codebuddy/settings.local.json");
	});

	test("parses arguments and rejects unknown scopes", () => {
		const parsed = parseArgs(["install", "--root", "/tmp/x", "--scope", "project", "--link"]);
		expect(parsed.root).toBe("/tmp/x");
		expect(parsed.scope).toBe("project");
		expect(parsed.copy).toBe(false);
		expect(parseArgs(["install"]).copy).toBe(true);
		expect(() => parseArgs(["install", "--scope", "galaxy"])).toThrow();
		expect(() => parseArgs(["install", "--nope"])).toThrow();
	});
});

describe("plugin validation", () => {
	test("accepts the built plugin", () => {
		if (!existsSync(join(pluginRoot, "hooks", "scripts", "hook.mjs"))) {
			// The build is a prerequisite; skip rather than fail on a clean checkout.
			return;
		}
		const result = validatePlugin(pluginRoot);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.summary.skills).toBeGreaterThan(10);
		expect(result.summary.agents).toBe(7);
		expect(result.summary.commands).toBeGreaterThanOrEqual(9);
	});

	test("reports what is missing for an empty plugin", () => {
		const empty = mkdtempSync(join(tmpdir(), "omo-codebuddy-empty-"));
		try {
			const result = validatePlugin(empty);
			expect(result.ok).toBe(false);
			expect(result.problems.join("\n")).toContain("plugin.json");
			expect(result.problems.join("\n")).toContain("hooks/hooks.json");
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});
});
