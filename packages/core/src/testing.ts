import { z } from "zod";
import { BudgetTierSchema, EvidenceSchema, FindingSchema, LanguageSchema, RunCostSchema, RunStatusSchema } from "./schemas.js";

/**
 * How Claudio finds an element. Role + accessible name first: it survives
 * restyling and is what a user sees. CSS is the last resort.
 */
export const TargetSchema = z.union([
  z.object({ role: z.string(), name: z.string().optional(), exact: z.boolean().optional() }),
  z.object({ label: z.string(), exact: z.boolean().optional() }),
  z.object({ placeholder: z.string() }),
  z.object({ text: z.string(), exact: z.boolean().optional() }),
  z.object({ testId: z.string() }),
  z.object({ css: z.string() }),
]);
export type Target = z.infer<typeof TargetSchema>;

/**
 * One recorded step of a test script. Values may contain templates:
 * {{run}} (short id of the run, for unique test data) and
 * {{date:+N:FORMAT}} (today plus N days, FORMAT DD.MM.YYYY or YYYY-MM-DD).
 */
export const TestStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), role: z.string() }),
  z.object({ action: z.literal("goto"), path: z.string() }),
  z.object({ action: z.literal("click"), target: TargetSchema }),
  z.object({ action: z.literal("fill"), target: TargetSchema, value: z.string() }),
  z.object({ action: z.literal("select"), target: TargetSchema, value: z.string() }),
  z.object({ action: z.literal("check"), target: TargetSchema }),
  z.object({ action: z.literal("uncheck"), target: TargetSchema }),
  z.object({ action: z.literal("press"), key: z.string(), target: TargetSchema.optional() }),
  z.object({ action: z.literal("expect_visible"), target: TargetSchema }),
  z.object({ action: z.literal("expect_hidden"), target: TargetSchema }),
  z.object({ action: z.literal("expect_text"), text: z.string(), target: TargetSchema.optional() }),
  z.object({ action: z.literal("expect_url"), contains: z.string() }),
  z.object({ action: z.literal("expect_no_errors") }),
  z.object({ action: z.literal("screenshot"), label: z.string() }),
]);
export type TestStep = z.infer<typeof TestStepSchema>;

export const isAssertion = (step: TestStep) => step.action.startsWith("expect_");

export const DeterminismSchema = z.enum(["deterministic", "semi", "explorative"]);
export type Determinism = z.infer<typeof DeterminismSchema>;

export const TestOutcomeSchema = z.enum(["passed", "failed", "inconclusive"]);
export type TestOutcome = z.infer<typeof TestOutcomeSchema>;

export const TestModeSchema = z.enum(["record", "replay", "explore"]);
export type TestMode = z.infer<typeof TestModeSchema>;

/** A test script as the runner needs it. */
export const TestScriptSchema = z.object({
  id: z.number(),
  name: z.string(),
  /** What to do, in plain language. */
  description: z.string(),
  /** What must be true at the end, in plain language. */
  expectation: z.string(),
  roles: z.array(z.string()).default([]),
  determinism: DeterminismSchema.nullable(),
  steps: z.array(TestStepSchema).nullable(),
});
export type TestScript = z.infer<typeof TestScriptSchema>;

export const TestRunRequestSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "repo must be owner/name"),
  instanceUrl: z.string().url(),
  budget: BudgetTierSchema.default("quick"),
  language: LanguageSchema.default("de"),
  headed: z.boolean().default(false),
  /** Force a fresh recording even when steps exist. */
  rerecord: z.boolean().default(false),
});
export type TestRunRequest = z.infer<typeof TestRunRequestSchema>;

