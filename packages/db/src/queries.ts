import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, getTableColumns, gt, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import type {
  AnalysisReport,
  AnalysisRequest,
  Determinism,
  Finding,
  FollowUp,
  KnowledgeBase,
  KnowledgeDoc,
  LoginStep,
  ReportLike,
  ReviewReport,
  ReviewRequest,
  Severity,
  Strictness,
  TestRunReport,
  TestRunRequest,
  TestScript,
  TestStep,
} from "@claudio/core";
import type { AutomationSettings } from "@claudio/github";
import type { Db } from "./client.js";
import { decrypt, encrypt, sha256 } from "./crypto.js";
import {
  agentLearnings,
  analyses,
  findings,
  runArtifacts,
  repoAccess,
  humanInputs,
  humanRequests,
  knowledgeDocs,
  repoRoles,
  repos,
  reviews,
  runEvents,
  sessions,
  testRuns,
  testScripts,
  users,
  type AccessLevel,
  type Analysis,
  type AutoReviewDefaults,
  type Lesson,
  type NotificationSettings,
  type FindingStatus,
  type HumanInputPayload,
  type HumanRequest,
  type RunKind,
  type Repo,
  type Review,
  type ReviewStatus,
  type TestRun,
  type TestScriptRow,
  type User,
} from "./schema.js";

// ---------------------------------------------------------------- users & sessions

export async function upsertUser(
  db: Db,
  input: { githubId: number; login: string; name: string | null; avatarUrl: string | null; accessToken: string; refreshToken?: string; expiresAt?: Date },
): Promise<User> {
  const tokens = {
    accessTokenEnc: encrypt(input.accessToken),
    refreshTokenEnc: input.refreshToken ? encrypt(input.refreshToken) : null,
    tokenExpiresAt: input.expiresAt ?? null,
  };
  const values = { githubId: input.githubId, login: input.login, name: input.name, avatarUrl: input.avatarUrl, ...tokens, lastLoginAt: new Date() };
  await db
    .insert(users)
    .values(values)
    .onDuplicateKeyUpdate({ set: { login: values.login, name: values.name, avatarUrl: values.avatarUrl, ...tokens, lastLoginAt: values.lastLoginAt } });
  const [user] = await db.select().from(users).where(eq(users.githubId, input.githubId));
  if (!user) throw new Error("user upsert failed");
  return user;
}

export async function updateUserTokens(db: Db, userId: number, t: { accessToken: string; refreshToken?: string; expiresAt?: Date }): Promise<void> {
  await db
    .update(users)
    .set({
      accessTokenEnc: encrypt(t.accessToken),
      ...(t.refreshToken ? { refreshTokenEnc: encrypt(t.refreshToken) } : {}),
      tokenExpiresAt: t.expiresAt ?? null,
    })
    .where(eq(users.id, userId));
}

export function userAccessToken(user: Pick<User, "accessTokenEnc">): string {
  return decrypt(user.accessTokenEnc);
}

export async function getUser(db: Db, id: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function setUserLocale(db: Db, id: number, locale: string): Promise<void> {
  await db.update(users).set({ locale }).where(eq(users.id, id));
}

/** Creates a session and returns the raw cookie value (only its hash is stored). */
export async function createSession(db: Db, userId: number, ttlDays = 14): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(db: Db, token: string): Promise<User | null> {
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sha256(token)));
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await deleteSession(db, token);
    return null;
  }
  return row.user;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function deleteExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

// ---------------------------------------------------------------- repos & roles

export async function listRepos(db: Db): Promise<Repo[]> {
  return db.select().from(repos).orderBy(asc(repos.fullName));
}

export async function getRepo(db: Db, fullName: string): Promise<Repo | undefined> {
  const [repo] = await db.select().from(repos).where(eq(repos.fullName, fullName));
  return repo;
}

export async function getRepoById(db: Db, id: number): Promise<Repo | undefined> {
  const [repo] = await db.select().from(repos).where(eq(repos.id, id));
  return repo;
}

export type RepoCounts = { tests: number; reviews: number; roles: number };

/** Per-repository counts for the sidebar menu, in three grouped queries instead of one per repository. */
export async function countsByRepo(db: Db, repoIds: number[]): Promise<Map<number, RepoCounts>> {
  const out = new Map<number, RepoCounts>(repoIds.map((id) => [id, { tests: 0, reviews: 0, roles: 0 }]));
  if (repoIds.length === 0) return out;
  const n = sql<number>`count(*)`.mapWith(Number);
  const [tests, revs, roles] = await Promise.all([
    db.select({ repoId: testScripts.repoId, n }).from(testScripts).where(inArray(testScripts.repoId, repoIds)).groupBy(testScripts.repoId),
    db.select({ repoId: reviews.repoId, n }).from(reviews).where(inArray(reviews.repoId, repoIds)).groupBy(reviews.repoId),
    db.select({ repoId: repoRoles.repoId, n }).from(repoRoles).where(inArray(repoRoles.repoId, repoIds)).groupBy(repoRoles.repoId),
  ]);
  for (const r of tests) out.get(r.repoId)!.tests = r.n;
  for (const r of revs) out.get(r.repoId)!.reviews = r.n;
  for (const r of roles) out.get(r.repoId)!.roles = r.n;
  return out;
}

export async function addRepo(
  db: Db,
  input: { fullName: string; isPrivate: boolean; defaultBranch: string | null; createdBy: number },
): Promise<Repo> {
  await db.insert(repos).values(input).onDuplicateKeyUpdate({ set: { isPrivate: input.isPrivate, defaultBranch: input.defaultBranch } });
  const repo = await getRepo(db, input.fullName);
  if (!repo) throw new Error("repo insert failed");
  return repo;
}

export async function updateRepoSettings(
  db: Db,
  id: number,
  input: { notes: string | null; extraAllowedHosts: string[]; dataConfirmed: boolean; defaultInstanceUrl: string | null },
): Promise<void> {
  await db.update(repos).set(input).where(eq(repos.id, id));
}

export async function updateAutomation(db: Db, id: number, automation: AutomationSettings, autoReview: AutoReviewDefaults): Promise<void> {
  await db.update(repos).set({ automation, autoReview }).where(eq(repos.id, id));
}

export async function setWebhook(db: Db, id: number, hook: { webhookId: number; secret: string; userId: number } | null): Promise<void> {
  await db
    .update(repos)
    .set(hook ? { webhookId: hook.webhookId, webhookSecretEnc: encrypt(hook.secret), automationUserId: hook.userId } : { webhookId: null, webhookSecretEnc: null })
    .where(eq(repos.id, id));
}

