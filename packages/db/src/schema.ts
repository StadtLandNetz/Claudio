import { bigint, boolean, customType, datetime, index, int, json, mediumtext, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Binary column up to 16 MB (screenshots). */
const mediumblob = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "mediumblob" });
import type { AutomationSettings } from "@claudio/github";
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
  /** Set when the OAuth App issues expiring tokens: used to renew the access token. */
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: datetime("token_expires_at", { mode: "date" }),
  /** UI language ("de" | "en"); also the language of what Claudio posts to GitHub on this person's behalf. Null: not chosen yet. */
  locale: varchar("locale", { length: 5 }),
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
  /** Webhook-driven automation (Phase 5). Null until configured. */
  automation: json("automation").$type<AutomationSettings | null>(),
  /** Defaults for reviews started by GitHub events. */
  autoReview: json("auto_review").$type<AutoReviewDefaults | null>(),
  webhookId: bigint("webhook_id", { mode: "number" }),
  webhookSecretEnc: text("webhook_secret_enc"),
  /** Whose GitHub token automated runs use (the person who installed the webhook). */
  automationUserId: ref("automation_user_id"),
  /** The repository's own Anthropic API key (encrypted). Runs of this repo use only this key. */
  anthropicKeyEnc: text("anthropic_key_enc"),
  /** Last characters of the key, to recognise it without showing it. */
  anthropicKeyHint: varchar("anthropic_key_hint", { length: 12 }),
  anthropicKeySetBy: ref("anthropic_key_set_by"),
  anthropicKeySetAt: datetime("anthropic_key_set_at", { mode: "date" }),
  /** Dismissed findings with a reason; every later review is told about them. */
  lessons: json("lessons").$type<Lesson[]>().notNull().$defaultFn(() => []),
  /** Slack incoming webhook (encrypted) and what to post there. */
  slackWebhookEnc: text("slack_webhook_enc"),
  slackWebhookHint: varchar("slack_webhook_hint", { length: 40 }),
  notifications: json("notifications").$type<NotificationSettings | null>(),
  /** Spending cap per calendar month in USD (null: none). Runs do not start beyond it. */
  monthlyBudgetUsd: varchar("monthly_budget_usd", { length: 20 }),
  /** Month (YYYY-MM) for which the 80 % warning went out, so it goes once. */
  budgetWarnedMonth: varchar("budget_warned_month", { length: 7 }),
  createdBy: ref("created_by").notNull(),
  createdAt: createdAt(),
});

/** What a repository's Slack channel hears about. */
export type NotificationSettings = {
  /** A run waits for a person (CAPTCHA, bot check). */
  takeover: boolean;
  /** Short result of every finished review, only of those that need changes, or none. */
  reviews: "all" | "changes" | "off";
  /** Automatic reviews started by GitHub events, and those that could not start (with the reason). */
  automation: boolean;
  /** Test runs outside reviews and test suites: failures only, every result, or none. */
  tests: "failed" | "all" | "off";
  /** Repository analyses (knowledge base updated or failed). */
  analyses: boolean;
  /** Added to messages that need someone (takeover, blocking result), e.g. <!here> or <@U123>. */
  mention: string;
};

export type AutoReviewDefaults = {
  roles: string[];
  budget: "quick" | "standard" | "thorough";
  strictness: "lenient" | "normal" | "strict";
  postComment: boolean;
  runTests: boolean;
  /** Automatic reviews of a PR that was reviewed before only re-check what changed (default on). */
  followUp?: boolean;
  /** Where automatic reviews check the app (default desktop). */
  viewports?: ("desktop" | "mobile")[];
};

export type Lesson = { text: string; reviewId: number; findingId: string; by: string; at: string };

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
    /** manual, comment, label or push (automatic). */
    trigger: varchar("trigger", { length: 20 }).notNull().default("manual"),
    /** PR head commit the review is about (for the commit status). */
    headSha: varchar("head_sha", { length: 64 }),
    status: mysqlEnum("status", REVIEW_STATUSES).notNull().default("queued"),
    runId: varchar("run_id", { length: 120 }),
    report: json("report").$type<ReviewReport>(),
    verdict: varchar("verdict", { length: 30 }),
    costUsd: varchar("cost_usd", { length: 20 }),
    error: text("error"),
    /** TL;DR comment on the pull request (posted by the run or later from the UI). */
    commentUrl: varchar("comment_url", { length: 500 }),
    /** When the result went to Slack (it goes once). */
    notifiedAt: datetime("notified_at", { mode: "date" }),
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
    /** Hosts this test may open besides the instance and the repo's allowed hosts. */
    allowedHosts: json("allowed_hosts").$type<string[] | null>(),
    allowAnyHost: boolean("allow_any_host").notNull().default(false),
    /** Desktop and/or phone; each start runs the test once per viewport. Null: desktop. */
    viewports: json("viewports").$type<("desktop" | "mobile")[] | null>(),
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
    /** When the result (of this run, or of its suite) went to Slack. */
    notifiedAt: datetime("notified_at", { mode: "date" }),
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

