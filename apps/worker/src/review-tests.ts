import { selectReviewTests, type Impact, type TestSelection } from "@claudio/core";
import { createTestRuns, listTestScripts, runsPerViewport, type Db, type Review } from "@claudio/db";

/**
 * Queues the regression tests a review runs, once its checkout is known: the
 * repository's `runInReviews` tests whose paths the change reaches, or all of
 * them. They run against the review's instance and report with it.
 */
export async function queueReviewTests(db: Db, review: Review, impact: Impact | null, log: (msg: string) => void): Promise<TestSelection | null> {
  const mode = review.request.regressionTests;
  if (mode === "none") return null;
  const scripts = (await listTestScripts(db, review.repoId)).filter((t) => t.runInReviews);
  if (!scripts.length) return null;

  const selection = selectReviewTests(
    mode,
    impact,
    scripts.map((t) => ({ id: t.id, name: t.name, touchedPaths: t.touchedPaths, steps: t.steps })),
  );
  const chosen = new Set(selection.selected.map((t) => t.id));
  const { repo, provider, instanceUrl, language } = review.request;
  await createTestRuns(
    db,
    runsPerViewport(
      scripts
        .filter((t) => chosen.has(t.id))
        .map((t) => ({
          scriptId: t.id,
          repoId: review.repoId,
          reviewId: review.id,
          request: { repo, provider, instanceUrl, budget: "quick" as const, language, headed: false, rerecord: false },
          startedBy: review.startedBy,
          viewports: t.viewports?.length ? t.viewports : ["desktop"],
        })),
    ),
  );
  log(
    selection.all
      ? `Regressionstests: alle ${scripts.length} (${ALL_REASON[selection.all]}).`
      : `Regressionstests: ${selection.selected.length} von ${scripts.length} betroffen${selection.skipped.length ? `, übersprungen: ${selection.skipped.map((t) => t.name).join(", ")}` : ""}.`,
  );
  return selection;
}

const ALL_REASON: Record<NonNullable<TestSelection["all"]>, string> = {
  requested: "so gewählt",
  no_impact: "ohne Checkout keine Impact-Rechnung",
  unknown_framework: "keine SvelteKit-Routen im Checkout",
  global_change: "die Änderung betrifft die ganze App",
};