/** Saves the Slack webhook (null removes it) and what is posted there. */
export async function setSlack(db: Db, id: number, input: { webhookUrl?: string | null; notifications: NotificationSettings }): Promise<void> {
  const hook =
    input.webhookUrl === undefined
      ? {}
      : input.webhookUrl
        ? { slackWebhookEnc: encrypt(input.webhookUrl), slackWebhookHint: `…${input.webhookUrl.slice(-6)}` }
        : { slackWebhookEnc: null, slackWebhookHint: null };
  await db.update(repos).set({ ...hook, notifications: input.notifications }).where(eq(repos.id, id));
}

export function slackWebhookUrl(repo: Pick<Repo, "slackWebhookEnc">): string | null {
  return repo.slackWebhookEnc ? decrypt(repo.slackWebhookEnc) : null;
}

/**
 * Claims the right to send a run's notification: true exactly once per run,
 * however many workers or calls race for it.
 */
export async function claimNotification(db: Db, target: { reviewId: number } | { testRunId: number }): Promise<boolean> {
  const now = new Date();
  const [res] =
    "reviewId" in target
      ? await db.update(reviews).set({ notifiedAt: now }).where(and(eq(reviews.id, target.reviewId), sql`${reviews.notifiedAt} is null`))
      : await db.update(testRuns).set({ notifiedAt: now }).where(and(eq(testRuns.id, target.testRunId), sql`${testRuns.notifiedAt} is null`));
  return res.affectedRows === 1;
}

/** The latest finished review of a pull request before `beforeId`, with a report (what a re-review builds on). */
export async function previousReviewOf(db: Db, repoId: number, prNumber: number, beforeId?: number): Promise<ReviewListItem | undefined> {
  const [row] = await db
    .select({ review: reviews, repoFullName: repos.fullName, startedByLogin: users.login })
    .from(reviews)
    .innerJoin(repos, eq(repos.id, reviews.repoId))
    .innerJoin(users, eq(users.id, reviews.startedBy))
    .where(
      and(
        eq(reviews.repoId, repoId),
        eq(reviews.prNumber, prNumber),
        sql`${reviews.report} is not null`,
        inArray(reviews.status, ["completed", "budget_exceeded", "max_turns"]),
        beforeId ? lt(reviews.id, beforeId) : undefined,
      ),
    )
    .orderBy(desc(reviews.id))
    .limit(1);
  return row ? { ...row.review, repoFullName: row.repoFullName, startedByLogin: row.startedByLogin } : undefined;
}

export function webhookSecret(repo: Pick<Repo, "webhookSecretEnc">): string | null {
  return repo.webhookSecretEnc ? decrypt(repo.webhookSecretEnc) : null;
}

/** Sets (or with null removes) the repository's Anthropic API key. */
export async function setAnthropicKey(db: Db, repoId: number, key: string | null, userId: number): Promise<void> {
  await db
    .update(repos)
    .set(
      key
        ? { anthropicKeyEnc: encrypt(key), anthropicKeyHint: key.slice(-4), anthropicKeySetBy: userId, anthropicKeySetAt: new Date() }
        : { anthropicKeyEnc: null, anthropicKeyHint: null, anthropicKeySetBy: userId, anthropicKeySetAt: new Date() },
    )
    .where(eq(repos.id, repoId));
}

/** The repository's Anthropic API key in clear text, for the worker. Null when none is set. */
export function repoAnthropicKey(repo: Pick<Repo, "anthropicKeyEnc">): string | null {
  return repo.anthropicKeyEnc ? decrypt(repo.anthropicKeyEnc) : null;
}

export async function addLesson(db: Db, repoId: number, lesson: Lesson): Promise<void> {
  const repo = await getRepoById(db, repoId);
  if (!repo) return;
  // One lesson per finding: rating the same finding again replaces it.
  const rest = (repo.lessons ?? []).filter((l) => !(l.reviewId === lesson.reviewId && l.findingId === lesson.findingId));
  await db.update(repos).set({ lessons: [...rest, lesson] }).where(eq(repos.id, repoId));
}

export async function removeLesson(db: Db, repoId: number, match: { reviewId: number; findingId: string }): Promise<void> {
  const repo = await getRepoById(db, repoId);
  if (!repo) return;
  const lessons = (repo.lessons ?? []).filter((l) => !(l.reviewId === match.reviewId && l.findingId === match.findingId));
  await db.update(repos).set({ lessons }).where(eq(repos.id, repoId));
}

export async function removeRepo(db: Db, id: number): Promise<void> {
  await db.delete(repoRoles).where(eq(repoRoles.repoId, id));
  await db.delete(agentLearnings).where(eq(agentLearnings.repoId, id));
  await db.delete(repos).where(eq(repos.id, id));
}

/** How many learnings go into a run's prompt (newest first). */
export const LEARNINGS_IN_PROMPT = 40;

/** Stores what an agent learned about operating the app; an identical entry is not added twice. */
export async function addLearning(db: Db, input: { repoId: number; text: string; runKind: "review" | "analysis" | "test"; runRefId: number }): Promise<boolean> {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) return false;
  const [dup] = await db
    .select({ id: agentLearnings.id })
    .from(agentLearnings)
    .where(and(eq(agentLearnings.repoId, input.repoId), eq(agentLearnings.text, text)))
    .limit(1);
  if (dup) return false;
  await db.insert(agentLearnings).values({ ...input, text });
  return true;
}

export async function listLearnings(db: Db, repoId: number, limit = 200) {
  return db.select().from(agentLearnings).where(eq(agentLearnings.repoId, repoId)).orderBy(desc(agentLearnings.id)).limit(limit);
}

export async function deleteLearning(db: Db, repoId: number, id: number): Promise<void> {
  await db.delete(agentLearnings).where(and(eq(agentLearnings.id, id), eq(agentLearnings.repoId, repoId)));
}

export async function listRoles(db: Db, repoId: number) {
  return db.select().from(repoRoles).where(eq(repoRoles.repoId, repoId)).orderBy(asc(repoRoles.name));
}

export type RoleInput = {
  name: string;
  description: string | null;
  /** Omit to keep the stored value (password fields are write-only in the UI). */
  username?: string;
  password?: string;
  loginPath: string;
  successUrlContains: string | null;
  recipe: LoginStep[] | null;
};

export async function saveRole(db: Db, repoId: number, input: RoleInput): Promise<void> {
  const [existing] = await db
    .select()
    .from(repoRoles)
    .where(and(eq(repoRoles.repoId, repoId), eq(repoRoles.name, input.name)));
  const base = {
    description: input.description,
    loginPath: input.loginPath,
    successUrlContains: input.successUrlContains,
    recipe: input.recipe,
  };
  if (existing) {
    await db
      .update(repoRoles)
      .set({
        ...base,
        ...(input.username ? { usernameEnc: encrypt(input.username) } : {}),
        ...(input.password ? { passwordEnc: encrypt(input.password) } : {}),
      })
      .where(eq(repoRoles.id, existing.id));
    return;
  }
  if (!input.username || !input.password) throw new Error("Benutzername und Passwort sind für eine neue Rolle Pflicht.");
  await db.insert(repoRoles).values({
    ...base,
    repoId,
    name: input.name,
    usernameEnc: encrypt(input.username),
    passwordEnc: encrypt(input.password),
  });
}

