import { appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { query, type HookCallback, type Options, type PreToolUseHookInput, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  RunStore,
  StepRecorder,
  ariaSnapshot,
  createClaudioTools,
  detectCaptcha,
  guardNavigation,
  createDriver,
  createTestTools,
  executeStep,
  startLiveView,
  testPage,
  type HumanBridge,
  type HumanBridgeFactory,
  type StepContext,
} from "@claudio/browser";
import {
  TestRunRequestSchema,
  describeStep,
  newRunId,
  nowIso,
  testProfile,
  type BudgetProfile,
  type JudgeVerdict,
  type KnowledgeBase,
  type RepoConfig,
  type StepResult,
  type TestMode,
  type TestOutcome,
  type TestRunReport,
  type TestRunRequest,
  type TestScript,
  type TestStep,
} from "@claudio/core";
import { runJudge } from "./judge.js";
import { renderKnowledgeSection } from "./prompts.js";
import { createStopHook } from "./hooks.js";
import { describe, envWithout, mapStatus, modelEnv, writeKnowledgeFiles, type RunHandle } from "./runner.js";
import { createClaudioSdkServer } from "./sdk-tools.js";

export type TestRunnerDeps = {
  runsRoot?: string;
  projectRoot?: string;
  config: RepoConfig | null;
  roleEnv?: Record<string, string>;
  knowledge?: KnowledgeBase | null;
  abortController?: AbortController;
  /** The repository's Anthropic API key (see RunnerDeps.anthropicApiKey). */
  anthropicApiKey?: string;
  /** Without a key, do not start any model session (replays still run). Set by the worker. */
  requireApiKey?: boolean;
  /** Soft stop (see RunnerDeps.stopSignal). */
  stopSignal?: AbortSignal;
  onProgress?: (line: string) => void;
  onRunStarted?: (run: RunHandle) => void;
  liveView?: boolean;
  /** Lets a person take over the browser for CAPTCHAs and bot checks. */
  human?: HumanBridgeFactory;
};

const TEST_SYSTEM_APPEND = `
You are Claudio, running an automated UI test of a web application. You perform the test exactly as described, through the test_step tool only: Claudio executes every step itself and records the successful ones as a replayable script. Use snapshot to see the page's roles and accessible names and pick targets from it.

Rules for good recordings:
- Prefer {role, name} targets exactly as they appear in the snapshot; fall back to label, placeholder, text, testId, and css only when nothing else identifies the element uniquely.
- Start with login (if the flow needs a role) and goto, so a replay starts from a clean state.
- Put the expectation into assertion steps (expect_text, expect_visible, expect_url, expect_no_errors) wherever it can be checked mechanically. These assertions are what a replay checks without a model.
- Assertions must hold on every future run. Never assert values that change between runs: generated ids ("Fahrt #10"), timestamps, counters, totals. Assert the stable part ("angelegt") or the values you entered yourself (with {{run}}), e.g. expect_text "claudio-{{run}}" in the list.
- Locate rows and cells by the text you entered, not by their full content: {text: "claudio-{{run}}"} rather than a row name that includes ids or dates.
- Use {{run}} in names of records you create so repeated runs do not collide, and {{date:+N:FORMAT}} for dates (FORMAT as the app expects, e.g. DD.MM.YYYY or YYYY-MM-DD).
- Do not explore beyond the flow. Never type credentials; use login.
- CAPTCHAs and bot checks are for humans: never try to solve one. Call request_human_help; the person solves it in the live view and you continue.
- When the flow is done, call finish_test, then end with a short summary.
`.trim();

const BROWSER_GONE = /has been closed|Target closed|browser has disconnected|Browser closed/i;

/** Short tag for {{run}}: time of day plus the run id's random suffix. */
function runTagOf(runId: string): string {
  return runId.split("-").slice(-2).join("");
}

export async function runTest(script: TestScript, input: TestRunRequest, deps: TestRunnerDeps): Promise<TestRunReport> {
  const request = TestRunRequestSchema.parse(input);
  const log = deps.onProgress ?? (() => undefined);
  const runId = newRunId(`test-${script.id}`);
  const runDir = join(resolve(deps.runsRoot ?? "runs"), runId);
  const store = new RunStore(runDir);
  const started = Date.now();
  const errors: string[] = [];
  const profile = testProfile(request.budget);
  const abortController = deps.abortController ?? new AbortController();
  log(`run ${runId} → ${runDir}`);
  deps.onRunStarted?.({ runId, runDir });

  const mode: TestMode = request.rerecord || !script.steps?.length ? "record" : script.determinism === "explorative" ? "explore" : "replay";
  log(`mode: ${mode === "record" ? "record (agent performs and records the flow)" : mode === "explore" ? "explore (agent runs the flow freely)" : `replay of ${script.steps!.length} steps without a model`}`);

  const session = await createDriver("playwright").start({
    runDir,
    instanceUrl: request.instanceUrl,
    headed: request.headed,
    viewport: { width: 1280, height: 800 },
    language: request.language,
  });
  const attachment = session.attachment;
  if (!attachment) throw new Error("The Playwright driver did not provide a browser attachment.");
  const liveView = deps.liveView !== false ? startLiveView(attachment, join(runDir, "live.jpg")) : null;
  const human = deps.human ? deps.human(attachment) : undefined;

  const ctx: StepContext = {
    attachment,
    instanceUrl: request.instanceUrl,
    roles: deps.config?.roles ?? {},
    env: { ...process.env, ...(deps.roleEnv ?? {}) },
    runTag: runTagOf(runId),
    extraAllowedHosts: [...(deps.config?.extraAllowedHosts ?? []), ...(script.allowedHosts ?? [])],
    allowAnyHost: script.allowAnyHost ?? false,
    store,
    baselineSeq: attachment.capture.lastSeq,
  };
  await guardNavigation(ctx, (url) => log(`blocked navigation to ${url} (host not allowed for this test)`));
  await testPage(attachment);

  let steps: StepResult[] = [];
  let compiledSteps: TestStep[] | undefined;
  let healedAt: number | undefined;
  let determinismProposal: TestRunReport["determinismProposal"];
  let runnerSummary: string | undefined;
  let agentCost = 0;
  let agentTurns = 0;
  let status: TestRunReport["status"] = "completed";
  let assertionFailure: StepResult | undefined;

  const NO_KEY = "Für dieses Repository ist kein Anthropic-API-Key hinterlegt. Ein Admin kann ihn in den Repo-Einstellungen eintragen.";
  const modelAllowed = !deps.requireApiKey || Boolean(deps.anthropicApiKey);

  const agentRun = async (prompt: string, recorder: StepRecorder, healing: boolean) => {
    if (!modelAllowed) {
      status = "failed";
      errors.push(NO_KEY);
      log(NO_KEY);
      return;
    }
    const res = await runTestAgent({ prompt, recorder, healing, ctx, store, runDir, profile, deps, abortController, log, language: request.language, human });
    agentCost += res.costUsd;
    agentTurns += res.turns;
    if (res.status !== "completed") status = res.status;
    errors.push(...res.errors);
  };

  try {
    if (mode === "replay") {
      const planned = script.steps!;
      for (let i = 0; i < planned.length; i++) {
        if (abortController.signal.aborted || deps.stopSignal?.aborted) {
          status = "aborted";
          break;
        }
        const step = planned[i]!;
        // A CAPTCHA in the way: hand over to a person, then go on. Retried once if it broke the step.
        if (!(await clearChallenge(attachment, human, log))) {
          status = "failed";
          errors.push("Ein CAPTCHA oder eine Bot-Prüfung hat den Lauf blockiert, und niemand hat es gelöst.");
          break;
        }
        let out = await executeStep(step, ctx);
        if (!out.ok && (await detectCaptcha(attachment.activePage())) && (await clearChallenge(attachment, human, log))) {
          out = await executeStep(step, ctx);
        }
        const result: StepResult = { index: i, step, ok: out.ok, error: out.error, durationMs: out.durationMs, healed: false };
        steps.push(result);
        log(`${out.ok ? "✓" : "✗"} ${i + 1}/${planned.length} ${describeStep(step)}${out.error ? `: ${out.error}` : ""}`);
        if (out.ok) continue;
        if (out.assertionFailed) {
          // Semi-deterministic: the judge decides, a single brittle check must not end the run.
          if (script.determinism === "semi") continue;
          assertionFailure = result;
          break;
        }
        // A step that cannot be executed (element gone, renamed, moved): let the agent heal from here.
        healedAt = i;
        log(`step ${i + 1} broke, the agent takes over from here`);
        const recorder = new StepRecorder(planned.slice(0, i));
        await agentRun(healPrompt(script, planned, i, out.error ?? "", request, deps), recorder, true);
        steps = [...steps.slice(0, i), ...recorder.results];
        runnerSummary = recorder.finish?.summary;
        if (recorder.finish?.complete) compiledSteps = recorder.compiled();
        store.addFinding({
          category: "regression",
          severity: "minor",
          title: `Testablauf musste angepasst werden: ${describeStep(step)}`,
          description: `Schritt ${i + 1} ließ sich nicht mehr ausführen (${out.error}). Claudio hat den Ablauf ab dort neu aufgezeichnet. Prüfe, ob die Änderung an der Oberfläche beabsichtigt war.`,
          steps: planned.slice(0, i + 1).map(describeStep),
          expected: describeStep(step),
          actual: out.error,
          evidenceIds: [],
        });
        break;
      }
    } else {
      const recorder = new StepRecorder();
      await agentRun(mode === "record" ? recordPrompt(script, request, deps) : explorePrompt(script, request, deps), recorder, false);
      steps = recorder.results;
      runnerSummary = recorder.finish?.summary;
      determinismProposal = mode === "record" ? recorder.finish?.determinism : undefined;
      if (mode === "record" && recorder.finish?.complete && recorder.recorded.length > 0) compiledSteps = recorder.compiled();
    }
  } catch (e) {
    status = abortController.signal.aborted ? "aborted" : "failed";
    errors.push(`test error: ${(e as Error).message}`);
    log(`test error: ${(e as Error).message}`);
  }

  // A crashed browser makes every later step fail; report that instead of a test result.
  const browserGone = !attachment.browser.isConnected() || steps.some((r) => r.error && BROWSER_GONE.test(r.error));
  if (browserGone && status === "completed") {
    status = "failed";
    errors.push("Der Browser wurde während des Laufs unerwartet beendet. Starte den Test erneut.");
    log("browser crashed during the run");
  }

  // Final state as evidence for people and for the judge.
  let finalUrl = "";
  let finalSnapshot = "";
  let screenshotPath: string | null = null;
  try {
    const page = await testPage(attachment);
    finalUrl = page.url();
    finalSnapshot = await ariaSnapshot(attachment, 12_000);
    const id = store.nextEvidenceId();
    screenshotPath = join(store.evidenceDir, `${id}-Endzustand.png`);
    await page.screenshot({ path: screenshotPath });
    store.addEvidence({ id, kind: "screenshot", label: "Endzustand", path: `evidence/${id}-Endzustand.png`, pageUrl: finalUrl });
  } catch {
    // browser already gone (abort)
  }
  const consoleNetwork = [
    ...attachment.capture.queryConsole({ level: "error", sinceSeq: ctx.baselineSeq, limit: 10 }).map((e) => `console: ${e.text.slice(0, 200)}`),
    ...attachment.capture.queryNetwork({ onlyErrors: true, onlyApi: true, sinceSeq: ctx.baselineSeq, limit: 10 }).map((e) => `${e.method} ${e.url} → ${e.failed ?? e.status}`),
  ];

  await liveView?.stop().catch(() => undefined);
  await session.close().catch((e) => errors.push(`driver close: ${(e as Error).message}`));

  // Outcome. A deterministic replay without failures needs no model at all.
  let outcome: TestOutcome = "inconclusive";
  let judge: JudgeVerdict | undefined;
  const allOk = steps.length > 0 && steps.every((s) => s.ok);
  const needsJudge = status === "completed" && !assertionFailure && (mode !== "replay" || healedAt !== undefined || script.determinism === "semi");
  if (status !== "completed") {
    outcome = "inconclusive";
  } else if (assertionFailure) {
    outcome = "failed";
  } else if (!needsJudge) {
    outcome = allOk ? "passed" : "failed";
  } else if (!modelAllowed) {
    outcome = "inconclusive";
    errors.push(NO_KEY);
  } else {
    log("judge: comparing the final state with the expectation");
    const j = await runJudge({
      script,
      steps,
      runTag: ctx.runTag,
      finalUrl,
      finalSnapshot,
      screenshotPath,
      errors: consoleNetwork,
      runnerSummary,
      language: request.language,
      model: profile.orchestratorModel,
      runDir,
      abortController,
      apiKey: deps.anthropicApiKey,
    });
    agentCost += j.costUsd;
    if (j.error) errors.push(j.error);
    judge = j.verdict ?? undefined;
    outcome = !judge ? "inconclusive" : judge.passed ? (judge.confidence >= 0.5 ? "passed" : "inconclusive") : judge.confidence >= 0.5 ? "failed" : "inconclusive";
    if (judge) log(`judge: ${judge.passed ? "passed" : "not passed"} (confidence ${judge.confidence.toFixed(2)})`);
  }

  const summary =
    runnerSummary ??
    (assertionFailure
      ? `Prüfung in Schritt ${assertionFailure.index + 1} fehlgeschlagen: ${assertionFailure.error}`
      : outcome === "passed"
        ? `Alle ${steps.length} Schritte und Prüfungen bestanden.`
        : "");

  const report: TestRunReport = {
    runId,
    status,
    mode,
    outcome,
    healedAt,
    steps,
    compiledSteps,
    determinismProposal,
    judge,
    summary,
    findings: store.findings(),
    evidence: store.evidence(),
    finalUrl,
    cost: {
      usd: agentCost,
      inputTokens: 0,
      outputTokens: 0,
      turns: agentTurns,
      durationMs: Date.now() - started,
      browserSteps: steps.length,
    },
    errors,
    createdAt: nowIso(),
  };
  writeFileSync(join(runDir, "test-run.json"), JSON.stringify(report, null, 2));
  log(`test: ${outcome} (${mode}${healedAt !== undefined ? ", healed" : ""}), ${agentCost.toFixed(2)} USD`);
  return report;
}

/** Waits for a person when a CAPTCHA is on the page. False when it stays unsolved. */
async function clearChallenge(attachment: StepContext["attachment"], human: HumanBridge | undefined, log: (line: string) => void): Promise<boolean> {
  const captcha = await detectCaptcha(attachment.activePage());
  if (!captcha) return true;
  if (!human) {
    log(`${captcha} on the page, and no person can take over in this run`);
    return false;
  }
  const outcome = await human.wait(`${captcha} lösen`);
  return outcome === "resolved";
}

// ---------------------------------------------------------------- agent session

async function runTestAgent(a: {
  prompt: string;
  recorder: StepRecorder;
  healing: boolean;
  ctx: StepContext;
  store: RunStore;
  runDir: string;
  profile: BudgetProfile;
  deps: TestRunnerDeps;
  abortController: AbortController;
  log: (line: string) => void;
  language: "de" | "en";
  human?: HumanBridge;
}): Promise<{ status: TestRunReport["status"]; costUsd: number; turns: number; errors: string[] }> {
  const base = createClaudioTools({
    runDir: a.runDir,
    store: a.store,
    attachment: a.ctx.attachment,
    instanceUrl: a.ctx.instanceUrl,
    roles: a.ctx.roles,
    driver: "playwright",
    env: a.ctx.env,
    human: a.human,
  }).filter((t) => ["capture_evidence", "get_console", "get_network", "note", "report_finding", "request_human_help"].includes(t.name));
  const tools = [...createTestTools(a.ctx, a.recorder, { healing: a.healing }), ...base];

  let knowledgeDir: string | null = null;
  if (a.deps.knowledge?.docs.length) knowledgeDir = writeKnowledgeFiles(join(a.runDir, "knowledge"), a.deps.knowledge);
  const roleEnvVars = Object.values(a.deps.config?.roles ?? {}).flatMap((r) => [r.usernameEnv, r.passwordEnv]);

  // The agent may read its own run directory (knowledge base), nothing else: the cwd is Claudio's
  // repository, not the app under test.
  const runRoot = resolve(a.runDir);
  const readGuard: HookCallback = async (input) => {
    const i = input as PreToolUseHookInput;
    const path = String((i.tool_input as { file_path?: string })?.file_path ?? "");
    if (i.tool_name === "Read" && resolve(path).startsWith(runRoot + "/")) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: "In test runs only files of this run (the knowledge base) can be read. Use snapshot to inspect the app.",
      },
    };
  };

  const options: Options = {
    cwd: resolve(a.deps.projectRoot ?? process.cwd()),
    settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code", append: TEST_SYSTEM_APPEND },
    hooks: { PreToolUse: [...createStopHook(a.deps.stopSignal), { matcher: "^(Read|Grep|Glob)$", hooks: [readGuard] }] },
    model: a.profile.orchestratorModel,
    effort: a.profile.effort,
    thinking: { type: "adaptive" },
    maxTurns: a.profile.maxTurns,
    maxBudgetUsd: a.profile.maxBudgetUsd,
    mcpServers: { claudio: createClaudioSdkServer(tools) },
    strictMcpConfig: true,
    allowedTools: ["mcp__claudio__*", "Read"],
    disallowedTools: ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "KillShell", "BashOutput", "Agent", "Grep", "Glob"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    additionalDirectories: knowledgeDir ? [knowledgeDir] : [],
    abortController: a.abortController,
    env: modelEnv(envWithout(process.env, roleEnvVars), a.deps.anthropicApiKey),
    stderr: (data) => appendFileSync(join(a.runDir, "claude-stderr.log"), data),
  };
  const fullPrompt = knowledgeDir && a.deps.knowledge ? `${a.prompt}\n\n${renderKnowledgeSection(knowledgeDir, a.deps.knowledge, "review")}` : a.prompt;
  a.store.writeFile(a.healing ? "prompt-heal.md" : "prompt.md", fullPrompt);

  let result: SDKResultMessage | undefined;
  const errors: string[] = [];
  let status: TestRunReport["status"] = "failed";
  try {
    for await (const m of query({ prompt: fullPrompt, options })) {
      appendFileSync(join(a.runDir, "log.jsonl"), JSON.stringify(m) + "\n");
      describe(m, a.log);
      if (m.type === "result") result = m;
    }
    status = a.deps.stopSignal?.aborted ? "aborted" : mapStatus(result);
    if (result && result.subtype !== "success") errors.push(...result.errors);
  } catch (e) {
    status = a.abortController.signal.aborted ? "aborted" : "failed";
    errors.push(`agent error: ${(e as Error).message}`);
  }
  return { status, costUsd: result?.total_cost_usd ?? 0, turns: result?.num_turns ?? 0, errors };
}

