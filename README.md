# Claudio

Agentic user review for web apps. Claudio takes over the manual acceptance review of a feature branch: it reads the pull request and its linked GitHub issues, derives the acceptance criteria, logs into a running instance of the branch, verifies the criteria in the browser, checks the areas the diff affects for regressions, judges UX and UI, and writes a report with evidence.

Built on the Claude Agent SDK, Playwright MCP and the Claude in Chrome extension. See `docs/ARCHITECTURE.md` for the full plan.

## Status

- Phase 0: the `claudio review` CLI runs one PR review end to end with the Playwright driver and writes a Markdown/JSON report.
- Web UI (first version): GitHub login, add repositories from your GitHub account, configure roles, start reviews, watch them live, read the report with evidence, and confirm or dismiss findings. Reviews run in a separate worker process; state lives in MySQL.
- Phase 3, PR review: on the standard and thorough budgets the orchestrator delegates to separate subagents, one after the other (they share one browser): `ac-verifier` for the acceptance criteria, `regression-tester` for the affected areas against the app map, `ux-reviewer` for the screenshots. The quick budget keeps one agent. While a review or analysis runs, the web UI shows a live view of the agent's browser (Chromium screencast, no model tokens). After rating the findings, the TL;DR comment can be posted to the PR from the UI, and the report downloaded as Markdown, both honouring the chosen strictness and leaving out dismissed findings. PR comments link to the review in Claudio (`PUBLIC_BASE_URL`).
- Phase 4, test workflows: per repository, tests described in plain language (flow, expectation, roles). The first run records the flow: an agent performs it exclusively through the `test_step` tool, which Claudio executes itself with Playwright and records, so the stored steps are exactly what ran (role/name locators, `{{run}}` and `{{date:+N:FORMAT}}` templates for unique data). Later runs replay the steps without a model; deterministic tests cost nothing, semi-deterministic ones are judged afterwards, explorative ones run with an agent each time. When a replayed step can no longer be executed, an agent heals the flow from that step, the healed steps become a new version, and a finding records the UI change. An independent judge (structured output) compares the final state with the expectation. Tests run on their own, as a suite against an instance, or with every PR review (a failed regression test turns an approval into "changes requested", also in the PR comment). Runs can be compared step by step.
- Phase 5, GitHub automation: per repository a webhook (set up from the settings with one click; needs admin rights and a public `PUBLIC_BASE_URL`) starts reviews on a `/claudio review [quick|standard|thorough]` comment, the `claudio-review` label, or automatically on every opened/updated PR, and can update the knowledge base on pushes to the default branch. The PR instance URL comes from a per-repo template (`https://pr-{pr}.preview.example.de`, also `{branch_slug}`, `{branch}`, `{sha}`). Results go back as the commit status "Claudio" (usable as a required check) and as the TL;DR comment, posted after the regression tests so it includes them. Automated runs act with the GitHub token of the person who set up the webhook. Findings dismissed with a reason become lessons that every later review of the repo is told about.
- Human takeover: Claudio never solves CAPTCHAs or bot checks itself. When one appears (reCAPTCHA, hCaptcha, Cloudflare Turnstile, Google's bot check, "Ich bin kein Roboter" pages), the run pauses: replays wait automatically, agents call `request_human_help`. Every page shows "Claudio wartet auf dich"; on the run page the live view becomes clickable, a person solves the challenge (click, type, keys, scroll are replayed in the run's browser) and presses "Erledigt, weitermachen". If the challenge is still there, Claudio asks again; without an answer within `CLAUDIO_HUMAN_TIMEOUT_MIN` (default 15) the run gives up cleanly. For your own apps, prefer the CAPTCHA providers' test keys on staging and PR instances.
- Anthropic keys per repository: a repository admin stores the repository's own Anthropic API key (encrypted, checked against Anthropic on save, only the last characters are shown). Every model session of that repository runs on this key alone; other Anthropic credentials in the environment are removed, so a run can neither use a server-wide key nor the machine's Claude login. Without a key, reviews, analyses, recordings and judged test runs do not start (deterministic replays still run). A key can be copied from another repository where the person is admin, and changed or removed later. The offline demo repository is the only exception on the dev server.
- Permissions follow GitHub: a person sees a repository in Claudio (with its reviews, tests, knowledge, files and costs) only if they can read it on GitHub. Write access is needed to start reviews, analyses and tests, rate findings, post comments and take over the browser; admin access for settings, role credentials, automation and the webhook. Permissions are fetched per user and cached for 15 minutes (fresh after every login). Expiring OAuth tokens are renewed automatically; if GitHub rejects a token, every page asks the person to sign in again.
- Costs: the "Kosten" page sums model costs per repository, month and kind of run (Agent SDK list-price estimates). Cancelling a run first asks the agent to stop (every further tool call is denied), so the SDK still reports the real cost; only if it does not finish within a minute is the process killed.
- Phase 2, repository analysis: Claudio reads the code and walks the running app, then writes a knowledge base per repository (overview, modules, routes, app map with the expected behaviour of every screen, notes). Every review receives the latest knowledge base. Updates only re-check what changed since the analysed commit.

