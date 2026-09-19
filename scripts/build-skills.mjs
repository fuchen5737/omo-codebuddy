#!/usr/bin/env node
/**
 * Builds `plugin/skills/` from this repository's own `skills/` tree.
 *
 * The skills are vendored from oh-my-openagent's shared pool (see NOTICE.md);
 * this script is the TRANSFORMER that adapts them to the CodeBuddy harness:
 * other harnesses' compatibility sections are stripped, harness session
 * prefixes are normalized to `codebuddy:`, and a marker-delimited CodeBuddy
 * compatibility section is inserted — the markers make strip→insert exact,
 * which is what keeps the transform idempotent for bodies that embed code.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(packageRoot, "skills");
const pluginSkillsRoot = join(packageRoot, "plugin", "skills");

export const CODEBUDDY_COMPAT_HEADING = "## CodeBuddy Harness Tool Compatibility";

/**
 * Explicit delimiters around OUR compatibility section.
 *
 * Without them the section boundary has to be guessed from markdown headings,
 * and a skill body that contains code (the `refactor` skill embeds a TS
 * template literal starting with `# Intelligent Refactor Command`) makes the
 * guess land INSIDE the code — the strip then eats the body.
 */
export const CODEBUDDY_COMPAT_MARKER_START = "<!-- omo:codebuddy-compat -->";
export const CODEBUDDY_COMPAT_MARKER_END = "<!-- /omo:codebuddy-compat -->";

export const codebuddyCompatibilitySection = `${CODEBUDDY_COMPAT_MARKER_START}
${CODEBUDDY_COMPAT_HEADING}

Some examples in this skill were written for the OpenCode harness. In CodeBuddy, translate them instead of copying them literally:

| OpenCode example | CodeBuddy equivalent |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | the \`task\` tool with the matching agent (\`subagent_name: "explore"\`), or \`background_task\` for parallel fan-out |
| \`task(category="deep", ...)\` | the \`task\` tool with the closest agent: \`oracle\` for deep reasoning and review, \`explore\` for codebase search, \`librarian\` for external research |
| \`background_output(task_id=...)\` | collect the subagent's returned result; there is no separate output tool |
| \`team_*(...)\` | not available in CodeBuddy — use \`task\` / \`background_task\` subagents instead |
| \`load_skills: ["x"]\` | name the skill inside the subagent prompt, or read \`\${CODEBUDDY_PLUGIN_ROOT}/skills/x/SKILL.md\` |
| a bare \`skill(name="x")\` call | \`/omo:x\`, or read the skill file directly |

CodeBuddy Code runs hooks through Git Bash on Windows; inside a session, prefer the native tools over shell pipelines when a native tool exists.

If a code block below conflicts with this section, this section wins.
${CODEBUDDY_COMPAT_MARKER_END}
`;

const FOREIGN_COMPAT_HEADINGS = [
	"## Codex Harness Tool Compatibility",
	"## Senpi Harness Tool Compatibility",
];

const opencodeOnlyPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|load_skills)\b/;

const ignoredDirNames = new Set([".mypy_cache", ".omo", ".pytest_cache", ".ruff_cache", "__pycache__"]);
const ignoredFileNames = new Set([".gitignore", ".npmignore", "pyrightconfig.json", "openai.yaml"]);
const ignoredFilePattern = /\.test\.ts$/;

/** fs.cp filter for the skill source tree, relative to this repository. */
export function createSkillCopyFilter(root) {
	const compiled = compileIgnoredMatchers(root);
	return (sourcePath) => compiled(sourcePath);
}

function compileIgnoredMatchers(root) {
	const rootSegments = root.replaceAll("\\", "/").split("/").filter(Boolean);
	return (sourcePath) => {
		const segments = sourcePath.replaceAll("\\", "/").split("/").filter(Boolean);
		const relative = segments.slice(rootSegments.length);
		if (relative.length === 0) return true;
		if (relative.some((segment) => ignoredDirNames.has(segment))) return false;
		const name = relative.at(-1) ?? "";
		if (ignoredFileNames.has(name) || ignoredFilePattern.test(name) || name.endsWith(".pyc")) return false;
		const scriptsIndex = relative.lastIndexOf("scripts");
		return scriptsIndex === -1 || relative[scriptsIndex + 1] !== "tests";
	};
}

export function stripSection(content, heading) {
	let without = content;
	for (;;) {
		const start = without.indexOf(heading);
		if (start === -1) return without;
		const end = findSectionEnd(without, start + heading.length);
		const beforeRaw = without.slice(0, start).replace(/\n+$/, "");
		const after = without.slice(end).replace(/^\n+/, "");
		without = beforeRaw.length === 0 ? after : `${beforeRaw}\n\n${after}`;
	}
}

