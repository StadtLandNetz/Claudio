import { bigint, boolean, datetime, index, int, json, mediumtext, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import type {
  AnalysisReport,
  AnalysisRequest,
  Finding,
  KnowledgeDocName,
  LoginStep,
  ReviewReport,
  ReviewRequest,
  TestRunReport,
  TestRunRequest,
  TestStep,
} from "@claudio/core";

const id = () => bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey();
const ref = (name: string) => bigint(name, { mode: "number", unsigned: true });
const createdAt = () => datetime("created_at", { mode: "date" }).notNull().$defaultFn(() => new Date());

export const users = mysqlTable("users", {
  id: id(),
  githubId: bigint("github_id", { mode: "number", unsigned: true }).notNull().unique(),
  login: varchar("login", { length: 100 }).notNull(),
  name: varchar("name", { length: 200 }),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  /** AES-GCM encrypted OAuth access token. */
  accessTokenEnc: text("access_token_enc").notNull(),
  createdAt: createdAt(),
  lastLoginAt: datetime("last_login_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

export const sessions = mysqlTable(
  "sessions",
  {
    /** SHA-256 of the cookie value, so a leaked table does not hand out sessions. */
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: ref("user_id").notNull(),
    expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const repos = mysqlTable("repos", {
  id: id(),
  /** owner/name as on GitHub. */
  fullName: varchar("full_name", { length: 200 }).notNull().unique(),
  isPrivate: boolean("is_private").notNull().default(false),
  defaultBranch: varchar("default_branch", { length: 200 }),
  notes: text("notes"),
  extraAllowedHosts: json("extra_allowed_hosts").$type<string[]>().notNull().$defaultFn(() => []),
  /** Confirmation that review instances only hold synthetic data (screenshots go to Anthropic). */
  dataConfirmed: boolean("data_confirmed").notNull().default(false),
  defaultInstanceUrl: varchar("default_instance_url", { length: 500 }),
  createdBy: ref("created_by").notNull(),
  createdAt: createdAt(),
});

export const repoRoles = mysqlTable(
  "repo_roles",
  {
    id: id(),
    repoId: ref("repo_id").notNull(),
    name: varchar("name", { length: 60 }).notNull(),
    description: varchar("description", { length: 300 }),
    usernameEnc: text("username_enc").notNull(),
    passwordEnc: text("password_enc").notNull(),
    loginPath: varchar("login_path", { length: 300 }).notNull().default("/login"),
    successUrlContains: varchar("success_url_contains", { length: 300 }),
    recipe: json("recipe").$type<LoginStep[] | null>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("repo_roles_repo_name_idx").on(t.repoId, t.name)],
);

export const REVIEW_STATUSES = ["queued", "running", "completed", "budget_exceeded", "max_turns", "failed", "aborted"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const reviews = mysqlTable(
  "reviews",
  {
    id: id(),
    repoId: ref("repo_id").notNull(),
    prNumber: int("pr_number").notNull(),
    prTitle: varchar("pr_title", { length: 500 }),
    instanceUrl: varchar("instance_url", { length: 500 }).notNull(),
    request: json("request").$type<ReviewRequest>().notNull(),
    /** Use the demo fixture instead of GitHub (only honoured with CLAUDIO_DEV_FIXTURES=1). */
    fixture: varchar("fixture", { length: 60 }),
    status: mysqlEnum("status", REVIEW_STATUSES).notNull().default("queued"),
    runId: varchar("run_id", { length: 120 }),
    report: json("report").$type<ReviewReport>(),
    verdict: varchar("verdict", { length: 30 }),
    costUsd: varchar("cost_usd", { length: 20 }),
    error: text("error"),
    /** TL;DR comment on the pull request (posted by the run or later from the UI). */
    commentUrl: varchar("comment_url", { length: 500 }),
    abortRequested: boolean("abort_requested").notNull().default(false),
    startedBy: ref("started_by").notNull(),
    createdAt: createdAt(),
    startedAt: datetime("started_at", { mode: "date" }),
    finishedAt: datetime("finished_at", { mode: "date" }),
  },
  (t) => [index("reviews_repo_idx").on(t.repoId), index("reviews_status_idx").on(t.status)],
);

export const analyses = mysqlTable(
  "analyses",
  {
    id: id(),
    repoId: ref("repo_id").notNull(),
    request: json("request").$type<AnalysisRequest>().notNull(),
    instanceUrl: varchar("instance_url", { length: 500 }).notNull(),
    /** Use the demo checkout instead of cloning (only honoured with CLAUDIO_DEV_FIXTURES=1). */
    fixture: varchar("fixture", { length: 60 }),
    status: mysqlEnum("status", REVIEW_STATUSES).notNull().default("queued"),
    runId: varchar("run_id", { length: 120 }),
    branch: varchar("branch", { length: 200 }),
    commitSha: varchar("commit_sha", { length: 64 }),
    /** Report without the documents (those live in knowledge_docs). */
    report: json("report").$type<Omit<AnalysisReport, "docs">>(),
    costUsd: varchar("cost_usd", { length: 20 }),
    error: text("error"),
    abortRequested: boolean("abort_requested").notNull().default(false),
    startedBy: ref("started_by").notNull(),
    createdAt: createdAt(),
    startedAt: datetime("started_at", { mode: "date" }),
    finishedAt: datetime("finished_at", { mode: "date" }),
  },
  (t) => [index("analyses_repo_idx").on(t.repoId), index("analyses_status_idx").on(t.status)],
);

/** Knowledge documents written by an analysis. The latest analysis with documents is the repo's knowledge base. */
export const knowledgeDocs = mysqlTable(
  "knowledge_docs",
  {
    id: id(),
    analysisId: ref("analysis_id").notNull(),
    repoId: ref("repo_id").notNull(),
    name: varchar("name", { length: 40 }).$type<KnowledgeDocName>().notNull(),
    content: mediumtext("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("knowledge_docs_analysis_name_idx").on(t.analysisId, t.name), index("knowledge_docs_repo_idx").on(t.repoId)],
);

export const DETERMINISM = ["deterministic", "semi", "explorative"] as const;

/** A test workflow: plain-language flow and expectation, plus the recorded steps once it has run. */
export const testScripts = mysqlTable(
  "test_scripts",
  {
    id: id(),
    repoId: ref("repo_id").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description").notNull(),
    expectation: text("expectation").notNull(),
    roles: json("roles").$type<string[]>().notNull().$defaultFn(() => []),
    /** Null until the first recording proposes one. */
    determinism: mysqlEnum("determinism", DETERMINISM),
    steps: json("steps").$type<TestStep[] | null>(),
    stepsVersion: int("steps_version").notNull().default(0),
    stepsUpdatedAt: datetime("steps_updated_at", { mode: "date" }),
    /** Run as a regression test with every PR review of the repo. */
    runInReviews: boolean("run_in_reviews").notNull().default(false),
    createdBy: ref("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: datetime("updated_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("test_scripts_repo_idx").on(t.repoId)],
);

export const TEST_OUTCOMES = ["passed", "failed", "inconclusive"] as const;

export const testRuns = mysqlTable(
  "test_runs",
  {
    id: id(),
    scriptId: ref("script_id").notNull(),
    repoId: ref("repo_id").notNull(),
    /** Set when the test ran as part of a PR review. */
    reviewId: ref("review_id"),
    /** Groups the runs of one suite start. */
    batchId: varchar("batch_id", { length: 40 }),
    request: json("request").$type<TestRunRequest>().notNull(),
    instanceUrl: varchar("instance_url", { length: 500 }).notNull(),
    status: mysqlEnum("status", REVIEW_STATUSES).notNull().default("queued"),
    runId: varchar("run_id", { length: 120 }),
    mode: varchar("mode", { length: 20 }),
    outcome: mysqlEnum("outcome", TEST_OUTCOMES),
    healed: boolean("healed").notNull().default(false),
    /** Steps version that was replayed (0 = recording). */
    stepsVersion: int("steps_version"),
    report: json("report").$type<TestRunReport>(),
    costUsd: varchar("cost_usd", { length: 20 }),
    error: text("error"),
    abortRequested: boolean("abort_requested").notNull().default(false),
    startedBy: ref("started_by").notNull(),
    createdAt: createdAt(),
    startedAt: datetime("started_at", { mode: "date" }),
    finishedAt: datetime("finished_at", { mode: "date" }),
  },
  (t) => [
    index("test_runs_script_idx").on(t.scriptId),
    index("test_runs_review_idx").on(t.reviewId),
    index("test_runs_status_idx").on(t.status),
    index("test_runs_batch_idx").on(t.batchId),
  ],
);

/** Live log lines of a review, an analysis or a test run (exactly one id is set). */
export const runEvents = mysqlTable(
  "run_events",
  {
    id: id(),
    reviewId: ref("review_id"),
    analysisId: ref("analysis_id"),
    testRunId: ref("test_run_id"),
    seq: int("seq").notNull(),
    line: mediumtext("line").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("run_events_review_seq_idx").on(t.reviewId, t.seq),
    uniqueIndex("run_events_analysis_seq_idx").on(t.analysisId, t.seq),
    uniqueIndex("run_events_test_seq_idx").on(t.testRunId, t.seq),
  ],
);

export const FINDING_STATUSES = ["proposed", "confirmed", "dismissed"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const findings = mysqlTable(
  "findings",
  {
    id: id(),
    reviewId: ref("review_id").notNull(),
    /** Finding id from the run (F1, F2, ...). */
    findingId: varchar("finding_id", { length: 20 }).notNull(),
    data: json("data").$type<Finding>().notNull(),
    status: mysqlEnum("status", FINDING_STATUSES).notNull().default("proposed"),
    comment: text("comment"),
    ratedBy: ref("rated_by"),
    ratedAt: datetime("rated_at", { mode: "date" }),
  },
  (t) => [uniqueIndex("findings_review_finding_idx").on(t.reviewId, t.findingId)],
);

export type User = typeof users.$inferSelect;
export type Repo = typeof repos.$inferSelect;
export type RepoRole = typeof repoRoles.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type TestScriptRow = typeof testScripts.$inferSelect;
export type TestRun = typeof testRuns.$inferSelect;
