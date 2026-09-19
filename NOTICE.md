# NOTICE — provenance and third-party content

`omo-codebuddy` is an independent CodeBuddy plugin adapter for
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (MIT).
It is maintained separately from that repository and does not track its
releases.

## What was vendored, and from where

| Content here | Origin upstream | Notes |
|---|---|---|
| `src/protocol/`, `src/hooks/` | originally authored for oh-my-openagent's CodeBuddy adapter | the hook logic and the CodeBuddy protocol types |
| `skills/*` | oh-my-openagent `packages/shared-skills/skills/` (MIT) + its `ultrawork` directive (`packages/prompts-core/prompts/ultrawork/default.md`) | copied verbatim, then adapted at build time for CodeBuddy |
| `agents/*.md` | extracted upstream from oh-my-openagent's agent sources (`packages/omo-opencode/src/agents/`, `packages/prompts-core/prompts/prometheus/`) | the runtime interpolations were dropped upstream and reported; the prompts are shipped as static text |
| `src/hooks/comment-checker-runner.ts` | vendored from oh-my-openagent's `@oh-my-opencode/comment-checker-core` (MIT) | same binary contract (`check` on stdin, exit 2 = findings on stderr) |
| `resources/commands/*.md` | authored for this plugin | thin wrappers that load a bundled skill |

## Third-party content that is deliberately NOT included

Upstream, the `frontend` skill materializes design/brand references from
third-party projects as part of its build (a DMCA-safe submodule +
build-materialize arrangement). Those directories
(`skills/frontend/references/design`, `.../designpowers`, `.../ui-ux-db`) are
**not vendored here**; `skills/frontend/` ships only the project-original
material and keeps `ATTRIBUTION.md` so the upstream sources stay documented.
If you need those references, obtain them from the upstream repository's build.

The `ultimate-browsing` skill includes its pinned, locally diverged Python
engine snapshot, which upstream ships in-tree; the same snapshot is vendored
here unchanged.

## Optional external dependency

The comment checker runs the `@code-yeongyu/comment-checker` binary when it is
available (`OMO_COMMENT_CHECKER_BINARY`, `<CODEBUDDY_PLUGIN_DATA>/bin/comment-checker`,
or the npm package). It is NOT bundled: when the binary is missing the hook
stays silent.
