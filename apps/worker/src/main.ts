#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAnalysis, runReview, runTest, type RunHandle } from "@claudio/agent";
import { verdict } from "@claudio/core";
import {
  appendEvent,
  claimNextAnalysis,
  claimNextReview,
  claimNextTestRun,
  closeDb,
  failStaleRuns,
  finishAnalysis,
  finishReview,
  finishTestRun,
  getDb,
  getRepoById,
  getTestScript,
  getUser,
  isAbortRequested,
  isAnalysisAbortRequested,
  isTestRunAbortRequested,
  latestKnowledge,
  listRoles,
  repoAnthropicKey,
  saveTestSteps,
  setAnalysisRunId,
  setReviewRunId,
  setTestRunStarted,
  toRepoConfig,
  addLearning,
  listLearnings,
  LEARNINGS_IN_PROMPT,
  toTestScript,
  freshAccessToken,
  claimNotification,
  getTestRun,
  listTestRuns,
  notify,
  type Analysis,
  type Db,
  type EventTarget,
  type Review,
  type ReviewStatus,
  type TestRun,
} from "@claudio/db";
import { persistArtifacts, persistTrace, purgeOldArtifacts } from "./artifacts.js";
import { finalizeReview } from "./finalize.js";
import { followUpContext } from "./follow-up.js";
import { humanBridge } from "./human.js";
import { purgeOldRuns } from "./retention.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
if (existsSync(resolve(projectRoot, ".env"))) process.loadEnvFile(resolve(projectRoot, ".env"));

const runsRoot = resolve(projectRoot, process.env.CLAUDIO_RUNS_DIR ?? "runs");
const concurrency = Math.max(1, Number(process.env.CLAUDIO_WORKER_CONCURRENCY ?? 1));
const pollMs = 2000;
/** Base URL of the web UI, for links in PR comments. */
const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

/** Offline fixtures a run may use instead of GitHub (CLAUDIO_DEV_FIXTURES=1 only). */
const FIXTURES: Record<string, { prContextFile: string; repoDir: string }> = {
  demo: {
    prContextFile: resolve(projectRoot, "apps/demo-target/fixtures/pr-context.json"),
    repoDir: resolve(projectRoot, "apps/demo-target"),
  },
};

/** The offline demo may use the machine's own Claude login on the dev server; every real repo needs its own key. */
const DEMO_REPO = "vanderlars/dispo-demo";
/** Becomes the run's error, which also reaches the commit status, so it follows the run's report language. */
const NO_KEY = {
  de: "Für dieses Repository ist kein Anthropic-API-Key hinterlegt. Ein Admin kann ihn in den Repo-Einstellungen eintragen.",
  en: "No Anthropic API key is stored for this repository. An admin can add it in the repository settings.",
};

/** Soft-stop handles of the runs in progress, so a shutdown (deploy) can end them cleanly. */
const runningStops = new Set<AbortController>();
/** Run directories (traces, checkouts) and stored screenshots and trace frames are deleted after this many days. */
const retentionDays = Number(process.env.CLAUDIO_RUN_RETENTION_DAYS ?? 14);
const artifactRetentionDays = Number(process.env.CLAUDIO_ARTIFACT_RETENTION_DAYS ?? 14);

const log = (msg: string) => console.log(`[worker] ${new Date().toISOString()} ${msg}`);

type Job =
  | { kind: "review"; row: Review }
  | { kind: "analysis"; row: Analysis }
  | { kind: "test"; row: TestRun & { fixture?: null } };

