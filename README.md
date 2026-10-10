# Claudio

Agentic user review for web apps. Claudio takes over the manual acceptance review of a feature branch: it reads the pull request and its linked GitHub issues, derives the acceptance criteria, logs into a running instance of the branch, verifies the criteria in the browser, checks the areas the diff affects for regressions, judges UX and UI, and writes a report with evidence.

Built on the Claude Agent SDK, Playwright MCP and the Claude in Chrome extension. See `docs/ARCHITECTURE.md` for the full plan.

## Status

Phase 0 (spike): the `claudio review` CLI runs one PR review end to end with the Playwright driver and writes a Markdown/JSON report. No web UI yet.

## Setup

```sh
pnpm install
cp .env.example .env            # ANTHROPIC_API_KEY, GITHUB_TOKEN, role credentials
cp claudio.config.example.json claudio.config.json
```

`claudio.config.json` describes the target repository: the roles the agent may log in as (credentials are referenced by environment variable name and never reach the model), optional login recipes, and notes about the application.

Chromium: Playwright's bundled Chromium is used by default (`pnpm exec playwright install chromium`). Set `CLAUDIO_CHROMIUM_PATH` to use another binary.

## Running a review

```sh
pnpm claudio review \
  --repo vanderlars/some-app \
  --pr 123 \
  --url https://pr-123.preview.example.de \
  --role dispatcher \
  --budget standard \
  --verbosity normal \
  --strictness normal \
  --comment            # optional: post a TL;DR comment to the PR
```

Options:

| Flag | Values | Default |
|---|---|---|
| `--driver` | `playwright` (unattended, headless), `chrome` (live mode, experimental) | `playwright` |
| `--budget` | `quick`, `standard`, `thorough` | `standard` |
| `--verbosity` | `tldr`, `normal`, `detailed` | `normal` |
| `--strictness` | `lenient`, `normal`, `strict` | `normal` |
| `--lang` | `de`, `en` | `de` |
| `--headed` | show the browser window | off |
| `--no-clone` | skip checking out the PR branch for code analysis | clone |

Every run writes to `runs/<runId>/`: `report.md` (at the chosen verbosity), `report-detailed.md`, `report.json`, `findings.json`, `acceptance.json`, `evidence/`, `console.json`, `network.json`, `trace.zip` (Playwright trace), `log.jsonl` (agent transcript) and `prompt.md`.

## Live mode with Claude in Chrome

The live driver lets a person watch and step in. It runs through the Claude Code harness with the Chrome extension and needs a Claude subscription login on the machine. From this repository:

```sh
export CLAUDIO_RUN_DIR=$PWD/runs/live-1 CLAUDIO_INSTANCE_URL=https://pr-123.preview.example.de CLAUDIO_CONFIG=$PWD/claudio.config.json CLAUDIO_DRIVER=chrome
claude --chrome
```

The `.mcp.json` in this repository registers the Claudio tool server, and `.claude/agents` and `.claude/skills` hold the same review procedure the unattended driver uses. Whether the Agent SDK can start this mode itself (`--driver chrome`) is still being verified.

## Trying it without a real deployment

`apps/demo-target` is a tiny dispatch app with deliberate bugs plus a fixture PR context. See its README; the review runs fully offline except for the model calls.

## Development

```sh
pnpm typecheck
pnpm test                                   # unit tests
CLAUDIO_INTEGRATION=1 pnpm test             # also the Playwright driver integration test (needs Chromium)
```

Packages: `core` (schemas, budget tiers, report rendering), `github` (PR and issue context), `browser` (drivers, capture, login, Claudio tools), `agent` (Agent SDK runner, prompts, hooks), `apps/cli`.