// ---------------------------------------------------------------- prompts

function scriptBlock(script: TestScript, request: TestRunRequest, deps: TestRunnerDeps): string {
  const roles = Object.entries(deps.config?.roles ?? {});
  return `# Test "${script.name}"

## What to do
${script.description.trim()}

## Expectation (what must be true at the end)
${script.expectation.trim()}

## Instance
Base URL: ${request.instanceUrl}
Hosts the test may open: ${script.allowAnyHost ? "any" : [new URL(request.instanceUrl).hostname, ...(deps.config?.extraAllowedHosts ?? []), ...(script.allowedHosts ?? [])].join(", ")}. For other hosts use goto with the full URL.
Roles for login: ${roles.length ? roles.map(([n, r]) => `${n}${r.description ? ` (${r.description})` : ""}`).join(", ") : "none configured"}${script.roles.length ? `. Use: ${script.roles.join(", ")}` : ""}.
${deps.config?.notes ? `\n## Notes about the application\n${deps.config.notes.trim()}\n` : ""}
Write summaries in ${request.language === "de" ? "German" : "English"}.`;
}

function recordPrompt(script: TestScript, request: TestRunRequest, deps: TestRunnerDeps): string {
  return `${scriptBlock(script, request, deps)}

# Your task: record this test
Perform the flow with test_step, step by step, starting from login/goto. After each action take a snapshot when you need to see the result. Express every checkable part of the expectation as an assertion step. If the app does not behave as expected, still finish the flow as far as possible, report_finding for the bug with evidence, and call finish_test with outcome failed. Then call finish_test with your determinism proposal.`;
}

function explorePrompt(script: TestScript, request: TestRunRequest, deps: TestRunnerDeps): string {
  const hint = script.steps?.length ? `\n\nA previous run did it like this (adapt as needed):\n${script.steps.map((s, i) => `${i + 1}. ${describeStep(s)}`).join("\n")}` : "";
  return `${scriptBlock(script, request, deps)}

# Your task: run this test
This test is explorative: the flow may need different choices each time. Perform it with test_step, check the expectation with assertion steps where possible, report_finding for bugs, and call finish_test.${hint}`;
}

function healPrompt(script: TestScript, planned: TestStep[], brokenAt: number, error: string, request: TestRunRequest, deps: TestRunnerDeps): string {
  const list = planned.map((s, i) => `${i + 1}. ${i < brokenAt ? "(done) " : i === brokenAt ? "(BROKE) " : ""}${describeStep(s)}`).join("\n");
  return `${scriptBlock(script, request, deps)}

# Your task: repair a broken replay
This test was recorded earlier. Replaying it, steps 1 to ${brokenAt} worked, step ${brokenAt + 1} failed:
${error}

Recorded steps:
${list}

The browser is in the state after step ${brokenAt}. Take a snapshot, find out what changed (renamed or moved element, extra dialog, different navigation), and continue the flow from here with test_step until the end, including the assertions. Keep the intent of the original steps. If the change looks like a bug rather than an intended UI change, report_finding. Then call finish_test (complete: true if you reached the end of the flow).`;
}
