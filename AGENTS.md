# omo-codebuddy — agent notes

CodeBuddy plugin adapter for oh-my-openagent (omo). **Independently maintained**:
this repository does not track upstream releases, and `skills/` + `agents/` are
vendored sources here, not build inputs from somewhere else. Read
[NOTICE.md](NOTICE.md) before adding or refreshing vendored content.

## Layout

| Path | Purpose |
|---|---|
| `src/protocol/` | The CodeBuddy hook protocol (stdin payload shapes, stdout JSON, exit-code semantics). Single source of truth for every hook. |
| `src/hooks/` | Hook logic + the single CLI entrypoint (`cli.ts` → bundled `plugin/hooks/scripts/hook.mjs`). |
| `skills/` | **Source** skill tree (vendored, adapted at build time). |
| `agents/` | **Source** agent definitions (vendored; validated at build time). |
| `resources/commands/` | Hand-authored slash-command wrappers. |
| `scripts/` | `build-plugin` (entry), `build-hooks`, `build-skills`, `build-agents`, `generate-commands`, `generate-mcp`, `validate-plugin`, `install-local`. |
| `plugin/` | The CodeBuddy plugin. `.codebuddy-plugin/plugin.json`, `hooks/hooks.json` and `README.md` are hand-written; everything else is generated and gitignored. |
| `test/` | Protocol, hook and build tests (`bun test`). |
| `.agents/skills/codebuddy-qa/` | The live QA skill + `drive.mjs` driver. |

## Hard rules

1. **Never hand-edit generated plugin paths** (`plugin/skills`, `plugin/agents`,
   `plugin/commands`, `plugin/hooks/scripts`, `plugin/.mcp.json`). Edit the
   source and rebuild.
2. **`bun scripts/build-plugin.mjs --check` must pass** before any commit — it
   compares every generated artifact against what the current source produces.
3. **Never install into the real `~/.codebuddy` during QA.** Every install run
   uses a throwaway `--root` / `--home`, and the real
   `settings.json` + `plugins/known_marketplaces.json` sha256 must be unchanged.
4. **A live model turn requires `/login`.** `plugin validate` / `marketplace add`
   / `install` / `list` work without auth; a turn does not. Report a turn as
   PENDING, never as a pass.

## CodeBuddy contract (verified — do not re-derive)

| Fact | Value |
|---|---|
| Plugin manifest | `.codebuddy-plugin/plugin.json`; only `name` is mandatory. Component directories MUST be at the plugin root (only the manifest lives inside `.codebuddy-plugin/`). |
| Hook config | `hooks/hooks.json`, same shape as `settings.json` `hooks`; plugin hooks MERGE with user/project hooks and are exempt from the `allowUntrustedFrontmatterHooks` gate. |
| Hook stdin | `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name` + event fields (`prompt`; `tool_name`/`tool_input`/`tool_response`; `stop_hook_active`; `source`). |
| Hook stdout | `{"continue": bool, "reason"/"stopReason": str, "suppressOutput": bool, "systemMessage": str, "hookSpecificOutput": {"hookEventName", "additionalContext", "permissionDecision", "permissionDecisionReason", "modifiedInput", "updatedToolOutput"}}` |
| Stop blocking | `{"continue": false, "reason": …}` — `decision: "block"` is DEPRECATED upstream. |
| Exit codes | 0 ok (stdout enters context for `SessionStart`/`UserPromptSubmit`); 2 block (stdout wins over stderr); anything else is a non-blocking warning. |
| Env | `${CODEBUDDY_PLUGIN_ROOT}`, `${CODEBUDDY_PLUGIN_DATA}`, `${CODEBUDDY_PROJECT_DIR}` (substituted in text AND exported to hook subprocesses); `${CLAUDE_*}` aliases work. |
| Tool names | CLI style (`Read`/`Write`/`Edit`/`Bash`) and IDE style (`read_file`/`write_to_file`/`replace_in_file`/`execute_command`) are both possible in `tool_name` — hooks must accept both. |
| Marketplace | `codebuddy plugin marketplace add <dir>` + `codebuddy plugin install <p>@<m>`; the plugin source must live INSIDE the marketplace root (a symlink is rejected). |

## Skill adaptation (why the markers exist)

`scripts/build-skills.mjs` inserts the CodeBuddy compatibility section between
`<!-- omo:codebuddy-compat -->` and `<!-- /omo:codebuddy-compat -->`. The markers
are load-bearing: inferring the section end from markdown headings lands inside
the code of skills that embed it (the `refactor` skill carries a TS template
literal starting with `# Intelligent Refactor Command`), which silently ate the
skill body on a re-run. Any change to the section MUST keep strip→insert
idempotent — `test/generators.test.ts` asserts that against the built artifacts.

## Model routing (role-bound, never runtime)

CodeBuddy has exactly ONE channel for choosing a subagent's model: the `model`
field in the agent definition. The `task` tool takes no model argument, and a
hook (`PreToolUse` `modifiedInput` included) can only rewrite tool input, inject
context, or block — none of that reaches model selection. Do not "fix" this by
inventing a model hook; there is no wire for it.

The adapter therefore binds models to ROLES via `agent-models.json`, applied at
build time by `applyModelBinding()` in `scripts/build-agents.mjs`:

```json
{ "agents": { "oracle": "<model-id>", "explore": "<model-id>" },
  "effort": { "oracle": "high", "explore": "low" } }
```

- Values are CodeBuddy model ids (the IDE picker's name, or the `id` of a custom
  model in `~/.codebuddy/models.json`). Empty/missing = session default.
- The build prints the applied binding; `--check` covers it too.
- `test/generators.test.ts` covers inject / replace / clear / unknown-agent.
- The main agent "routes" by choosing WHICH subagent to call, so the bindings
  are only as useful as the agent descriptions (they drive that choice).

## QA

```bash
bun test && bun scripts/build-plugin.mjs --check && bun run typecheck

D=.agents/skills/codebuddy-qa/scripts/drive.mjs
node "$D" --self-test
node "$D" hooks            # built bundle, real CodeBuddy payloads
node "$D" probe            # CLI identity + plugin validate
node "$D" format-parity    # manifest/hook shape vs installed marketplaces
node "$D" install          # install → installed copy runs → uninstall, in a throwaway root
node "$D" isolation        # real-profile digests
```

Evidence for a change goes to `evidence/<YYYYMMDD>-<slug>/` with: what was
tested, what was observed, why it is enough, and what was omitted (never copy
credentials). Live CodeBuddy QA cannot be claimed from unit tests alone, and a
live model turn cannot be claimed at all until the CLI is signed in.
