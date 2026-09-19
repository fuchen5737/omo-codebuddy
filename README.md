# omo-codebuddy

[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (omo) as a
**CodeBuddy** plugin: ultrawork mode, the `ulw-*` workflows, workflow agents,
work-plan continuation, comment checking and the omo MCP servers.

Independently maintained. See [NOTICE.md](NOTICE.md) for what was vendored from
upstream and what is deliberately not included.

## Install

### One session (no install)

```bash
codebuddy --plugin-dir "$(pwd)/plugin"      # the built plugin directory
```

### Local marketplace (persistent)

```bash
bun scripts/build-plugin.mjs                                       # build once
bun scripts/install-local.mjs install --scope user                 # materialize + register
codebuddy plugin marketplace add ~/.codebuddy/plugins/omo-local
codebuddy plugin install omo@omo-local
```

`install-local.mjs` writes only under `--root` (default `~/.codebuddy`) and
copies the plugin into the marketplace: CodeBuddy rejects a marketplace entry
whose source escapes the marketplace root, so symlinking does not work.
`uninstall` reverses exactly what `install` wrote.

Inside a running session / the IDE, the same flow is `/plugin marketplace add
<path>` + `/plugin install omo@omo-local`.

## What it adds

| Surface | Contents |
|---|---|
| **Hooks** | `UserPromptSubmit` — ultrawork mode on `ultrawork`/`ulw` (quoted regions excluded, `ulw-plan`-style prefixes excluded) plus one conditional skill pointer per mentioned workflow. `Stop` — continuation of an unfinished Boulder work plan (`.omo/boulder.json`, owned by `codebuddy:<session>`) or ulw-loop run (`.omo/ulw-loop/<session>/goals.json`), budgeted and progress-gated. `PostToolUse` — comment checker after edit-like calls. `SessionStart` — project memory + workflow hints. |
| **Skills** | The omo skill pool (18, incl. the `ultrawork` directive and `ulw-plan`/`ulw-execute`/`ulw-loop`/`ulw-research`), adapted for CodeBuddy. |
| **Agents** | `oracle`, `explore`, `librarian`, `multimodal-looker`, `metis`, `momus`, `prometheus`. |
| **Commands** | `/omo:ulw-plan`, `/omo:ulw-execute`, `/omo:ulw-loop`, `/omo:ulw-research`, `/omo:review-work`, `/omo:init-deep`, `/omo:remember`, `/omo:remove-ai-slops`, `/omo:debugging`. |
| **MCP** | `context7` + `grep_app` (remote). `lsp` / `ast-grep` are declared only once their runtime is staged under `plugin/runtime/`. |

### Automatic behaviours

- **ultrawork** — a prompt containing `ultrawork`/`ulw` injects the binding
  bootstrap pointing at the bundled `ultrawork` skill; already-injected sessions
  and context-pressured sessions are skipped.
- **skill pointers** — mentioning `ulw-plan`, `ulw-loop`, `ulw-research` or a
  `mass ulw` spelling injects a *conditional* pointer: read that skill **if** the
  user is actually asking for it.
- **continuation** — when a turn ends with omo work still open, the stop is
  blocked with a resume directive. At most two resumes without progress, then it
  stops asking.
- **comment checker** — findings from the `@code-yeongyu/comment-checker` binary
  (when installed) are reported back to the model.
- **memory** — `.codebuddy/omo-memory.md` in your project is injected on session
  start and written through `/omo:remember`.

## Build

```bash
bun install
bun scripts/build-plugin.mjs           # bundle hooks, adapt skills, copy agents, generate commands + MCP
bun scripts/build-plugin.mjs --check   # verify the built artifact is current
bun test                               # 60 tests
bun run typecheck
```

Sources live in `skills/`, `agents/`, `resources/commands/` and `src/`; the
built plugin lives in `plugin/` (generated paths are gitignored). Do not edit
`plugin/skills`, `plugin/agents`, `plugin/commands`, `plugin/hooks/scripts` or
`plugin/.mcp.json` by hand — they are regenerated.

## QA

```bash
node .agents/skills/codebuddy-qa/scripts/drive.mjs --self-test
node .agents/skills/codebuddy-qa/scripts/drive.mjs hooks           # built bundle, real payloads
node .agents/skills/codebuddy-qa/scripts/drive.mjs probe           # CLI identity + plugin validate
node .agents/skills/codebuddy-qa/scripts/drive.mjs format-parity   # vs plugins CodeBuddy loads
node .agents/skills/codebuddy-qa/scripts/drive.mjs install         # throwaway-root install cycle
node .agents/skills/codebuddy-qa/scripts/drive.mjs isolation       # real-profile digests
```

The agent CLI is `@tencent-ai/codebuddy-code` (`npm i -g`); the
`~/.codebuddy/bin/buddycn` shim is the IDE launcher and has no `plugin`
subcommand. `plugin validate` / `marketplace add` / `install` / `list` need no
authentication; a live model turn does (`/login`).

## License

MIT. Vendored content keeps its upstream MIT terms — see [NOTICE.md](NOTICE.md)
and [LICENSE.md](LICENSE.md).