export async function deleteRole(db: Db, repoId: number, name: string): Promise<void> {
  await db.delete(repoRoles).where(and(eq(repoRoles.repoId, repoId), eq(repoRoles.name, name)));
}

/** Stored username in clear text, for display in the settings form. */
export function roleUsername(role: { usernameEnc: string }): string {
  try {
    return decrypt(role.usernameEnc);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- reviews

export type ReviewListItem = Review & { repoFullName: string; startedByLogin: string };

export async function createReview(
  db: Db,
  input: {
    repoId: number;
    prNumber: number;
    prTitle: string | null;
    request: ReviewRequest;
    fixture: string | null;
    startedBy: number;
    trigger?: string;
    headSha?: string | null;
  },
): Promise<number> {
  const [res] = await db.insert(reviews).values({
    repoId: input.repoId,
    prNumber: input.prNumber,
    prTitle: input.prTitle,
    instanceUrl: input.request.instanceUrl,
    request: input.request,
    fixture: input.fixture,
    startedBy: input.startedBy,
    trigger: input.trigger ?? "manual",
    headSha: input.headSha ?? null,
  });
  return res.insertId;
}

export async function listReviews(db: Db, opts: { repoId?: number; repoIds?: number[]; limit?: number } = {}): Promise<ReviewListItem[]> {
  if (opts.repoIds && opts.repoIds.length === 0) return [];
  const rows = await db
    .select({ review: reviews, repoFullName: repos.fullName, startedByLogin: users.login })
    .from(reviews)
    .innerJoin(repos, eq(repos.id, reviews.repoId))
    .innerJoin(users, eq(users.id, reviews.startedBy))
    .where(and(opts.repoId ? eq(reviews.repoId, opts.repoId) : undefined, opts.repoIds ? inArray(reviews.repoId, opts.repoIds) : undefined))
    .orderBy(desc(reviews.id))
    .limit(opts.limit ?? 50);
  return rows.map((r) => ({ ...r.review, repoFullName: r.repoFullName, startedByLogin: r.startedByLogin }));
}

/** A review for a list: everything but the report, of which only what the verdict needs is extracted in MySQL. */
export type ReviewDigestItem = Omit<Review, "report"> & { repoFullName: string; startedByLogin: string; report: ReportLike | null };

const { report: _reviewReport, ...reviewColumns } = getTableColumns(reviews);
const jsonList = (v: unknown): unknown[] => {
  if (v === null || v === undefined) return [];
  const parsed = typeof v === "string" ? JSON.parse(v) : v;
  return Array.isArray(parsed) ? parsed : [];
};

/**
 * Like listReviews, without carrying the full reports (summaries, descriptions,
 * evidence) out of the database: a list only needs the verdict and the counts.
 */
export async function listReviewDigests(db: Db, opts: { repoId?: number; repoIds?: number[]; limit?: number } = {}): Promise<ReviewDigestItem[]> {
  if (opts.repoIds && opts.repoIds.length === 0) return [];
  const rows = await db
    .select({
      ...reviewColumns,
      repoFullName: repos.fullName,
      startedByLogin: users.login,
      hasReport: sql<number>`(${reviews.report} is not null)`.mapWith(Number),
      reportStatus: sql<string | null>`json_unquote(json_extract(${reviews.report}, '$.status'))`,
      strictness: sql<string | null>`json_unquote(json_extract(${reviews.report}, '$.request.strictness'))`,
      acStatuses: sql<unknown>`json_extract(${reviews.report}, '$.acceptanceCriteria[*].status')`.mapWith(jsonList),
      findingIds: sql<unknown>`json_extract(${reviews.report}, '$.findings[*].id')`.mapWith(jsonList),
      findingSeverities: sql<unknown>`json_extract(${reviews.report}, '$.findings[*].severity')`.mapWith(jsonList),
    })
    .from(reviews)
    .innerJoin(repos, eq(repos.id, reviews.repoId))
    .innerJoin(users, eq(users.id, reviews.startedBy))
    .where(and(opts.repoId ? eq(reviews.repoId, opts.repoId) : undefined, opts.repoIds ? inArray(reviews.repoId, opts.repoIds) : undefined))
    .orderBy(desc(reviews.id))
    .limit(opts.limit ?? 50);
  return rows.map(({ hasReport, reportStatus, strictness, acStatuses, findingIds, findingSeverities, ...r }) => ({
    ...r,
    report: hasReport
      ? {
          status: (reportStatus ?? "failed") as ReportLike["status"],
          request: { strictness: (strictness ?? "normal") as Strictness },
          acceptanceCriteria: (jsonList(acStatuses) as string[]).map((status) => ({ status: status as ReportLike["acceptanceCriteria"][number]["status"] })),
          findings: (jsonList(findingIds) as string[]).map((id, k) => ({ id, severity: ((jsonList(findingSeverities) as string[])[k] ?? "suggestion") as Severity })),
        }
      : null,
  }));
}

/** A review of a pull request as the findings history needs it: what the verdict needs plus the findings without their evidence. */
export type PrHistoryItem = {
  id: number;
  createdAt: Date;
  status: Review["status"];
  report: ReportLike & {
    findings: Pick<Finding, "id" | "severity" | "category" | "title" | "url" | "acceptanceCriterion" | "previous">[];
    followUp: Pick<FollowUp, "reviewId" | "rechecks"> | null;
  };
};

/**
 * The finished reviews of one pull request that have a report, oldest first (the
 * latest `limit`), like those a re-review builds on. Only findings and follow-up are
 * taken out of the report, in MySQL.
 */
export async function listPrHistory(db: Db, repoId: number, prNumber: number, limit = 30): Promise<PrHistoryItem[]> {
  const jsonValue = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? JSON.parse(v) : v);
  const rows = await db
    .select({
      id: reviews.id,
      createdAt: reviews.createdAt,
      status: reviews.status,
      reportStatus: sql<string | null>`json_unquote(json_extract(${reviews.report}, '$.status'))`,
      strictness: sql<string | null>`json_unquote(json_extract(${reviews.report}, '$.request.strictness'))`,
      acStatuses: sql<unknown>`json_extract(${reviews.report}, '$.acceptanceCriteria[*].status')`.mapWith(jsonList),
      findings: sql<unknown>`json_extract(${reviews.report}, '$.findings')`.mapWith(jsonList),
      followUp: sql<unknown>`json_extract(${reviews.report}, '$.followUp')`.mapWith(jsonValue),
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.repoId, repoId),
        eq(reviews.prNumber, prNumber),
        sql`${reviews.report} is not null`,
        // Aborted or failed runs leave partial reports; comparing with them would make everything look new again.
        inArray(reviews.status, ["completed", "budget_exceeded", "max_turns"]),
      ),
    )
    .orderBy(desc(reviews.id))
    .limit(limit);
  return rows.reverse().map((r) => {
    const fu = r.followUp as FollowUp | null;
    return {
      id: r.id,
      createdAt: r.createdAt,
      status: r.status,
      report: {
        status: (r.reportStatus ?? "failed") as ReportLike["status"],
        request: { strictness: (r.strictness ?? "normal") as Strictness },
        acceptanceCriteria: (jsonList(r.acStatuses) as string[]).map((status) => ({ status: status as ReportLike["acceptanceCriteria"][number]["status"] })),
        findings: (jsonList(r.findings) as Finding[]).map((f) => ({
          id: f.id,
          severity: f.severity,
          category: f.category,
          title: f.title,
          url: f.url,
          acceptanceCriterion: f.acceptanceCriterion,
          previous: f.previous,
        })),
        followUp: fu ? { reviewId: fu.reviewId, rechecks: fu.rechecks ?? [] } : null,
      },
    };
  });
}

