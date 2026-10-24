import { z } from "zod";
import { ProviderSchema, RepoFullNameSchema } from "./forge.js";
import { ImpactSchema, TestSelectionSchema } from "./impact.js";

export const SeveritySchema = z.enum(["blocker", "major", "minor", "suggestion"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingCategorySchema = z.enum([
  "acceptance",
  "regression",
  "ux",
  "ui",
  "console",
  "network",
  "security",
  "performance",
  "other",
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const BudgetTierSchema = z.enum(["quick", "standard", "thorough"]);
export type BudgetTier = z.infer<typeof BudgetTierSchema>;

export const VerbositySchema = z.enum(["tldr", "normal", "detailed"]);
export type Verbosity = z.infer<typeof VerbositySchema>;

export const StrictnessSchema = z.enum(["lenient", "normal", "strict"]);
export type Strictness = z.infer<typeof StrictnessSchema>;

export const DriverNameSchema = z.enum(["playwright", "chrome"]);
export type DriverName = z.infer<typeof DriverNameSchema>;

export const LanguageSchema = z.enum(["de", "en"]);
export type Language = z.infer<typeof LanguageSchema>;

/** Desktop (1280×800) or a phone (390×844, touch, mobile user agent). */
export const ViewportSchema = z.enum(["desktop", "mobile"]);
export type Viewport = z.infer<typeof ViewportSchema>;

export const EvidenceKindSchema = z.enum(["screenshot", "trace", "console", "network", "note"]);

export const EvidenceSchema = z.object({
  id: z.string(),
  kind: EvidenceKindSchema,
  label: z.string(),
  path: z.string().optional(),
  pageUrl: z.string().optional(),
  note: z.string().optional(),
  /** Set when the screenshot was taken in the phone viewport. */
  viewport: ViewportSchema.optional(),
  createdAt: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  category: FindingCategorySchema,
  severity: SeveritySchema,
  title: z.string(),
  description: z.string(),
  steps: z.array(z.string()).default([]),
  expected: z.string().optional(),
  actual: z.string().optional(),
  url: z.string().optional(),
  acceptanceCriterion: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
  /** In a re-review: the finding of the earlier review this one continues, and whether it was re-checked. */
  previous: z
    .object({ reviewId: z.number(), findingId: z.string(), status: z.enum(["still_open", "not_rechecked"]) })
    .optional(),
  createdAt: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const AcStatusSchema = z.enum(["passed", "failed", "blocked", "not_testable"]);

export const AcceptanceCriterionResultSchema = z.object({
  criterion: z.string(),
  status: AcStatusSchema,
  notes: z.string().default(""),
  evidenceIds: z.array(z.string()).default([]),
  /** In a re-review: taken over unchanged from this earlier review (not re-tested, nothing it depends on changed). */
  carriedFrom: z.number().optional(),
  createdAt: z.string(),
});
export type AcceptanceCriterionResult = z.infer<typeof AcceptanceCriterionResultSchema>;

/** What a re-review found about one finding of the earlier review. */
export const RecheckSchema = z.object({
  findingId: z.string(),
  title: z.string(),
  severity: SeveritySchema,
  status: z.enum(["fixed", "still_open", "not_rechecked"]),
  notes: z.string().default(""),
  evidenceIds: z.array(z.string()).default([]),
});
export type Recheck = z.infer<typeof RecheckSchema>;

export const FollowUpSchema = z.object({
  reviewId: z.number(),
  /** Commit the earlier review checked. */
  headSha: z.string().optional(),
  /** Files changed since that commit; null when GitHub or GitLab could not tell. */
  changedFiles: z.array(z.string()).nullable().default(null),
  rechecks: z.array(RecheckSchema).default([]),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

export const TodoItemSchema = z.object({
  id: z.number(),
  text: z.string(),
  status: z.enum(["open", "done", "skipped"]),
  result: z.string().optional(),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const ReviewRequestSchema = z.object({
  repo: RepoFullNameSchema,
  /** Absent in requests from before GitLab support: GitHub. */
  provider: ProviderSchema.optional(),
  pr: z.number().int().positive(),
  instanceUrl: z.string().url(),
  roles: z.array(z.string()).default([]),
  driver: DriverNameSchema.default("playwright"),
  budget: BudgetTierSchema.default("standard"),
  verbosity: VerbositySchema.default("normal"),
  strictness: StrictnessSchema.default("normal"),
  language: LanguageSchema.default("de"),
  headed: z.boolean().default(false),
  postComment: z.boolean().default(false),
  cloneRepo: z.boolean().default(true),
  modelOverride: z.string().optional(),
  extraInstructions: z.string().optional(),
  /** Acceptance criteria a person confirmed before the run. When set, the agent tests exactly these. */
  criteria: z.array(z.string().min(1)).optional(),
  /** Re-review: build on this earlier review of the same pull request and check only what changed since. */
  followUpOf: z.number().int().positive().optional(),
  /** Where the app is checked: desktop, phone, or both (desktop first, then the changed screens on the phone). */
  viewports: z.array(ViewportSchema).min(1).default(["desktop"]),
  /**
   * The repository's regression tests to run with the review: those the change reaches, all, or none.
   * The worker picks them after the checkout. Older requests had their tests queued with the review: none.
   */
  regressionTests: z.enum(["none", "affected", "all"]).default("none"),
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const RunCostSchema = z.object({
  usd: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  turns: z.number(),
  durationMs: z.number(),
  browserSteps: z.number(),
});
export type RunCost = z.infer<typeof RunCostSchema>;

export const RunStatusSchema = z.enum(["completed", "budget_exceeded", "max_turns", "failed", "aborted"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ReviewReportSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  request: ReviewRequestSchema,
  pr: z.object({
    number: z.number(),
    title: z.string(),
    url: z.string(),
    headRef: z.string(),
    baseRef: z.string(),
    author: z.string().optional(),
    headSha: z.string().optional(),
  }),
  issues: z.array(z.object({ number: z.number(), title: z.string(), url: z.string() })),
  summary: z.string(),
  affectedAreas: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(AcceptanceCriterionResultSchema).default([]),
  findings: z.array(FindingSchema).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  notes: z.string().default(""),
  cost: RunCostSchema,
  sessionId: z.string().optional(),
  errors: z.array(z.string()).default([]),
  /** URL of the TL;DR comment posted to the pull request, if any. */
  commentUrl: z.string().optional(),
  /** Set for a re-review: what became of the earlier review's findings. */
  followUp: FollowUpSchema.optional(),
  /** Routes the change reaches through the import graph; absent without a checkout. */
  impact: ImpactSchema.optional(),
  /** Which regression tests ran with the review and why. */
  testSelection: TestSelectionSchema.optional(),
  createdAt: z.string(),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

/** A criterion without the number an agent may have put in front ("2. Das Formular …"). */
export const criterionText = (s: string): string => s.trim().replace(/^\d+[.)]\s+/, "");

/** What a re-review is told about the review it builds on (assembled by the worker). */
export type FollowUpContext = {
  reviewId: number;
  headSha?: string;
  /** Files changed since that commit; null when GitHub or GitLab could not tell (then everything counts as changed). */
  changedFiles: string[] | null;
  summary: string;
  criteria: { criterion: string; status: AcceptanceCriterionResult["status"]; notes: string }[];
  /** Findings that were not dismissed, with the people's rating. */
  findings: (Finding & { rating: "proposed" | "confirmed"; comment: string | null })[];
  /** Titles of findings people dismissed: intended behaviour, not to be reported again. */
  dismissed: string[];
};

/** One step of a login recipe. `$USER` and `$PASSWORD` are substituted from the role's env vars. */
export const LoginStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), url: z.string() }),
  z.object({ action: z.literal("fill"), selector: z.string(), value: z.string() }),
  z.object({ action: z.literal("click"), selector: z.string() }),
  z.object({ action: z.literal("press"), key: z.string() }),
  z.object({ action: z.literal("waitForUrl"), pattern: z.string() }),
  z.object({ action: z.literal("waitForSelector"), selector: z.string() }),
]);
export type LoginStep = z.infer<typeof LoginStepSchema>;

export const RoleConfigSchema = z.object({
  description: z.string().optional(),
  usernameEnv: z.string(),
  passwordEnv: z.string(),
  /** Explicit login recipe. When omitted, the adaptive auto-login heuristic is used. */
  recipe: z.array(LoginStepSchema).optional(),
  /** Path of the login page relative to the instance URL, for the auto-login heuristic. */
  loginPath: z.string().default("/login"),
  /** URL fragment or path that indicates a successful login (e.g. "/dashboard"). */
  successUrlContains: z.string().optional(),
});
export type RoleConfig = z.infer<typeof RoleConfigSchema>;

/** claudio.config.json: per-target-repo settings. */
export const RepoConfigSchema = z.object({
  repo: z.string(),
  roles: z.record(z.string(), RoleConfigSchema).default({}),
  /** Free-form notes for the agent: domain vocabulary, known quirks, areas to be careful with. */
  notes: z.string().optional(),
  /** Hosts the browser may visit in addition to the instance host (e.g. an auth provider). */
  extraAllowedHosts: z.array(z.string()).default([]),
  /** What people told Claudio when they dismissed findings: things that are intended, not bugs. */
  lessons: z.array(z.string()).default([]),
  /** What earlier runs learned about operating the app (from remember_learning), newest first. */
  learnings: z.array(z.string()).default([]),
});
export type RepoConfig = z.infer<typeof RepoConfigSchema>;
