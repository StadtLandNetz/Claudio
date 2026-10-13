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
  saveTestSteps,
  setAnalysisRunId,
  setReviewRunId,
  setTestRunStarted,
  toRepoConfig,
  toTestScript,
  userAccessToken,
  type Analysis,
  type Db,
  type EventTarget,
  type Review,
  type ReviewStatus,
  type TestRun,
} from "@claudio/db";
import { finalizeReview } from "./finalize.js";
import { humanBridge } from "./human.js";

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

  const abort = new AbortController();
  const abortRequested = job.kind === "review" ? isAbortRequested : job.kind === "analysis" ? isAnalysisAbortRequested : isTestRunAbortRequested;
  const abortPoll = setInterval(() => {
    abortRequested(db, job.row.id)
      .then((yes) => {
        if (yes && !abort.signal.aborted) {
          emit("Abbruch angefordert, Run wird beendet …");
          abort.abort();
        }
      })
      .catch(() => undefined);
  }, pollMs);

  const repo = await getRepoById(db, job.row.repoId);
  if (!repo) throw new Error(`Repo ${job.row.repoId} existiert nicht mehr.`);
  const user = await getUser(db, job.row.startedBy);
  const githubToken = user ? userAccessToken(user) || undefined : undefined;
  const { config, roleEnv } = toRepoConfig(repo, await listRoles(db, repo.id));
  const knowledge = await latestKnowledge(db, repo.id);

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
    stop: () => clearInterval(abortPoll),
    common: {
      runsRoot,
      projectRoot,
      config,
      roleEnv,
      githubToken,
      abortController: abort,
      onProgress: emit,
      human: humanBridge(db, { kind: job.kind, id: job.row.id, repoId: job.row.repoId }, emit, abort.signal),
    },
    knowledge,
    fixture,
  };
}

async function execute(db: Db, job: Job): Promise<void> {
  let ctx: Awaited<ReturnType<typeof prepare>> | undefined;
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
      // The comment is posted by finalizeReview once the regression tests are done, so it can include them.
      const report = await runReview({ ...job.row.request, postComment: false }, {
        ...c.common,
        knowledge: c.knowledge,
        reportUrl: publicBaseUrl ? `${publicBaseUrl}/reviews/${job.row.id}` : undefined,
        prContextFile: c.fixture?.prContextFile,
        repoDir: c.fixture?.repoDir,
        onRunStarted: ({ runId }: RunHandle) => c.after(() => setReviewRunId(db, job.row.id, runId)),
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
        onRunStarted: ({ runId }: RunHandle) => c.after(() => setTestRunStarted(db, job.row.id, runId, script.steps?.length && !job.row.request.rerecord ? row.stepsVersion : 0)),
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
    } else {
      if (c.knowledge) c.emit(`Aktualisiert die Wissensbasis von Commit ${c.knowledge.commitSha.slice(0, 7)}.`);
      const report = await runAnalysis(job.row.request, {
        ...c.common,
        previous: c.knowledge,
        repoDir: c.fixture?.repoDir,
        commitSha: c.fixture ? "demo" : undefined,
        onRunStarted: ({ runId }: RunHandle) => c.after(() => setAnalysisRunId(db, job.row.id, runId)),
      });
      await c.flush();
      await finishAnalysis(db, job.row.id, {
        status: report.status,
        report,
        error: report.errors.length ? report.errors.join("\n") : null,
      });
      log(`analysis ${job.row.id} finished: ${report.status}, ${report.docs.length} docs, ${report.cost.usd.toFixed(2)} USD`);
    }
  } catch (e) {
    const message = (e as Error).message;
    ctx?.emit(`Fehler: ${message}`);
    await ctx?.flush();
    await finish(ctx?.abort.signal.aborted ? "aborted" : "failed", message);
    log(`${job.kind} ${job.row.id} failed: ${message}`);
    const reviewId = job.kind === "review" ? job.row.id : job.kind === "test" ? job.row.reviewId : null;
    if (reviewId) await finalizeReview(db, reviewId, publicBaseUrl, log).catch(() => undefined);
  } finally {
    ctx?.stop();
  }
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
  const stop = () => {
    if (stopping) process.exit(1);
    stopping = true;
    log("stopping after the current run(s); press Ctrl+C again to force");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

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
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