/** How people rated the findings of these reviews, per review and finding id. */
export async function findingStatuses(db: Db, reviewIds: number[]): Promise<Map<number, Map<string, FindingStatus>>> {
  const out = new Map<number, Map<string, FindingStatus>>();
  if (reviewIds.length === 0) return out;
  const rows = await db
    .select({ reviewId: findings.reviewId, findingId: findings.findingId, status: findings.status })
    .from(findings)
    .where(inArray(findings.reviewId, reviewIds));
  for (const r of rows) {
    if (!out.has(r.reviewId)) out.set(r.reviewId, new Map());
    out.get(r.reviewId)!.set(r.findingId, r.status);
  }
  return out;
}

/** When each repository was last reviewed (for the repositories page). */
export async function lastReviewByRepo(db: Db, repoIds: number[]): Promise<Map<number, Date>> {
  if (repoIds.length === 0) return new Map();
  const rows = await db
    .select({ repoId: reviews.repoId, at: sql<Date | string>`max(${reviews.createdAt})` })
    .from(reviews)
    .where(inArray(reviews.repoId, repoIds))
    .groupBy(reviews.repoId);
  return new Map(rows.map((r) => [r.repoId, new Date(r.at)]));
}

export async function getReview(db: Db, id: number): Promise<ReviewListItem | undefined> {
  const [row] = await db
    .select({ review: reviews, repoFullName: repos.fullName, startedByLogin: users.login })
    .from(reviews)
    .innerJoin(repos, eq(repos.id, reviews.repoId))
    .innerJoin(users, eq(users.id, reviews.startedBy))
    .where(eq(reviews.id, id));
  return row ? { ...row.review, repoFullName: row.repoFullName, startedByLogin: row.startedByLogin } : undefined;
}

/** A queued or running review of the same PR (and commit, if given): a new event should not start another. */
export async function findActiveReview(db: Db, repoId: number, prNumber: number, headSha?: string | null): Promise<Review | undefined> {
  const [row] = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.repoId, repoId),
        eq(reviews.prNumber, prNumber),
        inArray(reviews.status, ["queued", "running"]),
        headSha ? eq(reviews.headSha, headSha) : undefined,
      ),
    )
    .limit(1);
  return row;
}

export async function requestAbort(db: Db, id: number): Promise<void> {
  // A queued review is aborted right away; a running one is stopped by the worker.
  await db.update(reviews).set({ status: "aborted", finishedAt: new Date() }).where(and(eq(reviews.id, id), eq(reviews.status, "queued")));
  await db.update(reviews).set({ abortRequested: true }).where(and(eq(reviews.id, id), eq(reviews.status, "running")));
}

export async function isAbortRequested(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ abort: reviews.abortRequested }).from(reviews).where(eq(reviews.id, id));
  return Boolean(row?.abort);
}

/**
 * Moves the oldest queued job to running. Works without row locks (MySQL 5.7
 * has no SKIP LOCKED): the conditional update only succeeds for one worker,
 * a worker that loses the race simply tries the next job.
 */
async function claimNext<T extends { id: number }>(
  db: Db,
  table: typeof reviews | typeof analyses | typeof testRuns,
  oldestQueued: () => Promise<T | undefined>,
): Promise<(T & { status: "running"; startedAt: Date }) | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = await oldestQueued();
    if (!next) return null;
    const startedAt = new Date();
    const [result] = await db
      .update(table)
      .set({ status: "running", startedAt })
      .where(and(eq(table.id, next.id), eq(table.status, "queued")));
    if (result.affectedRows === 1) return { ...next, status: "running" as const, startedAt };
  }
  return null;
}

/** Atomically moves the oldest queued review to running. Safe with several workers. */
export async function claimNextReview(db: Db): Promise<Review | null> {
  return claimNext(db, reviews, async () => {
    const [next] = await db.select().from(reviews).where(eq(reviews.status, "queued")).orderBy(asc(reviews.id)).limit(1);
    return next;
  });
}

export async function setReviewCommentUrl(db: Db, id: number, commentUrl: string): Promise<void> {
  await db.update(reviews).set({ commentUrl }).where(eq(reviews.id, id));
}

export async function setReviewRunId(db: Db, id: number, runId: string): Promise<void> {
  await db.update(reviews).set({ runId }).where(eq(reviews.id, id));
}

export async function finishReview(
  db: Db,
  id: number,
  input: { status: ReviewStatus; report: ReviewReport | null; verdict: string | null; error: string | null },
): Promise<void> {
  await db
    .update(reviews)
    .set({
      status: input.status,
      report: input.report,
      verdict: input.verdict,
      costUsd: input.report ? input.report.cost.usd.toFixed(4) : null,
      error: input.error,
      finishedAt: new Date(),
      ...(input.report ? { prTitle: input.report.pr.title } : {}),
      ...(input.report?.commentUrl ? { commentUrl: input.report.commentUrl } : {}),
      ...(input.report?.pr.headSha ? { headSha: input.report.pr.headSha } : {}),
    })
    .where(eq(reviews.id, id));
  if (input.report && input.report.findings.length > 0) {
    await db
      .insert(findings)
      .values(input.report.findings.map((f) => ({ reviewId: id, findingId: f.id, data: f })))
      .onDuplicateKeyUpdate({ set: { data: sql`values(${findings.data})` } });
  }
}