/** Live log, abort polling and the shared repo/user context of one run. */
async function prepare(db: Db, job: Job) {
  const target: EventTarget =
    job.kind === "review" ? { reviewId: job.row.id } : job.kind === "analysis" ? { analysisId: job.row.id } : { testRunId: job.row.id };
  let seq = 0;
  let pending: Promise<unknown> = Promise.resolve();
  // onProgress is synchronous; chain the inserts so the live log keeps its order.
  const emit = (line: string) => {
    const n = ++seq;
    pending = pending.then(() => appendEvent(db, target, n, line)).catch((e) => log(`event write failed: ${(e as Error).message}`));
  };
  const after = (fn: () => Promise<unknown>) => {
    pending = pending.then(fn).catch((e) => log(`write failed: ${(e as Error).message}`));
  };

  // Cancelling first asks the agent to stop (soft), so the SDK still reports the cost;
  // only if it does not finish within a minute is the process killed (hard).
  const abort = new AbortController();
  const stop = new AbortController();
  runningStops.add(stop);
  let hardAbort: ReturnType<typeof setTimeout> | undefined;
  const abortRequested = job.kind === "review" ? isAbortRequested : job.kind === "analysis" ? isAnalysisAbortRequested : isTestRunAbortRequested;
  const abortPoll = setInterval(() => {
    abortRequested(db, job.row.id)
      .then((yes) => {
        if (yes && !stop.signal.aborted) {
          emit("Abbruch angefordert, Claudio beendet den Lauf …");
          stop.abort();
          hardAbort = setTimeout(() => abort.abort(), 60_000);
        }
      })
      .catch(() => undefined);
  }, pollMs);

  const repo = await getRepoById(db, job.row.repoId);
  if (!repo) throw new Error(`Repo ${job.row.repoId} existiert nicht mehr.`);
  const user = await getUser(db, job.row.startedBy);
  const githubToken = user ? ((await freshAccessToken(db, user)) ?? undefined) : undefined;
  const learnings = (await listLearnings(db, repo.id, LEARNINGS_IN_PROMPT)).map((l) => l.text);
  const { config, roleEnv } = toRepoConfig(repo, await listRoles(db, repo.id), undefined, learnings);
  const knowledge = await latestKnowledge(db, repo.id);
  const anthropicApiKey = repoAnthropicKey(repo) ?? undefined;
  const keyOptional = process.env.CLAUDIO_DEV_FIXTURES === "1" && repo.fullName === DEMO_REPO;
  // Reviews and analyses always need the model; test replays may run without it.
  if (!anthropicApiKey && !keyOptional && job.kind !== "test") throw new Error(NO_KEY[(job.row.request as { language?: string }).language === "en" ? "en" : "de"]);

  let fixture: (typeof FIXTURES)[string] | undefined;
  if (job.row.fixture) {
    if (process.env.CLAUDIO_DEV_FIXTURES !== "1") throw new Error("Fixture-Runs sind nur mit CLAUDIO_DEV_FIXTURES=1 erlaubt.");
    fixture = FIXTURES[job.row.fixture];
    if (!fixture) throw new Error(`Unbekannte Fixture "${job.row.fixture}".`);
  }

  return {
    emit,
    after,
    flush: () => pending,
    abort,
    stop: () => {
      clearInterval(abortPoll);
      clearTimeout(hardAbort);
      runningStops.delete(stop);
    },
    stopped: () => stop.signal.aborted || abort.signal.aborted,
    common: {
      runsRoot,
      projectRoot,
      config,
      roleEnv,
      githubToken,
      abortController: abort,
      stopSignal: stop.signal,
      anthropicApiKey,
      requireApiKey: !keyOptional,
      onProgress: emit,
      human: humanBridge(db, { kind: job.kind, id: job.row.id, repoId: job.row.repoId, repo, what: runLabel(job), language: runLanguage(job) }, emit, stop.signal, publicBaseUrl),
      onLearning: (text: string) => {
        emit(`Gelernt: ${text}`);
        void addLearning(db, { repoId: job.row.repoId, text, runKind: job.kind, runRefId: job.row.id }).catch((e) => log(`learning not saved: ${(e as Error).message}`));
      },
    },
    knowledge,
    fixture,
    repo,
  };
}

/** How a run is named in a notification. */
function runLabel(job: Job): string {
  if (job.kind === "review") return `#${job.row.prNumber} ${job.row.prTitle ?? ""}`.trim();
  if (job.kind === "analysis") return job.row.request.repo;
  return `#${job.row.id}`;
}

const runLanguage = (job: Job): "de" | "en" => ((job.row.request as { language?: string }).language === "en" ? "en" : "de");

