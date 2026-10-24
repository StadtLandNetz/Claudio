/** Label that starts a review of the pull or merge request it is added to. */
export const REVIEW_LABEL = "claudio-review";

/** A comment line "/claudio review" with an optional budget ("/claudio review thorough"). */
const COMMAND = /^\s*\/claudio\s+review\b(.*)$/im;

/** Whether a comment asks Claudio for a review, and with which budget. */
export function reviewCommand(body: string): { budget?: "quick" | "standard" | "thorough" } | null {
  const m = body.match(COMMAND);
  if (!m) return null;
  const budget = m[1]!.match(/\b(quick|standard|thorough)\b/i)?.[1]?.toLowerCase() as "quick" | "standard" | "thorough" | undefined;
  return { budget };
}