/** Reviews and analyses left in "running" by a crashed worker. */
export async function failStaleRuns(db: Db): Promise<number> {
  const set = { status: "failed" as const, error: "Worker wurde während des Runs beendet.", finishedAt: new Date() };
  const [a] = await db.update(reviews).set(set).where(eq(reviews.status, "running"));
  const [b] = await db.update(analyses).set(set).where(eq(analyses.status, "running"));
  const [c] = await db.update(testRuns).set(set).where(eq(testRuns.status, "running"));
  // Nobody is waiting for an answer any more.
  await db.update(humanRequests).set({ status: "cancelled", resolvedAt: new Date() }).where(eq(humanRequests.status, "open"));
  return a.affectedRows + b.affectedRows + c.affectedRows;
}

// ---------------------------------------------------------------- live events

/** Which run a live log line belongs to. */
export type EventTarget = { reviewId: number } | { analysisId: number } | { testRunId: number };

const eventFilter = (t: EventTarget) =>
  "reviewId" in t ? eq(runEvents.reviewId, t.reviewId) : "analysisId" in t ? eq(runEvents.analysisId, t.analysisId) : eq(runEvents.testRunId, t.testRunId);

export async function appendEvent(db: Db, target: EventTarget, seq: number, line: string): Promise<void> {
  await db.insert(runEvents).values({ ...target, seq, line });
}

/** How many log lines a run has, so a page can offer the log without loading it. */
export async function countEvents(db: Db, target: EventTarget): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(runEvents).where(eventFilter(target));
  return row?.n ?? 0;
}

export async function eventsSince(db: Db, target: EventTarget, afterSeq: number, limit = 500) {
  return db
    .select({ seq: runEvents.seq, line: runEvents.line, createdAt: runEvents.createdAt })
    .from(runEvents)
    .where(and(eventFilter(target), gt(runEvents.seq, afterSeq)))
    .orderBy(asc(runEvents.seq))
    .limit(limit);
}

// ---------------------------------------------------------------- analyses & knowledge

export type AnalysisListItem = Analysis & { repoFullName: string; startedByLogin: string; docCount: number };

export async function createAnalysis(
  db: Db,
  input: { repoId: number; request: AnalysisRequest; fixture: string | null; startedBy: number },
): Promise<number> {
  const [res] = await db.insert(analyses).values({
    repoId: input.repoId,
    request: input.request,
    instanceUrl: input.request.instanceUrl,
    fixture: input.fixture,
    startedBy: input.startedBy,
  });
  return res.insertId;
}

const analysisSelect = {
  analysis: analyses,
  repoFullName: repos.fullName,
  startedByLogin: users.login,
  docCount: sql<number>`(select count(*) from ${knowledgeDocs} where ${knowledgeDocs.analysisId} = ${analyses.id})`.mapWith(Number),
};

export async function listAnalyses(db: Db, opts: { repoId?: number; repoIds?: number[]; limit?: number; activeOnly?: boolean } = {}): Promise<AnalysisListItem[]> {
  if (opts.repoIds && opts.repoIds.length === 0) return [];
  const rows = await db
    .select(analysisSelect)
    .from(analyses)
    .innerJoin(repos, eq(repos.id, analyses.repoId))
    .innerJoin(users, eq(users.id, analyses.startedBy))
    .where(
      and(
        opts.repoId ? eq(analyses.repoId, opts.repoId) : undefined,
        opts.repoIds ? inArray(analyses.repoId, opts.repoIds) : undefined,
        opts.activeOnly ? inArray(analyses.status, ["queued", "running"]) : undefined,
      ),
    )
    .orderBy(desc(analyses.id))
    .limit(opts.limit ?? 50);
  return rows.map((r) => ({ ...r.analysis, repoFullName: r.repoFullName, startedByLogin: r.startedByLogin, docCount: r.docCount }));
}

export async function getAnalysis(db: Db, id: number): Promise<AnalysisListItem | undefined> {
  const [r] = await db
    .select(analysisSelect)
    .from(analyses)
    .innerJoin(repos, eq(repos.id, analyses.repoId))
    .innerJoin(users, eq(users.id, analyses.startedBy))
    .where(eq(analyses.id, id));
  return r ? { ...r.analysis, repoFullName: r.repoFullName, startedByLogin: r.startedByLogin, docCount: r.docCount } : undefined;
}

export async function claimNextAnalysis(db: Db): Promise<Analysis | null> {
  return claimNext(db, analyses, async () => {
    const [next] = await db.select().from(analyses).where(eq(analyses.status, "queued")).orderBy(asc(analyses.id)).limit(1);
    return next;
  });
}

export async function setAnalysisRunId(db: Db, id: number, runId: string): Promise<void> {
  await db.update(analyses).set({ runId }).where(eq(analyses.id, id));
}

export async function requestAnalysisAbort(db: Db, id: number): Promise<void> {
  await db.update(analyses).set({ status: "aborted", finishedAt: new Date() }).where(and(eq(analyses.id, id), eq(analyses.status, "queued")));
  await db.update(analyses).set({ abortRequested: true }).where(and(eq(analyses.id, id), eq(analyses.status, "running")));
}

export async function isAnalysisAbortRequested(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ abort: analyses.abortRequested }).from(analyses).where(eq(analyses.id, id));
  return Boolean(row?.abort);
}

export async function finishAnalysis(
  db: Db,
  id: number,
  input: { status: ReviewStatus; report: AnalysisReport | null; error: string | null },
): Promise<void> {
  const analysis = await db.select({ repoId: analyses.repoId }).from(analyses).where(eq(analyses.id, id));
  const repoId = analysis[0]?.repoId;
  const { docs, ...report } = input.report ?? { docs: [] as KnowledgeDoc[] };
  await db
    .update(analyses)
    .set({
      status: input.status,
      report: input.report ? (report as Omit<AnalysisReport, "docs">) : null,
      branch: input.report?.branch ?? null,
      commitSha: input.report?.commitSha ?? null,
      costUsd: input.report ? input.report.cost.usd.toFixed(4) : null,
      error: input.error,
      finishedAt: new Date(),
    })
    .where(eq(analyses.id, id));
  if (repoId && docs.length > 0) {
    await db.insert(knowledgeDocs).values(docs.map((d) => ({ analysisId: id, repoId, name: d.name, content: d.content })));
  }
}

export type KnowledgeWithSource = KnowledgeBase & { analysisId: number; status: ReviewStatus; startedByLogin: string };