async function execute(db: Db, job: Job): Promise<void> {
  let ctx: Awaited<ReturnType<typeof prepare>> | undefined;
  // Set once the runner has created the run directory; its screenshots and trace are stored after the run.
  let run: RunHandle | undefined;
  const finish = (status: ReviewStatus, error: string | null) =>
    job.kind === "review"
      ? finishReview(db, job.row.id, { status, report: null, verdict: null, error })
      : job.kind === "analysis"
        ? finishAnalysis(db, job.row.id, { status, report: null, error })
        : finishTestRun(db, job.row.id, { status, report: null, error });
  try {
    ctx = await prepare(db, job);
    const c = ctx;
    if (job.kind === "review") {
      if (c.knowledge) c.emit(`Wissensbasis von Commit ${c.knowledge.commitSha.slice(0, 7)} wird mitgegeben.`);
      const followUp = await followUpContext(db, job.row, c.common.githubToken, c.emit);
      if (followUp) c.emit(`Nachprüfung von Review #${followUp.reviewId}: ${followUp.findings.length} offene Findings, ${followUp.changedFiles ? `${followUp.changedFiles.length} geänderte Dateien` : "Änderungen unbekannt"}.`);
      // The comment is posted by finalizeReview once the regression tests are done, so it can include them.
      const report = await runReview({ ...job.row.request, postComment: false }, {
        ...c.common,
        knowledge: c.knowledge,
        followUp,
        reportUrl: publicBaseUrl ? `${publicBaseUrl}/reviews/${job.row.id}` : undefined,
        prContextFile: c.fixture?.prContextFile,
        repoDir: c.fixture?.repoDir,
        onRunStarted: (h: RunHandle) => {
          run = h;
          c.after(() => setReviewRunId(db, job.row.id, h.runId));
        },
      });
      await c.flush();
      await finishReview(db, job.row.id, {
        status: report.status,
        report,
        verdict: verdict(report),
        error: report.errors.length ? report.errors.join("\n") : null,
      });
      log(`review ${job.row.id} finished: ${report.status}, ${report.cost.usd.toFixed(2)} USD`);
      await finalizeReview(db, job.row.id, publicBaseUrl, log);
    } else if (job.kind === "test") {
      const row = await getTestScript(db, job.row.scriptId);
      if (!row) throw new Error("Der Test existiert nicht mehr.");
      const script = toTestScript(row);
      const report = await runTest(script, job.row.request, {
        ...c.common,
        knowledge: c.knowledge,
        onRunStarted: (h: RunHandle) => {
          run = h;
          c.after(() => setTestRunStarted(db, job.row.id, h.runId, script.steps?.length && !job.row.request.rerecord ? row.stepsVersion : 0));
        },
      });
      await c.flush();
      await finishTestRun(db, job.row.id, { status: report.status, report, error: report.errors.length ? report.errors.join("\n") : null });
      // A new recording or a healed replay becomes the script's next version.
      if (report.compiledSteps?.length) {
        // A new recording brings its own classification; a healed replay keeps the script's.
        const determinism = report.mode === "record" ? (report.determinismProposal ?? "deterministic") : undefined;
        await saveTestSteps(db, script.id, report.compiledSteps, determinism);
        c.emit(`Ablauf gespeichert (${report.compiledSteps.length} Schritte, Version ${row.stepsVersion + 1}).`);
        await c.flush();
      }
      log(`test run ${job.row.id} (${script.name}) finished: ${report.outcome}, ${report.mode}, ${report.cost.usd.toFixed(2)} USD`);
      if (job.row.reviewId) await finalizeReview(db, job.row.reviewId, publicBaseUrl, log);
      else await notifyTestRun(db, job.row.id, c.repo, log);
    } else {
      if (c.knowledge) c.emit(`Aktualisiert die Wissensbasis von Commit ${c.knowledge.commitSha.slice(0, 7)}.`);
      const report = await runAnalysis(job.row.request, {
        ...c.common,
        previous: c.knowledge,
        repoDir: c.fixture?.repoDir,
        commitSha: c.fixture ? "demo" : undefined,
        onRunStarted: (h: RunHandle) => {
          run = h;
          c.after(() => setAnalysisRunId(db, job.row.id, h.runId));
        },
      });
      await c.flush();
      await finishAnalysis(db, job.row.id, {
        status: report.status,
        report,
        error: report.errors.length ? report.errors.join("\n") : null,
      });
      log(`analysis ${job.row.id} finished: ${report.status}, ${report.docs.length} docs, ${report.cost.usd.toFixed(2)} USD`);
      await notify(c.repo, { kind: "analysis", id: job.row.id, status: report.status, docs: report.docs.length, error: report.errors[0] ?? null }, { language: runLanguage(job), baseUrl: publicBaseUrl, log });
    }
  } catch (e) {
    const message = (e as Error).message;
    ctx?.emit(`Fehler: ${message}`);
    await ctx?.flush();
    await finish(ctx?.stopped() ? "aborted" : "failed", message);
    log(`${job.kind} ${job.row.id} failed: ${message}`);
    const reviewId = job.kind === "review" ? job.row.id : job.kind === "test" ? job.row.reviewId : null;
    if (reviewId) await finalizeReview(db, reviewId, publicBaseUrl, log).catch(() => undefined);
    else if (job.kind === "test" && ctx) await notifyTestRun(db, job.row.id, ctx.repo, log).catch(() => undefined);
    else if (job.kind === "analysis" && ctx) await notify(ctx.repo, { kind: "analysis", id: job.row.id, status: "failed", docs: 0, error: message }, { language: runLanguage(job), baseUrl: publicBaseUrl, log });
  } finally {
    ctx?.stop();
    if (run) {
      await persistArtifacts(db, run, log).catch((e) => log(`storing screenshots failed: ${(e as Error).message}`));
      await persistTrace(db, run, log).catch((e) => log(`storing trace failed: ${(e as Error).message}`));
    }
  }
}

