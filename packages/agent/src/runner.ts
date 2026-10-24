import type { z } from "zod";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { query, type Options, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { RunStore, createClaudioTools, createDriver, startLiveView, type DriverSession, type HumanBridgeFactory } from "@claudio/browser";
import {
  ReviewRequestSchema,
  budgetProfile,
  capBudget,
  changeRef,
  changeTerms,
  criterionText,
  loadRepoConfig,
  newRunId,
  nowIso,
  renderMarkdown,
  renderPrComment,
  REVIEW_SUPERSEDED,
  verdict,
  KNOWLEDGE_DOCS,
  type FollowUpContext,
  type Impact,
  type KnowledgeBase,
  type Provider,
  type RepoConfig,
  type ReviewReport,
  type ReviewRequest,
  type RunStatus,
} from "@claudio/core";
import { forgeFor, type CloneSpec, type Forge, type PullRequestContext, type RepoRef } from "@claudio/forge";
import { createBrowserGuard, createCaptchaHook, createStopHook } from "./hooks.js";
import { envWithout, modelEnv } from "./env.js";
import { computeImpact } from "./impact.js";
import { SYSTEM_APPEND, buildReviewPrompt, extractAffectedAreas } from "./prompts.js";
import { createClaudioSdkServer } from "./sdk-tools.js";

const execFileAsync = promisify(execFile);

export type RunnerDeps = {
  /** Directory that holds one sub-directory per run. Default: ./runs */
  runsRoot?: string;
  /** Path to claudio.config.json. Default: ./claudio.config.json */
  configPath?: string;
  /** Repo config passed in directly (web worker); takes precedence over configPath. */
  config?: RepoConfig | null;
  /** Role credentials keyed by the env var names in the config. Only the Claudio tools see them, never the agent process. */
  roleEnv?: Record<string, string>;
  /** Claudio project root (where .claude/agents and skills live). Default: process.cwd() */
  projectRoot?: string;
  /** GitHub or GitLab, acting as Claudio's bot or the person the run is for. */
  forge?: Forge | null;
  /** GitLab's project id, so API calls survive a renamed project. */
  repoExternalId?: number | null;
  /** Without `forge`: a token for the request's provider (CLI). Default: GITHUB_TOKEN or GITLAB_TOKEN. */
  githubToken?: string;
  /** Use a PullRequestContext JSON file instead of fetching from GitHub or GitLab (offline runs, demo target). */
  prContextFile?: string;
  /** Use an existing checkout instead of cloning the PR branch. */
  repoDir?: string;
  abortController?: AbortController;
  /** The repository's Anthropic API key. When set, the run uses only this key. */
  anthropicApiKey?: string;
  /** Soft stop: the agent is told to finish, so the SDK still reports the cost. abortController is the hard fallback. */
  stopSignal?: AbortSignal;
  onProgress?: (line: string) => void;
  /** Latest knowledge base of the repository (from a repo analysis), handed to the agent as files. */
  knowledge?: KnowledgeBase | null;
  /** Lets a person take over the browser for CAPTCHAs and bot checks (web UI). */
  human?: HumanBridgeFactory;
  /** Stores what the agent learned about operating the app (remember_learning), for later runs. */
  onLearning?: (text: string) => void;
  /** Write the browser screencast to runDir/live.jpg for the web UI. Default: true. */
  liveView?: boolean;
  /** Link to this review in the web UI, used in the PR comment. */
  reportUrl?: string;
  /** Called once the run directory exists, before any network or model call. */
  onRunStarted?: (run: RunHandle) => void;
  /** Re-review: the earlier review of this pull request (findings, criteria, files changed since). */
  followUp?: FollowUpContext | null;
  /** What is left of the repository's monthly budget: the run's cost cap goes no higher. */
  remainingBudgetUsd?: number | null;
  /** Called once after the checkout with the computed impact (null without a checkout), before the agent starts. */
  onImpact?: (impact: Impact | null) => void | Promise<void>;
};

export type RunHandle = { runId: string; runDir: string };

export async function runReview(input: z.input<typeof ReviewRequestSchema>, deps: RunnerDeps = {}): Promise<ReviewReport> {
  const request = ReviewRequestSchema.parse(input);
  const log = deps.onProgress ?? (() => undefined);
  const runId = newRunId(`review-pr${request.pr}`);
  const runsRoot = resolve(deps.runsRoot ?? "runs");
  const runDir = join(runsRoot, runId);
  const store = new RunStore(runDir);
  const started = Date.now();
  const errors: string[] = [];
  log(`run ${runId} → ${runDir}`);
  deps.onRunStarted?.({ runId, runDir });

  const config = deps.config !== undefined ? deps.config : loadRepoConfig(deps.configPath);
  if (config && config.repo !== request.repo) log(`warning: claudio.config.json is for ${config.repo}, reviewing ${request.repo}`);
  const roleEnvVars = Object.values(config?.roles ?? {}).flatMap((r) => [r.usernameEnv, r.passwordEnv]);

  const forge = runForge(deps, request.provider);
  const ref: RepoRef = { fullName: request.repo, externalId: deps.repoExternalId };
  let pr: PullRequestContext;
  if (deps.prContextFile) {
    pr = JSON.parse(readFileSync(deps.prContextFile, "utf8")) as PullRequestContext;
    log(`using PR context from ${deps.prContextFile}`);
  } else {
    if (!forge) throw new Error(`${tokenEnv(request.provider)} is not set`);
    log(`fetching ${changeTerms(request.provider).short} ${changeRef(request.provider, request.pr)} of ${request.repo}`);
    pr = await forge.fetchChangeContext(ref, request.pr);
  }
  store.writeFile("pr-context.json", pr);
  log(`PR "${pr.title}" (${pr.headRef} → ${pr.baseRef}), ${pr.files.length} files, ${pr.issues.length} linked issues`);

  let repoDir: string | null = null;
  if (deps.repoDir) {
    repoDir = resolve(deps.repoDir);
  } else if (request.cloneRepo && forge) {
    repoDir = join(runDir, "repo");
    try {
      await cloneBranch(await forge.cloneSpec(ref), pr.headRef, repoDir);
      log(`checked out ${pr.headRef} at ${repoDir}`);
    } catch (e) {
      repoDir = null;
      const msg = `clone failed: ${forge.redact((e as Error).message)}`;
      errors.push(msg);
      log(msg);
    }
  }

  let impact: Impact | null = null;
  if (repoDir) {
    try {
      impact = computeImpact(repoDir, pr.files);
      store.writeFile("impact.json", impact);
      log(
        `impact (${impact.framework}, ${impact.stats.files} files, ${impact.stats.ms} ms): ${impact.routes.length} route(s)` +
          (impact.global.length ? `, ${impact.global.length} change(s) affecting the whole app` : "") +
          (impact.unmapped.length ? `, ${impact.unmapped.length} file(s) without a route` : ""),
      );
    } catch (e) {
      const msg = `impact analysis failed: ${(e as Error).message}`;
      errors.push(msg);
      log(msg);
    }
  }
  try {
    await deps.onImpact?.(impact);
  } catch (e) {
    const msg = `after the impact analysis: ${(e as Error).message}`;
    errors.push(msg);
    log(msg);
  }

  const profile = capBudget(budgetProfile(request.budget, request.modelOverride), deps.remainingBudgetUsd);
  const driver = createDriver(request.driver);
  const session: DriverSession = await driver.start({
    runDir,
    instanceUrl: request.instanceUrl,
    headed: request.headed,
    // Both: desktop first, the agent switches to the phone with set_viewport.
    device: request.viewports.includes("desktop") ? "desktop" : "mobile",
    language: request.language,
  });
  log(`browser driver: ${session.name}${session.attachment ? ` (cdp ${session.attachment.cdpEndpoint})` : ""}`);
  const human = session.attachment && deps.human ? deps.human(session.attachment) : undefined;
  // Screencast for the live view in the web UI (runDir/live.jpg).
  const liveView = session.attachment && deps.liveView !== false ? startLiveView(session.attachment, join(runDir, "live.jpg")) : null;

  const tools = createClaudioTools({
    runDir,
    store,
    attachment: session.attachment,
    instanceUrl: request.instanceUrl,
    roles: config?.roles ?? {},
    driver: session.name,
    env: deps.roleEnv ? { ...process.env, ...deps.roleEnv } : undefined,
    human,
    onLearning: deps.onLearning,
    viewports: request.viewports,
    followUp: deps.followUp ? { reviewId: deps.followUp.reviewId, findings: deps.followUp.findings.map(({ rating: _r, comment: _c, ...f }) => f) } : undefined,
  });
  const claudioServer = createClaudioSdkServer(tools);
  if (deps.followUp) log(`re-review of #${deps.followUp.reviewId}: ${deps.followUp.findings.length} open finding(s), ${deps.followUp.changedFiles?.length ?? "unknown number of"} changed file(s)`);

  const instanceHost = new URL(request.instanceUrl).hostname;
  const guard = createBrowserGuard({
    allowedHosts: [instanceHost, ...(config?.extraAllowedHosts ?? [])],
    maxBrowserSteps: profile.maxBrowserSteps,
    onStep: (n) => {
      if (n % 25 === 0) log(`browser steps: ${n}/${profile.maxBrowserSteps}`);
    },
  });

  const knowledgeDir = deps.knowledge?.docs.length ? writeKnowledgeFiles(join(runDir, "knowledge"), deps.knowledge) : null;
  if (knowledgeDir && deps.knowledge) log(`knowledge base from ${deps.knowledge.commitSha.slice(0, 7)} (${deps.knowledge.docs.length} documents)`);

  const prompt = buildReviewPrompt({
    runId,
    request,
    pr,
    config,
    repoDir,
    profile,
    driverPrefix: session.promptPrefix,
    knowledge: knowledgeDir && deps.knowledge ? { dir: knowledgeDir, base: deps.knowledge } : null,
    followUp: deps.followUp ?? null,
    impact,
  });
  store.writeFile("prompt.md", prompt);

  const abortController = deps.abortController ?? new AbortController();
  const options: Options = {
    cwd: resolve(deps.projectRoot ?? process.cwd()),
    settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
    model: profile.orchestratorModel,
    effort: profile.effort,
    thinking: { type: "adaptive" },
    maxTurns: profile.maxTurns,
    maxBudgetUsd: profile.maxBudgetUsd,
    mcpServers: { ...session.mcpServers, claudio: claudioServer },
    // Only the servers above: the repo's .mcp.json (live-mode server, same name) must not be loaded here.
    strictMcpConfig: true,
    allowedTools: [...session.allowedTools, "Read", "Grep", "Glob", "Agent", "TodoWrite"],
    disallowedTools: [...session.disallowedTools, "Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "KillShell", "BashOutput"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    hooks: {
      PreToolUse: [...createStopHook(deps.stopSignal), ...guard.hooks],
      PostToolUse: session.attachment ? [createCaptchaHook(() => session.attachment?.activePage(), Boolean(human))] : [],
    },
    additionalDirectories: [repoDir, knowledgeDir].filter((d): d is string => Boolean(d)),
    extraArgs: session.extraArgs,
    abortController,
    env: modelEnv(envWithout(process.env, roleEnvVars), deps.anthropicApiKey),
    stderr: (data) => appendFileSync(join(runDir, "claude-stderr.log"), data),
  };

  const logFile = join(runDir, "log.jsonl");
  let result: SDKResultMessage | undefined;
  let sessionId: string | undefined;
  let status: RunStatus = "failed";
  try {
    for await (const message of query({ prompt, options })) {
      appendFileSync(logFile, JSON.stringify(message) + "\n");
      sessionId ??= (message as { session_id?: string }).session_id;
      describe(message, log);
      if (message.type === "result") result = message;
    }
    status = deps.stopSignal?.aborted ? "aborted" : mapStatus(result);
    if (result && result.subtype !== "success") errors.push(...result.errors);
  } catch (e) {
    status = abortController.signal.aborted ? "aborted" : "failed";
    errors.push(`agent error: ${(e as Error).message}`);
    log(`agent error: ${(e as Error).message}`);
  } finally {
    await liveView?.stop().catch(() => undefined);
    await session.close().catch((e) => errors.push(`driver close: ${(e as Error).message}`));
  }

  const summary = result && result.subtype === "success" ? result.result : "";
  const followUp = deps.followUp ? completeFollowUp(store, deps.followUp, request.criteria) : undefined;
  const report: ReviewReport = {
    runId,
    status,
    request,
    pr: { number: pr.number, title: pr.title, url: pr.url, headRef: pr.headRef, baseRef: pr.baseRef, author: pr.author, headSha: pr.headSha },
    issues: pr.issues.map((i) => ({ number: i.number, title: i.title, url: i.url })),
    summary,
    affectedAreas: extractAffectedAreas(summary),
    acceptanceCriteria: store.acResults(),
    findings: store.findings(),
    evidence: store.evidence(),
    notes: store.notes(),
    cost: {
      usd: result?.total_cost_usd ?? 0,
      inputTokens: (result?.usage.input_tokens ?? 0) + (result?.usage.cache_read_input_tokens ?? 0) + (result?.usage.cache_creation_input_tokens ?? 0),
      outputTokens: result?.usage.output_tokens ?? 0,
      turns: result?.num_turns ?? 0,
      durationMs: Date.now() - started,
      browserSteps: guard.steps(),
    },
    sessionId,
    errors,
    followUp,
    impact: impact ?? undefined,
    createdAt: nowIso(),
  };

  writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(runDir, "report.md"), renderMarkdown(report, request.verbosity));
  writeFileSync(join(runDir, "report-detailed.md"), renderMarkdown(report, "detailed"));
  log(`report: ${join(runDir, "report.md")} (status ${status}, ${report.cost.usd.toFixed(2)} USD, ${report.findings.length} findings)`);

  if (request.postComment) {
    try {
      // Blocking findings request changes on the PR instead of failing a check.
      const requestChanges = verdict(report) === "request_changes";
      if (!forge) throw new Error(`${tokenEnv(request.provider)} is not set`);
      const posted = await forge.postReview(ref, request.pr, renderPrComment(report, deps.reportUrl), requestChanges, REVIEW_SUPERSEDED[request.language]);
      report.commentUrl = posted.url;
      writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
      log(`PR review posted (${posted.requestedChanges ? "changes requested" : "comment"}): ${posted.url}`);
    } catch (e) {
      const msg = `PR comment failed: ${(e as Error).message}`;
      report.errors.push(msg);
      log(msg);
      writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
    }
  }
  return report;
}