/** The repo's current knowledge base: documents of the newest analysis that produced any. */
export async function latestKnowledge(db: Db, repoId: number): Promise<KnowledgeWithSource | null> {
  const [latest] = await db
    .select({ analysis: analyses, startedByLogin: users.login })
    .from(analyses)
    .innerJoin(users, eq(users.id, analyses.startedBy))
    .where(and(eq(analyses.repoId, repoId), sql`exists (select 1 from ${knowledgeDocs} where ${knowledgeDocs.analysisId} = ${analyses.id})`))
    .orderBy(desc(analyses.id))
    .limit(1);
  if (!latest) return null;
  const docs = await knowledgeDocsOf(db, latest.analysis.id);
  return {
    analysisId: latest.analysis.id,
    status: latest.analysis.status,
    startedByLogin: latest.startedByLogin,
    commitSha: latest.analysis.commitSha ?? "unknown",
    branch: latest.analysis.branch ?? "",
    analyzedAt: (latest.analysis.finishedAt ?? latest.analysis.createdAt).toISOString(),
    docs,
  };
}

export async function knowledgeDocsOf(db: Db, analysisId: number): Promise<KnowledgeDoc[]> {
  const order = ["overview", "modules", "routes", "app-map", "notes"];
  const rows = await db.select({ name: knowledgeDocs.name, content: knowledgeDocs.content }).from(knowledgeDocs).where(eq(knowledgeDocs.analysisId, analysisId));
  return rows.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

// ---------------------------------------------------------------- test scripts & runs

export type TestScriptInput = {
  name: string;
  description: string;
  expectation: string;
  roles: string[];
  runInReviews: boolean;
  allowedHosts: string[];
  allowAnyHost: boolean;
  viewports: ("desktop" | "mobile")[];
};

export async function createTestScript(db: Db, repoId: number, input: TestScriptInput, createdBy: number): Promise<number> {
  const [res] = await db.insert(testScripts).values({ ...input, repoId, createdBy });
  return res.insertId;
}

export async function updateTestScript(db: Db, id: number, input: TestScriptInput & { determinism: Determinism | null }): Promise<void> {
  await db.update(testScripts).set({ ...input, updatedAt: new Date() }).where(eq(testScripts.id, id));
}

/** Stores a new recording (or healed version) of the steps. */
export async function saveTestSteps(db: Db, id: number, steps: TestStep[], determinism?: Determinism): Promise<void> {
  await db
    .update(testScripts)
    .set({
      steps,
      stepsVersion: sql`${testScripts.stepsVersion} + 1`,
      stepsUpdatedAt: new Date(),
      ...(determinism ? { determinism } : {}),
    })
    .where(eq(testScripts.id, id));
}

/** Clears the recording, so the next run records from scratch. */
export async function resetTestSteps(db: Db, id: number): Promise<void> {
  await db.update(testScripts).set({ steps: null, stepsUpdatedAt: new Date() }).where(eq(testScripts.id, id));
}

export async function deleteTestScript(db: Db, id: number): Promise<void> {
  await db.delete(runEvents).where(inArray(runEvents.testRunId, db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.scriptId, id))));
  await db.delete(testRuns).where(eq(testRuns.scriptId, id));
  await db.delete(testScripts).where(eq(testScripts.id, id));
}

export type TestScriptListItem = TestScriptRow & {
  repoFullName: string;
  lastOutcome: string | null;
  lastStatus: string | null;
  lastRunAt: Date | null;
  lastHealed: boolean;
};

export async function listTestScripts(db: Db, repoId: number): Promise<TestScriptListItem[]> {
  const rows = await db
    .select({ script: testScripts, repoFullName: repos.fullName })
    .from(testScripts)
    .innerJoin(repos, eq(repos.id, testScripts.repoId))
    .where(eq(testScripts.repoId, repoId))
    .orderBy(asc(testScripts.name));
  const last = await lastRunsByScript(db, rows.map((r) => r.script.id));
  return rows.map((r) => {
    const l = last.get(r.script.id);
    return { ...r.script, repoFullName: r.repoFullName, lastOutcome: l?.outcome ?? null, lastStatus: l?.status ?? null, lastRunAt: l?.createdAt ?? null, lastHealed: l?.healed ?? false };
  });
}

type LastRun = Pick<TestRun, "scriptId" | "status" | "outcome" | "healed" | "createdAt">;

/** The latest run of each script, without the reports: a repository's full run history would not fit a page load. */
async function lastRunsByScript(db: Db, scriptIds: number[]): Promise<Map<number, LastRun>> {
  const out = new Map<number, LastRun>();
  if (scriptIds.length === 0) return out;
  const latest = db
    .select({ id: sql<number>`max(${testRuns.id})`.as("id") })
    .from(testRuns)
    .where(inArray(testRuns.scriptId, scriptIds))
    .groupBy(testRuns.scriptId);
  const rows = await db
    .select({ scriptId: testRuns.scriptId, status: testRuns.status, outcome: testRuns.outcome, healed: testRuns.healed, createdAt: testRuns.createdAt })
    .from(testRuns)
    .where(inArray(testRuns.id, latest));
  for (const r of rows) out.set(r.scriptId, r);
  return out;
}

export async function getTestScript(db: Db, id: number): Promise<(TestScriptRow & { repoFullName: string }) | undefined> {
  const [r] = await db.select({ script: testScripts, repoFullName: repos.fullName }).from(testScripts).innerJoin(repos, eq(repos.id, testScripts.repoId)).where(eq(testScripts.id, id));
  return r ? { ...r.script, repoFullName: r.repoFullName } : undefined;
}

export function toTestScript(row: TestScriptRow): TestScript {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    expectation: row.expectation,
    roles: row.roles ?? [],
    determinism: row.determinism ?? null,
    steps: row.steps ?? null,
    allowedHosts: row.allowedHosts ?? [],
    allowAnyHost: row.allowAnyHost,
    viewports: row.viewports?.length ? row.viewports : ["desktop"],
  };
}

export async function createTestRuns(
  db: Db,
  runs: { scriptId: number; repoId: number; request: TestRunRequest; reviewId?: number | null; batchId?: string | null; startedBy: number }[],
): Promise<number[]> {
  if (runs.length === 0) return [];
  // One statement: InnoDB hands out its ids in one consecutive block.
  const [res] = await db.insert(testRuns).values(
    runs.map((r) => ({
      scriptId: r.scriptId,
      repoId: r.repoId,
      reviewId: r.reviewId ?? null,
      batchId: r.batchId ?? null,
      request: r.request,
      instanceUrl: r.request.instanceUrl,
      startedBy: r.startedBy,
    })),
  );
  return runs.map((_, k) => res.insertId + k);
}

export async function createTestRun(
  db: Db,
  run: { scriptId: number; repoId: number; request: TestRunRequest; startedBy: number },
): Promise<number> {
  const [res] = await db.insert(testRuns).values({ ...run, instanceUrl: run.request.instanceUrl });
  return res.insertId;
}

export type TestRunListItem = TestRun & { scriptName: string; repoFullName: string; startedByLogin: string };

const testRunSelect = { run: testRuns, scriptName: testScripts.name, repoFullName: repos.fullName, startedByLogin: users.login };

