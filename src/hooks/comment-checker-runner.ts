import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Comment-checker invocation, vendored from oh-my-openagent's
 * `@oh-my-opencode/comment-checker-core` (MIT) so this repository has no
 * private-package dependency.
 *
 * The binary contract is unchanged: the checker is spawned as
 * `<binary> check`, the hook payload is written to its stdin, exit code 2 means
 * "findings" (the message is on stderr), exit 0 means clean, and a timeout is
 * treated as "no opinion". Nothing here is CodeBuddy-specific.
 */
export interface CommentCheckerHookInput {
	readonly session_id: string;
	readonly tool_name: string;
	readonly transcript_path: string;
	readonly cwd: string;
	readonly hook_event_name: string;
	readonly tool_input: {
		readonly file_path?: string;
		readonly content?: string;
		readonly old_string?: string;
		readonly new_string?: string;
		readonly edits?: readonly { old_string: string; new_string: string }[];
	};
	readonly tool_response?: unknown;
}

export interface CommentCheckResult {
	readonly hasComments: boolean;
	readonly message: string;
}

export type SpawnSignal = "SIGTERM" | "SIGKILL";

export interface SpawnProcess {
	readonly stdin: {
		write(input: string): void;
		end(): void;
	};
	readonly stdout: ReadableStream<Uint8Array>;
	readonly stderr: ReadableStream<Uint8Array>;
	readonly exited: Promise<number>;
	kill(signal: SpawnSignal): void;
}

export type SpawnFn = (args: readonly string[]) => SpawnProcess;

export interface RunCommentCheckerInput {
	readonly hookInput: CommentCheckerHookInput;
	readonly binaryPath: string | null;
}

export interface RunCommentCheckerOptions {
	readonly spawn: SpawnFn;
	readonly existsSync: (path: string) => boolean;
	readonly timeoutMs?: number;
	readonly killGraceMs?: number;
}

const EMPTY_RESULT: CommentCheckResult = { hasComments: false, message: "" };

export interface ResolveCommentCheckerBinaryInput {
	readonly binaryName: string;
	readonly cachedBinaryPath: string | null;
	readonly existsSync: (path: string) => boolean;
	readonly importMetaUrl?: string;
	readonly packageName?: string;
}

export function resolveCommentCheckerBinary(input: ResolveCommentCheckerBinaryInput): string | null {
	const packageName = input.packageName ?? "@code-yeongyu/comment-checker";

	if (input.cachedBinaryPath !== null && input.existsSync(input.cachedBinaryPath)) return input.cachedBinaryPath;
	if (input.importMetaUrl === undefined) return null;

	try {
		const require = createRequire(input.importMetaUrl);
		const packageJsonPath = require.resolve(`${packageName}/package.json`);
		const binaryPath = join(dirname(packageJsonPath), "bin", input.binaryName);
		return input.existsSync(binaryPath) ? binaryPath : null;
	} catch {
		return null;
	}
}

export async function runCommentChecker(
	input: RunCommentCheckerInput,
	options: RunCommentCheckerOptions,
): Promise<CommentCheckResult> {
	if (input.binaryPath === null || !options.existsSync(input.binaryPath)) return EMPTY_RESULT;

	const process = options.spawn([input.binaryPath, "check"]);
	const timeoutMs = options.timeoutMs ?? 30_000;
	const killGraceMs = options.killGraceMs ?? 1_000;

	let timedOut = false;
	const kill = (signal: SpawnSignal): void => {
		try {
			process.kill(signal);
		} catch {
			// The child may already be gone; a failed kill is not a hook failure.
		}
	};

	const timeoutId = setTimeout(() => {
		timedOut = true;
		kill("SIGTERM");
		setTimeout(() => kill("SIGKILL"), killGraceMs);
	}, timeoutMs);

	try {
		process.stdin.write(JSON.stringify(input.hookInput));
		process.stdin.end();

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
			process.exited,
		]);
		void stdout;

		if (timedOut) return EMPTY_RESULT;
		if (exitCode === 2) return { hasComments: true, message: stderr.replace(/\r\n/g, "\n") };
		return EMPTY_RESULT;
	} catch {
		return EMPTY_RESULT;
	} finally {
		clearTimeout(timeoutId);
	}
}
