import { z } from "zod";
import { DeterminismSchema, TestOutcomeSchema, TestStepSchema, describeStep, type Determinism, type StepResult, type TestOutcome, type TestStep } from "@claudio/core";
import { detectCaptcha } from "../human.js";
import { ariaSnapshot, executeStep, formFieldHints, testPage, type StepContext } from "../steps.js";
import { def, type ClaudioTool } from "./definitions.js";

export type TestFinish = { complete: boolean; outcome: TestOutcome; determinism: Determinism; summary: string };

/** Collects what the agent did in a test run: every attempted step, and the ones that worked (the recording). */
export class StepRecorder {
  readonly results: StepResult[] = [];
  readonly recorded: TestStep[] = [];
  finish?: TestFinish;

  constructor(
    /** Steps replayed before the agent took over (healing); they count as recorded. */
    readonly prefix: TestStep[] = [],
  ) {}

  add(step: TestStep, ok: boolean, durationMs: number, error: string | undefined, healed: boolean): StepResult {
    const r: StepResult = { index: this.prefix.length + this.results.length, step, ok, error, durationMs, healed };
    this.results.push(r);
    if (ok) this.recorded.push(step);
    return r;
  }

  compiled(): TestStep[] {
    return [...this.prefix, ...this.recorded];
  }
}

/**
 * Tools for recording and healing test scripts. All browser actions go through
 * test_step, which Claudio executes itself, so what is recorded is exactly what ran.
 */
export function createTestTools(ctx: StepContext, recorder: StepRecorder, opts: { healing: boolean }): ClaudioTool<any>[] {
  const testStep = def({
    name: "test_step",
    description:
      "Execute one test step in the browser and record it. Actions: login(role), goto(path), click/fill/select/check/uncheck/press on a target, and assertions expect_visible, expect_hidden, expect_text, expect_url, expect_no_errors, plus screenshot(label). Targets, most robust first: {role, name} as in the snapshot (e.g. {role:'button', name:'Speichern'}), {label}, {placeholder}, {text}, {testId}, {css}. Use {{run}} in values for unique test data and {{date:+N:DD.MM.YYYY}} for dates relative to today. Only successful steps are recorded.",
    schema: { step: TestStepSchema },
    handler: async ({ step }) => {
      if (!ctx.attachment.browser.isConnected()) {
        return "The browser has crashed or was closed. Stop now: call finish_test with complete false and outcome inconclusive.";
      }
      const out = await executeStep(step, ctx);
      const r = recorder.add(step, out.ok, out.durationMs, out.error, opts.healing);
      const captcha = await detectCaptcha(await testPage(ctx.attachment));
      const hint = captcha ? ` A ${captcha} is on the page: call request_human_help; do not try to solve it yourself.` : "";
      if (out.ok) return `#${r.index} ok: ${describeStep(step)} (${out.durationMs} ms).${hint}`;
      const failed = `#${r.index} FAILED: ${describeStep(step)}: ${out.error}`;
      if (hint || out.assertionFailed) return failed + hint;
      // A field that was not found: show what the form actually offers instead of letting the agent guess.
      if (["fill", "select", "check", "uncheck"].includes(step.action)) {
        const fields = await formFieldHints(await testPage(ctx.attachment));
        return `${failed}\n\nThe visible form fields (the caption next to a field is often not its label, so {label} and {role,name} miss it):\n${fields}\n\nPick a target from this list instead of guessing variants. Failed steps are not recorded.`;
      }
      return `${failed} Take a snapshot to find the right target, then retry; failed steps are not recorded.`;
    },
  });

  const snapshot = def({
    name: "snapshot",
    description: "Accessibility tree of the current page (roles and accessible names) plus URL and title. Use it to choose targets for test_step.",
    readOnly: true,
    schema: {},
    handler: async () => {
      const tree = await ariaSnapshot(ctx.attachment);
      const captcha = await detectCaptcha(await testPage(ctx.attachment));
      return captcha ? `${tree}\n\nNOTE: a ${captcha} is on the page. Call request_human_help; do not try to solve it yourself.` : tree;
    },
  });

  const finishTest = def({
    name: "finish_test",
    description:
      "Finish the test run. complete: you performed the whole flow from the description (regardless of whether the expectation held). outcome: your reading of the expectation. determinism: deterministic if the recorded assertions alone decide pass/fail; semi if replaying the steps works but judging the result needs a person or model (e.g. 'list looks correct'); explorative if the flow itself must adapt each time (data-dependent choices).",
    schema: {
      complete: z.boolean(),
      outcome: TestOutcomeSchema,
      determinism: DeterminismSchema,
      summary: z.string().describe("Two or three sentences: what you did, what you observed, how the expectation was checked"),
    },
    handler: async (args) => {
      recorder.finish = args;
      return "Recorded. End your turn now with a one-paragraph summary.";
    },
  });

  return [testStep, snapshot, finishTest] as ClaudioTool<any>[];
}