function findSectionEnd(content, from) {
	const pattern = /\n(?:---|#{1,6}\s)/g;
	pattern.lastIndex = from;
	const match = pattern.exec(content);
	return match ? match.index + 1 : content.length;
}

export function normalizeHarnessPrefixes(content) {
	return content
		.replace(/\bcodex:/g, "codebuddy:")
		.replace(/\bsenpi:/g, "codebuddy:")
		.replace(/`\/skill:([a-z0-9-]+)`/g, "`/omo:$1`");
}

export function insertCodeBuddyCompatibility(content) {
	if (!opencodeOnlyPattern.test(content)) return content;
	const anchor = frontmatterEnd(content);
	const head = content.slice(0, anchor).replace(/\n+$/, "");
	const tail = content.slice(anchor).replace(/^\n+/, "");
	const prefix = head.length === 0 ? "" : `${head}\n\n`;
	return `${prefix}${codebuddyCompatibilitySection}\n\n${tail}`;
}

function frontmatterEnd(content) {
	if (!content.startsWith("---\n")) return 0;
	const end = content.indexOf("\n---", 4);
	if (end === -1) return 0;
	const after = content.indexOf("\n", end + 1);
	return after === -1 ? content.length : after + 1;
}

/** Removes OUR section by its explicit markers, normalizing the same seam. */
export function stripMarkedCompatibilitySection(content) {
	const start = content.indexOf(CODEBUDDY_COMPAT_MARKER_START);
	if (start === -1) return content;
	const end = content.indexOf(CODEBUDDY_COMPAT_MARKER_END, start);
	if (end === -1) return content;
	const beforeRaw = content.slice(0, start).replace(/\n+$/, "");
	const after = content.slice(end + CODEBUDDY_COMPAT_MARKER_END.length).replace(/^\n+/, "");
	return beforeRaw.length === 0 ? after : `${beforeRaw}\n\n${after}`;
}

export function adaptSkillForCodeBuddy(content) {
	let adapted = stripMarkedCompatibilitySection(content);
	for (const heading of FOREIGN_COMPAT_HEADINGS) adapted = stripSection(adapted, heading);
	adapted = stripSection(adapted, CODEBUDDY_COMPAT_HEADING);
	adapted = normalizeHarnessPrefixes(adapted);
	adapted = insertCodeBuddyCompatibility(adapted);
	return adapted;
}

async function listSkillDirs(root) {
	const entries = await readdir(root, { withFileTypes: true });
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function compareArtifact(path, expected, name, problems) {
	let actual = null;
	try {
		actual = await readFile(path, "utf8");
	} catch {
		problems.push(`${name}: missing`);
		return;
	}
	if (actual !== expected) problems.push(`${name}: stale`);
}

export async function buildSkills({ check = false } = {}) {
	const skillNames = await listSkillDirs(sourceRoot);

	if (check) {
		const problems = [];
		for (const name of skillNames) {
			const expected = adaptSkillForCodeBuddy(await readFile(join(sourceRoot, name, "SKILL.md"), "utf8"));
			await compareArtifact(join(pluginSkillsRoot, name, "SKILL.md"), expected, name, problems);
		}
		if (problems.length > 0) throw new Error(`skill build is stale:\n${problems.join("\n")}`);
		return { skillNames, adapted: [] };
	}

	await rm(pluginSkillsRoot, { recursive: true, force: true });
	await mkdir(pluginSkillsRoot, { recursive: true });

	for (const name of skillNames) {
		const from = join(sourceRoot, name);
		const to = join(pluginSkillsRoot, name);
		await cp(from, to, { recursive: true, filter: createSkillCopyFilter(sourceRoot) });
	}

	const adapted = [];
	for (const name of skillNames) {
		const skillPath = join(pluginSkillsRoot, name, "SKILL.md");
		const content = await readFile(skillPath, "utf8");
		const next = adaptSkillForCodeBuddy(content);
		if (next !== content) {
			await writeFile(skillPath, next, "utf8");
			adapted.push(name);
		}
	}

	return { skillNames, adapted };
}

if (import.meta.main) {
	const check = process.argv.includes("--check");
	const result = await buildSkills({ check });
	console.log(
		check
			? `skill build check passed (${result.skillNames.length} skills)`
			: `built ${result.skillNames.length} skills (adapted: ${result.adapted.join(", ") || "none"})`,
	);
}