export async function listTestRuns(
  db: Db,
  filter: { scriptId?: number; reviewId?: number; batchId?: string; repoId?: number; activeOnly?: boolean },
  limit = 50,
): Promise<TestRunListItem[]> {
  const rows = await db
    .select(testRunSelect)
    .from(testRuns)
    .innerJoin(testScripts, eq(testScripts.id, testRuns.scriptId))
    .innerJoin(repos, eq(repos.id, testRuns.repoId))
    .innerJoin(users, eq(users.id, testRuns.startedBy))
    .where(
      and(
        filter.scriptId ? eq(testRuns.scriptId, filter.scriptId) : undefined,
        filter.reviewId ? eq(testRuns.reviewId, filter.reviewId) : undefined,
        filter.batchId ? eq(testRuns.batchId, filter.batchId) : undefined,
        filter.repoId ? eq(testRuns.repoId, filter.repoId) : undefined,
        filter.activeOnly ? inArray(testRuns.status, ["queued", "running"]) : undefined,
      ),
    )
    .orderBy(desc(testRuns.id))
    .limit(limit);
  return rows.map((r) => ({ ...r.run, scriptName: r.scriptName, repoFullName: r.repoFullName, startedByLogin: r.startedByLogin }));
}

export async function getTestRun(db: Db, id: number): Promise<TestRunListItem | undefined> {
  const [r] = await db
    .select(testRunSelect)
    .from(testRuns)
    .innerJoin(testScripts, eq(testScripts.id, testRuns.scriptId))
    .innerJoin(repos, eq(repos.id, testRuns.repoId))
    .innerJoin(users, eq(users.id, testRuns.startedBy))
    .where(eq(testRuns.id, id));
  return r ? { ...r.run, scriptName: r.scriptName, repoFullName: r.repoFullName, startedByLogin: r.startedByLogin } : undefined;
}

/** Regression test results per review, for verdicts in lists. */
export async function testResultsByReview(db: Db, reviewIds: number[]): Promise<Map<number, { name: string; outcome: "passed" | "failed" | "inconclusive" | null; status: string }[]>> {
  const out = new Map<number, { name: string; outcome: "passed" | "failed" | "inconclusive" | null; status: string }[]>();
  if (reviewIds.length === 0) return out;
  const rows = await db
    .select({ reviewId: testRuns.reviewId, name: testScripts.name, outcome: testRuns.outcome, status: testRuns.status })
    .from(testRuns)
    .innerJoin(testScripts, eq(testScripts.id, testRuns.scriptId))
    .where(inArray(testRuns.reviewId, reviewIds));
  for (const r of rows) {
    if (r.reviewId === null) continue;
    out.set(r.reviewId, [...(out.get(r.reviewId) ?? []), { name: r.name, outcome: r.outcome, status: r.status }]);
  }
  return out;
}

export async function claimNextTestRun(db: Db): Promise<TestRun | null> {
  return claimNext(db, testRuns, async () => {
    const [next] = await db.select().from(testRuns).where(eq(testRuns.status, "queued")).orderBy(asc(testRuns.id)).limit(1);
    return next;
  });
}

export async function setTestRunStarted(db: Db, id: number, runId: string, stepsVersion: number): Promise<void> {
  await db.update(testRuns).set({ runId, stepsVersion }).where(eq(testRuns.id, id));
}

export async function finishTestRun(db: Db, id: number, input: { status: ReviewStatus; report: TestRunReport | null; error: string | null }): Promise<void> {
  await db
    .update(testRuns)
    .set({
      status: input.status,
      report: input.report,
      mode: input.report?.mode ?? null,
      outcome: input.report?.outcome ?? null,
      healed: input.report?.healedAt !== undefined && input.report !== null,
      costUsd: input.report ? input.report.cost.usd.toFixed(4) : null,
      error: input.error,
      finishedAt: new Date(),
    })
    .where(eq(testRuns.id, id));
}

export async function requestTestRunAbort(db: Db, id: number): Promise<void> {
  await db.update(testRuns).set({ status: "aborted", finishedAt: new Date() }).where(and(eq(testRuns.id, id), eq(testRuns.status, "queued")));
  await db.update(testRuns).set({ abortRequested: true }).where(and(eq(testRuns.id, id), eq(testRuns.status, "running")));
}

export async function isTestRunAbortRequested(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ abort: testRuns.abortRequested }).from(testRuns).where(eq(testRuns.id, id));
  return Boolean(row?.abort);
}

// ---------------------------------------------------------------- human takeover

export async function createHumanRequest(
  db: Db,
  input: { runKind: RunKind; runRefId: number; repoId: number; reason: string; kind?: "takeover" | "question"; context?: string | null; options?: string[] | null },
): Promise<number> {
  const [res] = await db.insert(humanRequests).values({ ...input, reason: input.reason.slice(0, 500), kind: input.kind ?? "takeover" });
  return res.insertId;
}

/** A person answers a question of the agent; the run continues with the answer. */
export async function answerHumanRequest(db: Db, id: number, answer: string, userId: number): Promise<void> {
  await db
    .update(humanRequests)
    .set({ status: "resolved", answer: answer.slice(0, 4000), resolvedBy: userId, resolvedAt: new Date() })
    .where(and(eq(humanRequests.id, id), eq(humanRequests.status, "open")));
}

export async function getHumanRequest(db: Db, id: number): Promise<HumanRequest | undefined> {
  const [row] = await db.select().from(humanRequests).where(eq(humanRequests.id, id));
  return row;
}

export async function openHumanRequest(db: Db, runKind: RunKind, runRefId: number): Promise<HumanRequest | undefined> {
  const [row] = await db
    .select()
    .from(humanRequests)
    .where(and(eq(humanRequests.runKind, runKind), eq(humanRequests.runRefId, runRefId), eq(humanRequests.status, "open")))
    .orderBy(desc(humanRequests.id))
    .limit(1);
  return row;
}

export type OpenHumanRequest = HumanRequest & { repoFullName: string };

export async function listOpenHumanRequests(db: Db): Promise<OpenHumanRequest[]> {
  const rows = await db
    .select({ req: humanRequests, repoFullName: repos.fullName })
    .from(humanRequests)
    .innerJoin(repos, eq(repos.id, humanRequests.repoId))
    .where(eq(humanRequests.status, "open"))
    .orderBy(asc(humanRequests.id));
  return rows.map((r) => ({ ...r.req, repoFullName: r.repoFullName }));
}

export async function closeHumanRequest(db: Db, id: number, status: "resolved" | "cancelled" | "timeout", userId: number | null): Promise<void> {
  await db
    .update(humanRequests)
    .set({ status, resolvedBy: userId, resolvedAt: new Date() })
    .where(and(eq(humanRequests.id, id), eq(humanRequests.status, "open")));
}

