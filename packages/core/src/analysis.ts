import { z } from "zod";
import { ProviderSchema, RepoFullNameSchema } from "./forge.js";
import { BudgetTierSchema, EvidenceSchema, FindingSchema, LanguageSchema, RunCostSchema, RunStatusSchema } from "./schemas.js";

/**
 * The knowledge base Claudio keeps per repository. Each document is Markdown
 * so it can be read by people, diffed between commits and handed to agents.
 */
export const KNOWLEDGE_DOCS = {
  overview: {
    file: "overview.md",
    title: "Überblick",
    purpose: "What the application is for, who uses it, tech stack, main domain objects, roles and permissions, how login works.",
  },
  modules: {
    file: "modules.md",
    title: "Module",
    purpose: "Module map of the code: directories and key files, what each is responsible for, shared components and stores, server endpoints, data access.",
  },
  routes: {
    file: "routes.md",
    title: "Routen",
    purpose: "Route index: one entry per URL path with the files that implement it (page, server load/actions, layout, endpoints) and the shared modules it depends on. Used for impact analysis of pull requests.",
  },
  "app-map": {
    file: "app-map.md",
    title: "App-Karte",
    purpose: "Screens and flows as observed in the running app: per screen the URL, purpose, which roles see it, main elements and actions, and the expected (correct) behaviour including validation and feedback. This is the reference for regression checks.",
  },
  notes: {
    file: "notes.md",
    title: "Notizen",
    purpose: "Practical notes for future runs: test data that exists or must be created, quirks, slow or flaky areas, things that could not be explored and why.",
  },
} as const;

export const KnowledgeDocNameSchema = z.enum(["overview", "modules", "routes", "app-map", "notes"]);
export type KnowledgeDocName = z.infer<typeof KnowledgeDocNameSchema>;

export const KnowledgeDocSchema = z.object({ name: KnowledgeDocNameSchema, content: z.string() });
export type KnowledgeDoc = z.infer<typeof KnowledgeDocSchema>;

/** A knowledge base as handed to a run: the documents plus where they came from. */
export type KnowledgeBase = {
  commitSha: string;
  branch: string;
  analyzedAt: string;
  docs: KnowledgeDoc[];
};

export const AnalysisRequestSchema = z.object({
  repo: RepoFullNameSchema,
  /** Absent in requests from before GitLab support: GitHub. */
  provider: ProviderSchema.optional(),
  /** Branch to analyse; the default branch when omitted. */
  branch: z.string().optional(),
  instanceUrl: z.string().url(),
  roles: z.array(z.string()).default([]),
  budget: BudgetTierSchema.default("standard"),
  language: LanguageSchema.default("de"),
  headed: z.boolean().default(false),
  extraInstructions: z.string().optional(),
});
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;

export const AnalysisReportSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  request: AnalysisRequestSchema,
  commitSha: z.string(),
  branch: z.string(),
  /** Analysis this one built on, if it was an update. */
  previousCommitSha: z.string().optional(),
  summary: z.string(),
  docs: z.array(KnowledgeDocSchema),
  /** Bugs noticed along the way and the screenshots taken, kept with the report (the run directory is ephemeral). */
  findings: z.array(FindingSchema).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  cost: RunCostSchema,
  sessionId: z.string().optional(),
  errors: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
