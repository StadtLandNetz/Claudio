import { tmpdir } from "node:os";
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { changeTerms, type Language } from "@claudio/core";
import type { PullRequestContext } from "@claudio/forge";
import { modelEnv } from "./env.js";

export type CriteriaInput = {
  pr: Pick<PullRequestContext, "number" | "title" | "body" | "issues" | "files" | "provider">;
  /** Notes about the application from the repository settings. */
  notes?: string;
  /** Route index of the knowledge base, to name screens the way the app does. */
  routes?: string;
  /** Criteria of an earlier review of this pull request (re-review). */
  previous?: string[];
  language: Language;
  apiKey?: string;
  model?: string;
};

export type CriteriaResult = { criteria: string[]; remarks: string; costUsd: number; error?: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["criteria", "remarks"],
  properties: {
    criteria: {
      type: "array",
      items: { type: "string" },
      description: "Testable acceptance criteria, one sentence each, in the order a tester would check them",
    },
    remarks: { type: "string", description: "One or two sentences: what is unclear or missing in the ticket, or empty" },
  },
} as const;

/** The prompt of proposeCriteria (pure, so its wording can be tested). */
export function buildCriteriaPrompt(input: Omit<CriteriaInput, "apiKey" | "model">): string {
  const lang = input.language === "de" ? "German" : "English";
  const { pr } = input;
  const issues = pr.issues.length
    ? pr.issues.map((i) => `## #${i.number}: ${i.title}\n${i.body.trim().slice(0, 6000) || "(empty)"}`).join("\n\n")
    : "(no linked issue)";
  const terms = changeTerms(pr.provider);
  return `Derive the acceptance criteria a QA tester would verify in the running app for this ${terms.change}.

# ${terms.Change} ${terms.prefix}${pr.number}: ${pr.title}

${pr.body.trim().slice(0, 6000) || "(empty description)"}

# Linked issues

${issues}

# Changed files (${pr.files.length})

${pr.files.slice(0, 60).map((f) => `- ${f.filename}`).join("\n")}
${input.notes ? `\n# Notes about the application\n\n${input.notes.trim().slice(0, 3000)}\n` : ""}${input.routes ? `\n# Screens of the application (route index)\n\n${input.routes.trim().slice(0, 6000)}\n` : ""}${input.previous?.length ? `\n# Criteria of the earlier review of this ${terms.change}\n\n${input.previous.map((c) => `- ${c}`).join("\n")}\nKeep these unless the ticket now says otherwise.\n` : ""}
Rules:
- Each criterion is one observable, testable statement about the app's behaviour from a user's point of view ("A dispatcher can … and then sees …"), not about code.
- Explicit requirements of the ticket first, then implicit ones that clearly follow (a new form validates required fields and shows the saved data).
- No regression checks of unrelated areas, no UX wishes, no duplicates. Usually 3 to 10 criteria.
- Write the criteria and the remarks in ${lang}.`;
}

/**
 * Proposes the acceptance criteria of a pull request from its ticket, before any
 * browser is started, so a person can correct them. One short model call.
 */
export async function proposeCriteria(input: CriteriaInput): Promise<CriteriaResult> {
  const prompt = buildCriteriaPrompt(input);

  let result: SDKResultMessage | undefined;
  try {
    for await (const m of query({
      prompt,
      options: {
        model: input.model ?? "claude-sonnet-5-5",
        cwd: tmpdir(),
        settingSources: [],
        systemPrompt: "You are a precise QA lead. You answer only with the requested structured result.",
        outputFormat: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> },
        allowedTools: [],
        disallowedTools: ["Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 3,
        maxBudgetUsd: 0.5,
        env: modelEnv(process.env, input.apiKey),
      },
    })) {
      if (m.type === "result") result = m;
    }
  } catch (e) {
    return { criteria: [], remarks: "", costUsd: 0, error: (e as Error).message };
  }
  const costUsd = result?.total_cost_usd ?? 0;
  if (!result || result.subtype !== "success") return { criteria: [], remarks: "", costUsd, error: `ended with ${result?.subtype ?? "no result"}` };
  const out = result.structured_output as { criteria?: unknown; remarks?: unknown } | undefined;
  const criteria = Array.isArray(out?.criteria) ? out.criteria.filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim()) : [];
  return { criteria, remarks: typeof out?.remarks === "string" ? out.remarks.trim() : "", costUsd, error: criteria.length ? undefined : "no criteria returned" };
}