/**
 * After a re-review: whatever the agent did not get to stays as it was. Open findings
 * it did not re-check are carried over (still counting for the verdict), and criteria
 * it did not re-test keep their earlier result.
 */
export function completeFollowUp(store: RunStore, f: FollowUpContext, confirmed?: string[]): NonNullable<ReviewReport["followUp"]> {
  const checked = new Set(store.rechecks().map((r) => r.findingId));
  for (const prev of f.findings) {
    if (checked.has(prev.id)) continue;
    const { id: _id, createdAt: _at, previous: _p, rating: _r, comment: _c, ...rest } = prev;
    store.addFinding({ ...rest, evidenceIds: [], previous: { reviewId: f.reviewId, findingId: prev.id, status: "not_rechecked" } });
    store.recordRecheck({ findingId: prev.id, title: prev.title, severity: prev.severity, status: "not_rechecked", notes: "", evidenceIds: [] });
  }
  const tested = new Set(store.acResults().map((a) => criterionText(a.criterion)));
  // Criteria a person confirmed for this run are the criteria: earlier ones they dropped stay dropped.
  const wanted = confirmed?.length ? new Set(confirmed.map(criterionText)) : null;
  for (const c of f.criteria) {
    if (tested.has(criterionText(c.criterion)) || (wanted && !wanted.has(criterionText(c.criterion)))) continue;
    store.recordAcResult({ criterion: c.criterion, status: c.status, notes: c.notes, evidenceIds: [], carriedFrom: f.reviewId });
  }
  return { reviewId: f.reviewId, headSha: f.headSha, changedFiles: f.changedFiles, rechecks: store.rechecks() };
}

