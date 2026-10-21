import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { query, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { RunStore, createClaudioTools, createDriver, startLiveView, type DriverSession, type HumanBridgeFactory } from "@claudio/browser";
import {
  AnalysisRequestSchema,
  KNOWLEDGE_DOCS,
  KnowledgeDocNameSchema,
  analysisProfile,
  capBudget,
  loadRepoConfig,
  newRunId,
  nowIso,
  type AnalysisReport,
  type AnalysisRequest,
  type KnowledgeBase,
  type KnowledgeDoc,
  type RunStatus,
} from "@claudio/core";
import { changedFilesBetween, createGithubClient, getDefaultBranch, type ChangedSince } from "@claudio/github";
import { ANALYSIS_SYSTEM_APPEND, buildAnalysisPrompt } from "./analysis-prompt.js";
import { createBrowserGuard, createCaptchaHook, createStopHook } from "./hooks.js";
import { cloneBranch, describe, envWithout, mapStatus, modelEnv, scrub, writeKnowledgeFiles, type RunnerDeps } from "./runner.js";
import { createClaudioSdkServer } from "./sdk-tools.js";

export type AnalysisDeps = Omit<RunnerDeps, "prContextFile" | "knowledge"> & {
  /** Knowledge base of the previous analysis; the run updates it instead of starting from scratch. */
  previous?: KnowledgeBase | null;
  /** Commit sha to record when repoDir is given (no clone). */
  commitSha?: string;
};

export async function runAnalysis(input: AnalysisRequest, deps: AnalysisDeps = {}): Promise<AnalysisReport> {
  const request = AnalysisRequestSchema.parse(input);
  const log = deps.onProgress ?? (() => undefined);
  const runId = newRunId(`analysis-${request.repo.split("/")[1]}`);
  const runDir = join(resolve(deps.runsRoot ?? "runs"), runId);
  const store = new RunStore(runDir);
  const knowledgeDir = join(runDir, "knowledge");
  const started = Date.now();
  const errors: string[] = [];
  log(`run ${runId} → ${runDir}`);
  deps.onRunStarted?.({ runId, runDir });

  const config = deps.config !== undefined ? deps.config : loadRepoConfig(deps.configPath);
  const roleEnvVars = Object.values(config?.roles ?? {}).flatMap((r) => [r.usernameEnv, r.passwordEnv]);
  const token = deps.githubToken ?? process.env.GITHUB_TOKEN;

  // Checkout: an existing directory (demo, local) or a fresh clone of the branch.
  let repoDir: string | null = null;
  let branch = request.branch ?? "";
  let commitSha = deps.commitSha ?? "unknown";
  if (deps.repoDir) {
    repoDir = resolve(deps.repoDir);
    branch ||= "local";
  } else if (token) {
    try {
      const github = createGithubClient(token);
      branch ||= await getDefaultBranch(github, request.repo);
      repoDir = join(runDir, "repo");
      commitSha = await cloneBranch(request.repo, branch, repoDir, token);
      log(`checked out ${branch} at ${commitSha.slice(0, 7)}`);
    } catch (e) {
      repoDir = null;
      const msg = `clone failed: ${scrub((e as Error).message, token)}`;
      errors.push(msg);
      log(msg);
    }
  } else {
    errors.push("No GitHub token: the code was not read.");
  }

  // Update mode: start from the previous documents and the list of files changed since.
  const previous = deps.previous?.docs.length ? deps.previous : null;
  let changedSince: ChangedSince | null = null;
  if (previous) {
    writeKnowledgeFiles(knowledgeDir, previous);
    if (token && !deps.repoDir && commitSha !== "unknown" && previous.commitSha !== commitSha) {
      try {
        changedSince = await changedFilesBetween(createGithubClient(token), request.repo, previous.commitSha, commitSha);
        log(`update from ${previous.commitSha.slice(0, 7)}: ${changedSince.files.length} changed files`);
      } catch (e) {
        log(`compare failed: ${scrub((e as Error).message, token)}`);
      }
    }
  }

  const profile = capBudget(analysisProfile(request.budget), deps.remainingBudgetUsd);
  const driver = createDriver("playwright");
  const session: DriverSession = await driver.start({
    runDir,
    instanceUrl: request.instanceUrl,
    headed: request.headed,
    device: "desktop",
    language: request.language,
  });
  log(`browser driver: ${session.name}`);
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
    knowledgeDir,
    onLearning: deps.onLearning,
  });

  const guard = createBrowserGuard({
    allowedHosts: [new URL(request.instanceUrl).hostname, ...(config?.extraAllowedHosts ?? [])],
    maxBrowserSteps: profile.maxBrowserSteps,
    onStep: (n) => {
      if (n % 25 === 0) log(`browser steps: ${n}/${profile.maxBrowserSteps}`);
    },
  });

  const prompt = buildAnalysisPrompt({
    runId,
    request,
    config,
    repoDir,
    branch,
    commitSha,
    knowledgeDir,
    previous,
    changedSince,
    profile,
    driverPrefix: session.promptPrefix,
  });
  store.writeFile("prompt.md", prompt);

  const abortController = deps.abortController ?? new AbortController();
  const options: Options = {
    cwd: resolve(deps.projectRoot ?? process.cwd()),
    settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code", append: ANALYSIS_SYSTEM_APPEND },
    model: profile.orchestratorModel,
    effort: profile.effort,
    thinking: { type: "adaptive" },
    maxTurns: profile.maxTurns,
    maxBudgetUsd: profile.maxBudgetUsd,
    mcpServers: { ...session.mcpServers, claudio: createClaudioSdkServer(tools) },
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

  const report: AnalysisReport = {
    runId,
    status,
    request,
    commitSha,
    branch,
    previousCommitSha: previous?.commitSha,
    summary: result && result.subtype === "success" ? result.result : "",
    docs: readKnowledgeFiles(knowledgeDir),
    findings: store.findings(),
    evidence: store.evidence(),
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
    createdAt: nowIso(),
  };
  writeFileSync(join(runDir, "analysis.json"), JSON.stringify(report, null, 2));
  log(`analysis: status ${status}, ${report.docs.length} documents, ${report.cost.usd.toFixed(2)} USD`);
  return report;
}

/** Reads whatever knowledge documents exist in a directory, in the canonical order. */
export function readKnowledgeFiles(dir: string): KnowledgeDoc[] {
  const docs: KnowledgeDoc[] = [];
  for (const name of KnowledgeDocNameSchema.options) {
    const file = join(dir, KNOWLEDGE_DOCS[name].file);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8").trim();
    if (content) docs.push({ name, content });
  }
  return docs;
}