/**
 * A test run outside a review: its own result, or, once the last run of its suite
 * has finished, the suite's. Each goes to Slack once.
 */
async function notifyTestRun(db: Db, testRunId: number, repo: Parameters<typeof notify>[0], log: (msg: string) => void): Promise<void> {
  const run = await getTestRun(db, testRunId);
  if (!run) return;
  const language = run.request.language === "en" ? "en" : "de";
  if (!run.batchId) {
    if (!(await claimNotification(db, { testRunId }))) return;
    await notify(repo, { kind: "test", id: run.id, name: run.scriptName, outcome: run.outcome, status: run.status, summary: run.report?.summary ?? run.error ?? "" }, { language, baseUrl: publicBaseUrl, log });
    return;
  }
  const batch = await listTestRuns(db, { batchId: run.batchId, repoId: run.repoId }, 500);
  if (batch.some((r) => r.status === "queued" || r.status === "running")) return;
  // The suite's message is claimed on its first run, so it goes out once even if two runs finish together.
  const first = batch.reduce((a, b) => (a.id < b.id ? a : b));
  if (!(await claimNotification(db, { testRunId: first.id }))) return;
  await notify(
    repo,
    { kind: "suite", batchId: run.batchId, total: batch.length, passed: batch.filter((r) => r.outcome === "passed").length, failed: batch.filter((r) => r.outcome !== "passed").map((r) => r.scriptName) },
    { language, baseUrl: publicBaseUrl, log },
  );
}

/** Reviews first: they block a merge, an analysis can wait. */
async function claimNext(db: Db): Promise<Job | null> {
  const review = await claimNextReview(db);
  if (review) return { kind: "review", row: review };
  const test = await claimNextTestRun(db);
  if (test) return { kind: "test", row: test };
  const analysis = await claimNextAnalysis(db);
  if (analysis) return { kind: "analysis", row: analysis };
  return null;
}

async function main(): Promise<void> {
  const db = getDb();
  const stale = await failStaleRuns(db);
  if (stale) log(`marked ${stale} interrupted run(s) as failed`);
  log(`polling for reviews and analyses (concurrency ${concurrency}, runs in ${runsRoot})`);

  const active = new Set<Promise<void>>();
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    // On SIGTERM (Kubernetes deploy) running agents are asked to finish now, so their cost is still
    // recorded; the pod's termination grace period covers that. Ctrl+C locally lets them finish.
    if (signal === "SIGTERM") for (const s of runningStops) s.abort();
    log(signal === "SIGTERM" ? `stopping ${runningStops.size} running run(s) for shutdown` : "stopping after the current run(s); press Ctrl+C again to force");
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  const housekeeping = async () => {
    await purgeOldRuns(runsRoot, retentionDays, log);
    await purgeOldArtifacts(db, artifactRetentionDays, log);
  };
  await housekeeping();
  const purge = setInterval(() => void housekeeping(), 6 * 3_600_000);

  while (!stopping) {
    if (active.size < concurrency) {
      const job = await claimNext(db).catch((e) => {
        log(`poll failed: ${(e as Error).message}`);
        return null;
      });
      if (job) {
        const what = job.kind === "review" ? `${job.row.request.repo}#${job.row.prNumber}` : job.kind === "test" ? `test script ${job.row.scriptId}` : job.row.request.repo;
        log(`${job.kind} ${job.row.id}: ${what} → ${job.row.instanceUrl}`);
        const run = execute(db, job).finally(() => active.delete(run));
        active.add(run);
        continue;
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  await Promise.all(active);
  clearInterval(purge);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