/** Writes the knowledge documents as Markdown files and returns the directory. */
export function writeKnowledgeFiles(dir: string, knowledge: KnowledgeBase): string {
  mkdirSync(dir, { recursive: true });
  for (const doc of knowledge.docs) writeFileSync(join(dir, KNOWLEDGE_DOCS[doc.name].file), doc.content);
  return dir;
}

export function mapStatus(result: SDKResultMessage | undefined): RunStatus {
  if (!result) return "failed";
  switch (result.subtype) {
    case "success":
      return "completed";
    case "error_max_budget_usd":
      return "budget_exceeded";
    case "error_max_turns":
      return "max_turns";
    default:
      return "failed";
  }
}

export function describe(message: SDKMessage, log: (line: string) => void): void {
  if (message.type === "system" && message.subtype === "init") {
    log(`session ${message.session_id} model=${message.model} key=${message.apiKeySource} mcp=${message.mcp_servers.map((s) => `${s.name}:${s.status}`).join(",")}`);
    return;
  }
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "tool_use") {
        log(`→ ${block.name} ${short(JSON.stringify(block.input), 100)}`);
      } else if (block.type === "text" && block.text.trim()) {
        log(`· ${short(block.text.trim().replace(/\s+/g, " "), 160)}`);
      }
    }
    return;
  }
  if (message.type === "result") {
    log(`result: ${message.subtype}, ${message.num_turns} turns, ${message.total_cost_usd.toFixed(2)} USD, ${Math.round(message.duration_ms / 1000)}s`);
  }
}