export async function addHumanInput(db: Db, requestId: number, input: HumanInputPayload, userId: number): Promise<void> {
  await db.insert(humanInputs).values({ requestId, input, userId });
}

export async function humanInputsSince(db: Db, requestId: number, afterId: number) {
  return db
    .select({ id: humanInputs.id, input: humanInputs.input })
    .from(humanInputs)
    .where(and(eq(humanInputs.requestId, requestId), gt(humanInputs.id, afterId)))
    .orderBy(asc(humanInputs.id));
}

// ---------------------------------------------------------------- findings

export async function listFindings(db: Db, reviewId: number) {
  const noteAuthor = alias(users, "note_author");
  return db
    .select({ finding: findings, ratedByLogin: users.login, noteByLogin: noteAuthor.login })
    .from(findings)
    .leftJoin(users, eq(users.id, findings.ratedBy))
    .leftJoin(noteAuthor, eq(noteAuthor.id, findings.noteBy))
    .where(eq(findings.reviewId, reviewId))
    .orderBy(asc(findings.id));
}

export async function rateFinding(
  db: Db,
  reviewId: number,
  findingId: string,
  input: { status: FindingStatus; comment: string | null; userId: number },
): Promise<void> {
  await db
    .update(findings)
    .set({ status: input.status, comment: input.comment, ratedBy: input.userId, ratedAt: new Date() })
    .where(and(eq(findings.reviewId, reviewId), eq(findings.findingId, findingId)));
}

/** The comment for the developers on a finding; empty removes it. Independent of the rating. */
export async function setFindingNote(db: Db, reviewId: number, findingId: string, input: { note: string | null; userId: number }): Promise<void> {
  await db
    .update(findings)
    .set({ note: input.note, noteBy: input.note ? input.userId : null, noteAt: input.note ? new Date() : null })
    .where(and(eq(findings.reviewId, reviewId), eq(findings.findingId, findingId)));
}

/** Remembers the GitHub issue created from a finding (only rated findings can become one, so the row exists). */
export async function setFindingIssue(db: Db, reviewId: number, findingId: string, issueUrl: string): Promise<void> {
  await db.update(findings).set({ issueUrl }).where(and(eq(findings.reviewId, reviewId), eq(findings.findingId, findingId)));
}

export async function dismissedFindingIds(db: Db, reviewIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (reviewIds.length === 0) return out;
  const rows = await db
    .select({ reviewId: findings.reviewId, findingId: findings.findingId })
    .from(findings)
    .where(and(inArray(findings.reviewId, reviewIds), eq(findings.status, "dismissed")));
  for (const r of rows) out.set(r.reviewId, [...(out.get(r.reviewId) ?? []), r.findingId]);
  return out;
}

// ---------------------------------------------------------------- costs

export type CostRow = { repo: string; month: string; kind: "review" | "analysis" | "test"; runs: number; usd: number };

/**
 * Model costs per repository, month and kind of run, as reported by the Agent SDK
 * (list-price estimates, not an invoice). Runs without a reported cost count as 0.
 */
export async function costSummary(db: Db, since: Date): Promise<CostRow[]> {
  const [rows] = (await db.execute(sql`
    SELECT r.full_name AS repo, DATE_FORMAT(x.created_at, '%Y-%m') AS month, x.kind AS kind,
           COUNT(*) AS runs, COALESCE(SUM(CAST(x.cost_usd AS DECIMAL(14,4))), 0) AS usd
    FROM (
      SELECT repo_id, created_at, cost_usd, 'review' AS kind FROM ${reviews}
      UNION ALL SELECT repo_id, created_at, cost_usd, 'analysis' AS kind FROM ${analyses}
      UNION ALL SELECT repo_id, created_at, cost_usd, 'test' AS kind FROM ${testRuns}
    ) x
    JOIN ${repos} r ON r.id = x.repo_id
    WHERE x.created_at >= ${since}
    GROUP BY r.full_name, month, x.kind
    ORDER BY month DESC, r.full_name
  `)) as unknown as [{ repo: string; month: string; kind: CostRow["kind"]; runs: number | string; usd: number | string }[]];
  return rows.map((r) => ({ repo: r.repo, month: r.month, kind: r.kind, runs: Number(r.runs), usd: Number(r.usd) }));
}

// ---------------------------------------------------------------- access

export async function cachedAccess(db: Db, userId: number): Promise<Map<number, { level: AccessLevel; checkedAt: Date }>> {
  const rows = await db.select().from(repoAccess).where(eq(repoAccess.userId, userId));
  return new Map(rows.map((r) => [r.repoId, { level: r.level, checkedAt: r.checkedAt }]));
}

export async function storeAccess(db: Db, userId: number, repoId: number, level: AccessLevel): Promise<void> {
  const checkedAt = new Date();
  await db.insert(repoAccess).values({ userId, repoId, level, checkedAt }).onDuplicateKeyUpdate({ set: { level, checkedAt } });
}

/** Forget cached permissions (on login), so they are fetched fresh. */
export async function clearAccess(db: Db, userId: number): Promise<void> {
  await db.delete(repoAccess).where(eq(repoAccess.userId, userId));
}

/** Which repository a run directory belongs to (for serving its files). */
export async function repoIdOfRun(db: Db, runId: string): Promise<number | null> {
  for (const table of [reviews, analyses, testRuns] as const) {
    const [row] = await db.select({ repoId: table.repoId }).from(table).where(eq(table.runId, runId)).limit(1);
    if (row) return row.repoId;
  }
  return null;
}

// ---------------------------------------------------------------- run artifacts (screenshots)

export async function saveArtifact(db: Db, a: { runId: string; path: string; contentType: string; data: Buffer }): Promise<void> {
  await db
    .insert(runArtifacts)
    .values({ ...a, size: a.data.length })
    .onDuplicateKeyUpdate({ set: { data: a.data, size: a.data.length, contentType: a.contentType } });
}

export async function getArtifact(db: Db, runId: string, path: string) {
  const [row] = await db
    .select({ data: runArtifacts.data, contentType: runArtifacts.contentType })
    .from(runArtifacts)
    .where(and(eq(runArtifacts.runId, runId), eq(runArtifacts.path, path)));
  return row;
}

/** Which of a run's files are still stored (to tell expired screenshots from present ones). */
export async function artifactPaths(db: Db, runId: string): Promise<Set<string>> {
  const rows = await db.select({ path: runArtifacts.path }).from(runArtifacts).where(eq(runArtifacts.runId, runId));
  return new Set(rows.map((r) => r.path));
}

export async function deleteArtifactsBefore(db: Db, before: Date): Promise<number> {
  const [res] = await db.delete(runArtifacts).where(lt(runArtifacts.createdAt, before));
  return res.affectedRows;
}