## Setup

```sh
pnpm install
cp .env.example .env            # ANTHROPIC_API_KEY, GITHUB_TOKEN, role credentials
cp claudio.config.example.json claudio.config.json
```

`claudio.config.json` describes the target repository: the roles the agent may log in as (credentials are referenced by environment variable name and never reach the model), optional login recipes, and notes about the application.

Chromium: Playwright's bundled Chromium is used by default. Install it from the package that depends on Playwright: `pnpm --filter @claudio/browser exec playwright install chromium`. Set `CLAUDIO_CHROMIUM_PATH` to use another binary.

## Web UI

```sh
pnpm db:up                      # MySQL 8 in Docker on port 3310 (docker-compose.yml)
pnpm db:migrate
pnpm dev                        # web UI on http://localhost:5173 and the review worker
```

The `.env` needs `DATABASE_URL`, `CLAUDIO_SECRET_KEY` (`openssl rand -base64 32`) and a GitHub OAuth App:

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Homepage URL `http://localhost:5173`, authorization callback URL `http://localhost:5173/auth/github/callback`.
3. Put the client ID and a generated client secret into `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

Claudio asks for the scopes `repo read:user read:org`. Your token is stored encrypted and is used to list your repositories and open pull requests, to clone the PR branch, and to post the optional PR comment. Restrict who may sign in with `CLAUDIO_ALLOWED_GITHUB_ORGS` or `CLAUDIO_ALLOWED_GITHUB_USERS`.

Per repository you configure notes for the agent, the default instance URL, extra allowed hosts and the roles (username, password, optional login recipe). Role credentials are encrypted with `CLAUDIO_SECRET_KEY` and are handed only to the `login_as` tool, never to the model. A review can start only after someone confirms that the instances hold test data only.

The worker (`pnpm worker`) picks up queued reviews, one at a time by default (`CLAUDIO_WORKER_CONCURRENCY`). Web and worker share the database and the `runs/` directory; the web UI serves screenshots and traces from there to signed-in users.

Repository analysis: open a repository, tab "Wissen", and start an analysis against a running instance of the main branch (e.g. staging). The `code-scanner` subagent maps the code; the orchestrator walks the app screen by screen and writes the documents with the `write_knowledge` tool. The tab shows when the analysed commit is behind the branch head; "Wissensbasis aktualisieren" then hands the agent the previous documents and the list of changed files. Reviews get the route index and app map inlined in the prompt when they are small (up to about 24,000 characters) and as files otherwise.

Webhook security: the endpoint `/webhooks/github` is public; every delivery must carry a valid `X-Hub-Signature-256` for the repository's own secret (generated on setup, stored encrypted), otherwise it is rejected with 401. For local development, expose the dev server with a tunnel (e.g. cloudflared) and set `PUBLIC_BASE_URL` to the tunnel address before setting up the webhook.

Offline demo: with `CLAUDIO_DEV_FIXTURES=1` the dev server offers a login without GitHub and a demo repository that reviews the fixture PR against `apps/demo-target` (start it with `pnpm demo-target`).

Production: `pnpm --filter @claudio/web build`, then `node apps/web/build` (set `ORIGIN` and `PORT`) next to `pnpm worker`.

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

## Deployment

Kubernetes, built and deployed by GitHub Actions on every push to `main`; pull requests run the same checks. See `docs/DEPLOYMENT.md` for the setup and operations.

## Development

```sh
pnpm typecheck
pnpm test                                   # unit tests
CLAUDIO_INTEGRATION=1 pnpm test             # also the Playwright driver integration test (needs Chromium)
```

Packages: `core` (schemas, budget tiers, report rendering), `github` (PR and issue context), `browser` (drivers, capture, login, Claudio tools), `agent` (Agent SDK runner, prompts, hooks), `db` (Drizzle schema, migrations, queries, credential encryption), `apps/cli`, `apps/web` (SvelteKit UI), `apps/worker` (review runner).

After changing `packages/db/src/schema.ts`, run `pnpm db:generate` and commit the new migration.