export function short(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

/** The run's GitHub or GitLab access: the one passed in, else a token from the environment (CLI). */
export function runForge(deps: Pick<RunnerDeps, "forge" | "githubToken">, provider: Provider | undefined): Forge | null {
  if (deps.forge !== undefined) return deps.forge;
  const p = provider ?? "github";
  const token = deps.githubToken ?? process.env[tokenEnv(p)];
  return token ? forgeFor(p, token) : null;
}

const tokenEnv = (provider: Provider | undefined) => (provider === "gitlab" ? "GITLAB_TOKEN" : "GITHUB_TOKEN");

/** Shallow clone of one branch. Returns the checked-out commit sha. */
export async function cloneBranch(spec: CloneSpec, branch: string, dir: string): Promise<string> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  await execFileAsync("git", ["clone", "--depth", "1", "--branch", branch, "--single-branch", spec.url, dir], { env, maxBuffer: 10 * 1024 * 1024 });
  // The token is part of the remote URL; drop it so it does not linger in .git/config.
  await execFileAsync("git", ["-C", dir, "remote", "set-url", "origin", spec.publicUrl], { env });
  const { stdout } = await execFileAsync("git", ["-C", dir, "rev-parse", "HEAD"], { env });
  return stdout.trim();
}

export function scrub(text: string, secret?: string): string {
  return secret ? text.split(secret).join("***") : text;
}

export { envWithout, modelEnv } from "./env.js";