export const StepResultSchema = z.object({
  index: z.number(),
  step: TestStepSchema,
  ok: z.boolean(),
  error: z.string().optional(),
  durationMs: z.number(),
  /** Step was added by the agent while healing a broken replay. */
  healed: z.boolean().default(false),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const JudgeVerdictSchema = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  deviations: z.array(z.string()),
  reasoning: z.string(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export const TestRunReportSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  mode: TestModeSchema,
  outcome: TestOutcomeSchema,
  /** Index of the replayed step that broke and was healed by the agent. */
  healedAt: z.number().optional(),
  steps: z.array(StepResultSchema),
  /** Steps to store on the script after this run (new recording or healed replay). */
  compiledSteps: z.array(TestStepSchema).optional(),
  determinismProposal: DeterminismSchema.optional(),
  judge: JudgeVerdictSchema.optional(),
  summary: z.string(),
  findings: z.array(FindingSchema).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  finalUrl: z.string().optional(),
  cost: RunCostSchema,
  errors: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type TestRunReport = z.infer<typeof TestRunReportSchema>;

// ---------------------------------------------------------------- templates

export type TemplateContext = { runTag: string; now?: Date };

/** Resolves {{run}} and {{date:+N:FORMAT}} in a step value. Unknown templates are left as they are. */
export function resolveTemplate(text: string, ctx: TemplateContext): string {
  const now = ctx.now ?? new Date();
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, expr: string) => {
    if (expr === "run") return ctx.runTag;
    const m = expr.match(/^date(?::([+-]\d+))?(?::(.+))?$/);
    if (!m) return whole;
    const d = new Date(now);
    d.setDate(d.getDate() + Number(m[1] ?? 0));
    const pad = (n: number) => String(n).padStart(2, "0");
    const parts: Record<string, string> = { YYYY: String(d.getFullYear()), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()) };
    return (m[2] ?? "YYYY-MM-DD").replace(/YYYY|MM|DD/g, (k) => parts[k]!);
  });
}

/** Resolves templates everywhere in a step: values, texts, and target names. */
export function resolveStepTemplates(step: TestStep, ctx: TemplateContext): TestStep {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return resolveTemplate(v, ctx);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(step) as TestStep;
}

// ---------------------------------------------------------------- human-readable steps

export function describeTarget(t: Target): string {
  if ("role" in t) return `${t.role}${t.name ? ` „${t.name}“` : ""}`;
  if ("label" in t) return `Feld „${t.label}“`;
  if ("placeholder" in t) return `Feld mit Platzhalter „${t.placeholder}“`;
  if ("text" in t) return `Text „${t.text}“`;
  if ("testId" in t) return `Test-ID ${t.testId}`;
  return `CSS ${t.css}`;
}

/** German one-liner for the UI. */
export function describeStep(s: TestStep): string {
  switch (s.action) {
    case "login":
      return `Anmelden als ${s.role}`;
    case "goto":
      return `Öffnen ${s.path}`;
    case "click":
      return `Klicken auf ${describeTarget(s.target)}`;
    case "fill":
      return `${describeTarget(s.target)} ausfüllen mit „${s.value}“`;
    case "select":
      return `In ${describeTarget(s.target)} „${s.value}“ wählen`;
    case "check":
      return `${describeTarget(s.target)} ankreuzen`;
    case "uncheck":
      return `${describeTarget(s.target)} abwählen`;
    case "press":
      return `Taste ${s.key}${s.target ? ` in ${describeTarget(s.target)}` : ""}`;
    case "expect_visible":
      return `Prüfen: ${describeTarget(s.target)} ist sichtbar`;
    case "expect_hidden":
      return `Prüfen: ${describeTarget(s.target)} ist nicht sichtbar`;
    case "expect_text":
      return `Prüfen: ${s.target ? `${describeTarget(s.target)} enthält` : "Seite enthält"} „${s.text}“`;
    case "expect_url":
      return `Prüfen: Adresse enthält ${s.contains}`;
    case "expect_no_errors":
      return "Prüfen: keine Fehler in Konsole und Netzwerk";
    case "screenshot":
      return `Screenshot „${s.label}“`;
  }
}