/**
 * Files of a run that must outlive the pod (screenshots), stored in the database so the
 * app keeps no state on disk. Deleted after the retention period (default 14 days).
 */
export const runArtifacts = mysqlTable(
  "run_artifacts",
  {
    id: id(),
    runId: varchar("run_id", { length: 120 }).notNull(),
    /** Path inside the run directory, as referenced by the report (e.g. evidence/E1-Fahrtenliste.png). */
    path: varchar("path", { length: 300 }).notNull(),
    contentType: varchar("content_type", { length: 80 }).notNull(),
    size: int("size").notNull(),
    data: mediumblob("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("run_artifacts_run_path_idx").on(t.runId, t.path), index("run_artifacts_created_idx").on(t.createdAt)],
);

/**
 * What agents learned about operating a repository's app (unlabelled fields,
 * banners to dismiss, slow pages). Fed into later runs; people can delete entries.
 */
export const agentLearnings = mysqlTable(
  "agent_learnings",
  {
    id: id(),
    repoId: ref("repo_id").notNull(),
    text: varchar("text", { length: 500 }).notNull(),
    runKind: mysqlEnum("run_kind", ["review", "analysis", "test"]).notNull(),
    runRefId: ref("run_ref_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("agent_learnings_repo_idx").on(t.repoId)],
);

export const ACCESS_LEVELS = ["none", "read", "write", "admin"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** A user's GitHub permission on a repository, cached for a few minutes. */
export const repoAccess = mysqlTable(
  "repo_access",
  {
    userId: ref("user_id").notNull(),
    repoId: ref("repo_id").notNull(),
    level: mysqlEnum("level", ACCESS_LEVELS).notNull(),
    checkedAt: datetime("checked_at", { mode: "date" }).notNull(),
  },
  (t) => [uniqueIndex("repo_access_user_repo_idx").on(t.userId, t.repoId)],
);

export const RUN_KINDS = ["review", "analysis", "test"] as const;
export type RunKind = (typeof RUN_KINDS)[number];
export const HUMAN_REQUEST_STATUSES = ["open", "resolved", "cancelled", "timeout"] as const;

/** A run waiting for a person (CAPTCHA, bot check). The person works in the live view, then resolves it. */
export const humanRequests = mysqlTable(
  "human_requests",
  {
    id: id(),
    runKind: mysqlEnum("run_kind", RUN_KINDS).notNull(),
    runRefId: ref("run_ref_id").notNull(),
    repoId: ref("repo_id").notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    /** takeover: hand over the browser (CAPTCHA); question: the agent asks something and waits for an answer. */
    kind: mysqlEnum("kind", ["takeover", "question"]).notNull().default("takeover"),
    /** Question: what the agent already knows and why it asks. */
    context: text("context"),
    /** Question: answers the agent suggests (the person may also write their own). */
    options: json("options").$type<string[] | null>(),
    answer: text("answer"),
    status: mysqlEnum("status", HUMAN_REQUEST_STATUSES).notNull().default("open"),
    resolvedBy: ref("resolved_by"),
    createdAt: createdAt(),
    resolvedAt: datetime("resolved_at", { mode: "date" }),
  },
  (t) => [index("human_requests_run_idx").on(t.runKind, t.runRefId), index("human_requests_status_idx").on(t.status)],
);

/** Clicks and keystrokes from the live view, applied in order by the worker. */
export const humanInputs = mysqlTable(
  "human_inputs",
  {
    id: id(),
    requestId: ref("request_id").notNull(),
    input: json("input").$type<HumanInputPayload>().notNull(),
    userId: ref("user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("human_inputs_request_idx").on(t.requestId)],
);

export type HumanInputPayload =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; dy: number };

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
    /** GitHub issue created from this finding. */
    issueUrl: varchar("issue_url", { length: 500 }),
  },
  (t) => [uniqueIndex("findings_review_finding_idx").on(t.reviewId, t.findingId)],
);

export const FINDING_ACTIVITY_KINDS = ["comment", "confirmed", "dismissed", "reset"] as const;
export type FindingActivityKind = (typeof FINDING_ACTIVITY_KINDS)[number];

/**
 * What people did with a finding, in order: comments, and every rating with its
 * reason. `findings.status` and `comment` hold the current rating; this is the thread.
 */
export const findingActivity = mysqlTable(
  "finding_activity",
  {
    id: id(),
    reviewId: ref("review_id").notNull(),
    findingId: varchar("finding_id", { length: 20 }).notNull(),
    userId: ref("user_id").notNull(),
    kind: mysqlEnum("kind", FINDING_ACTIVITY_KINDS).notNull(),
    body: text("body"),
    createdAt: createdAt(),
  },
  (t) => [index("finding_activity_review_idx").on(t.reviewId, t.findingId)],
);

export type User = typeof users.$inferSelect;
export type Repo = typeof repos.$inferSelect;
export type RepoRole = typeof repoRoles.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type FindingActivity = typeof findingActivity.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type TestScriptRow = typeof testScripts.$inferSelect;
export type TestRun = typeof testRuns.$inferSelect;
export type HumanRequest = typeof humanRequests.$inferSelect;
export type AgentLearning = typeof agentLearnings.$inferSelect;
