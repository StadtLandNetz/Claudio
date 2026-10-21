import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { modelEnv } from "./env.js";
import { JudgeVerdictSchema, describeStep, isAssertion, resolveStepTemplates, type JudgeVerdict, type Language, type StepResult, type TestScript } from "@claudio/core";

export type JudgeInput = {
  script: Pick<TestScript, "name" | "description" | "expectation">;
  steps: StepResult[];
  /** Value of {{run}} in this run, so the judge sees the actual test data. */
  runTag: string;
  finalUrl: string;
  /** Accessibility tree of the final page. */
  finalSnapshot: string;
  /** Absolute path of a screenshot of the final state. */
  screenshotPath: string | null;
  errors: string[];
  /** What the agent that ran the test reported, if one ran. */
  runnerSummary?: string;
  language: Language;
  model: string;
  runDir: string;
  abortController?: AbortController;
  /** The repository's Anthropic API key. */
  apiKey?: string;
};

export type JudgeResult = { verdict: JudgeVerdict | null; costUsd: number; error?: string };

const VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "confidence", "deviations", "reasoning"],
  properties: {
    passed: { type: "boolean", description: "true if every part of the expectation holds in the final state" },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "how sure you are, 0 to 1" },
    deviations: { type: "array", items: { type: "string" }, description: "each part of the expectation that does not hold, concretely" },
    reasoning: { type: "string", description: "two to four sentences on how you checked each part of the expectation" },
  },
} as const;

/**
 * Independent judge: sees only the expectation and the evidence of the run, not
 * the tester's reasoning, and answers with structured output.
 */
export async function runJudge(input: JudgeInput): Promise<JudgeResult> {
  const lang = input.language === "de" ? "German" : "English";
  const show = (r: StepResult) => describeStep(resolveStepTemplates(r.step, { runTag: input.runTag }));
  // Failed actions while recording are discarded attempts (wrong locator, retried); only failed checks carry information.
  const steps = input.steps.filter((r) => r.ok).map((r, i) => `${i + 1}. ${show(r)}`).join("\n");
  const failedChecks = input.steps.filter((r) => !r.ok && isAssertion(r.step)).map((r) => `- ${show(r)}: ${r.error}`).join("\n");
  const prompt = `You judge whether an automated UI test met its expectation. Decide only from the evidence below${input.screenshotPath ? " and the screenshot (Read it)" : ""}. Do not assume anything that is not shown.

# Test "${input.script.name}"

What should be done:
${input.script.description}

Expectation (what must be true at the end):
${input.script.expectation}

# Steps that were executed successfully
${steps || "(none)"}

# Checks that did not hold
${failedChecks || "none"}

# Final state
URL: ${input.finalUrl}
${input.screenshotPath ? `Screenshot: ${input.screenshotPath}\n` : ""}
Accessibility tree:
${input.finalSnapshot}

# Errors during the run
${input.errors.length ? input.errors.map((e) => `- ${e}`).join("\n") : "none"}
${input.runnerSummary ? `\n# Note from the tester (may be wrong)\n${input.runnerSummary}\n` : ""}
Rules: passed only if every part of the expectation is evidently satisfied in the final state and the steps. A failed check counts against the test when it concerns the expectation; console noise or checks unrelated to the expectation do not fail the test, but mention them in reasoning. An error page or HTTP 5xx in the flow means not passed. If the evidence is insufficient to decide, set passed false, confidence below 0.5 and say what is missing. Write deviations and reasoning in ${lang}.`;

  let result: SDKResultMessage | undefined;
  try {
    for await (const m of query({
      prompt,
      options: {
        model: input.model,
        cwd: input.runDir,
        settingSources: [],
        systemPrompt: "You are a strict, fair QA judge. You answer only with the requested structured verdict.",
        outputFormat: { type: "json_schema", schema: VERDICT_JSON_SCHEMA as unknown as Record<string, unknown> },
        allowedTools: ["Read"],
        disallowedTools: ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 6,
        maxBudgetUsd: 1,
        abortController: input.abortController,
        env: modelEnv(process.env, input.apiKey),
      },
    })) {
      if (m.type === "result") result = m;
    }
  } catch (e) {
    return { verdict: null, costUsd: 0, error: `judge failed: ${(e as Error).message}` };
  }
  const costUsd = result?.total_cost_usd ?? 0;
  if (!result || result.subtype !== "success") return { verdict: null, costUsd, error: `judge ended with ${result?.subtype ?? "no result"}` };
  const parsed = JudgeVerdictSchema.safeParse(result.structured_output);
  return parsed.success ? { verdict: parsed.data, costUsd } : { verdict: null, costUsd, error: "judge returned an invalid verdict" };
}
