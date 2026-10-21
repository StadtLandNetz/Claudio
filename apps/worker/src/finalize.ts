import { REVIEW_SUPERSEDED, blockingFindings, followUpLine, renderCommitStatus, renderPrComment, verdict, withTests, type Verdict } from "@claudio/core";
import {
  claimNotification,
  dismissedFindingIds,
  notify,
  getRepoById,
  getReview,
  getUser,
  setReviewCommentUrl,
  testResultsByReview,
  freshAccessToken,
  type Db,
} from "@claudio/db";
import { createGithubClient, postPullRequestReview, setCommitStatus } from "@claudio/github";

const ACTIVE = new Set(["queued", "running"]);

/**
 * Reports a review back to GitHub once it and its regression tests are done:
 * the commit status, and the PR comment if the review asked for one. Called
 * after the review and after each of its test runs; does nothing until all
 * are finished, and posts the comment only once.
 */
export async function finalizeReview(db: Db, reviewId: number, publicBaseUrl: string, log: (msg: string) => void): Promise<void> {
  const review = await getReview(db, reviewId);
  if (!review || ACTIVE.has(review.status)) return;
  const repo = await getRepoById(db, review.repoId);
  if (!repo) return;

  const tests = (await testResultsByReview(db, [reviewId])).get(reviewId) ?? [];
  const pendingTests = tests.filter((t) => ACTIVE.has(t.status)).length;

  // The short result goes to Slack once, when the review and its tests are done (also for the demo).
  if (pendingTests === 0 && (await claimNotification(db, { reviewId }))) {
    const report = review.report;
    const dismissed = (await dismissedFindingIds(db, [reviewId])).get(reviewId) ?? [];
    const results = tests.map((t) => ({ name: t.name, outcome: t.outcome }));
    const blocking = report ? blockingFindings(report, report.request.strictness, dismissed) : [];
    await notify(
      repo,
      {
        kind: "review",
        id: reviewId,
        prNumber: review.prNumber,
        prTitle: review.prTitle,
        status: review.status,
        verdict: report ? withTests(verdict(report, report.request.strictness, dismissed), results) : null,
        acPassed: report?.acceptanceCriteria.filter((a) => a.status === "passed").length ?? 0,
        acTotal: report?.acceptanceCriteria.length ?? 0,
        findings: report ? report.findings.length - dismissed.length : 0,
        blocking: blocking.map((f) => f.title),
        tests: tests.length ? { passed: tests.filter((t) => t.outcome === "passed").length, total: tests.length } : null,
        costUsd: report?.cost.usd ?? 0,
        followUp: report ? followUpLine(report) : null,
        error: review.error,
      },
      { language: review.request.language, baseUrl: publicBaseUrl, log },
    );
  }

  if (review.fixture) return;
  const user = await getUser(db, repo.automationUserId ?? review.startedBy);
  const token = user ? await freshAccessToken(db, user) : null;
  if (!token) return;
  const github = createGithubClient(token);
  const url = publicBaseUrl ? `${publicBaseUrl}/reviews/${reviewId}` : undefined;
  const sha = review.headSha ?? review.report?.pr.headSha ?? null;
  const wantsStatus = Boolean(repo.automation?.commitStatus && sha);
  // Everything posted for a review uses its report language, which was set from the starting person's language.
  const language = review.request.language;

  if (pendingTests > 0) {
    if (wantsStatus) {
      await setCommitStatus(github, repo.fullName, sha!, "pending", renderCommitStatus(language, { kind: "testsRunning", pendingTests }), url).catch((e) => log(`commit status failed: ${(e as Error).message}`));
    }
    return;
  }

  const report = review.report;
  const dismissed = (await dismissedFindingIds(db, [reviewId])).get(reviewId) ?? [];
  const results = tests.map((t) => ({ name: t.name, outcome: t.outcome }));
  const v: Verdict = report ? withTests(verdict(report, report.request.strictness, dismissed), results) : "inconclusive";

  if (wantsStatus) {
    const description = report
      ? renderCommitStatus(language, {
          kind: "done",
          verdict: v,
          acPassed: report.acceptanceCriteria.filter((a) => a.status === "passed").length,
          acTotal: report.acceptanceCriteria.length,
          blocking: blockingFindings(report, report.request.strictness, dismissed).length,
          tests: tests.length ? { passed: tests.filter((t) => t.outcome === "passed").length, total: tests.length } : undefined,
        })
      : renderCommitStatus(language, { kind: "failed", verdict: v, reason: review.error ?? review.status });
    // A finished review is a green check whatever it found: the verdict is in the description, and
    // blocking findings come as a "changes requested" review. Only a run that crashed without a report is an error.
    const state = report ? "success" : "error";
    await setCommitStatus(github, repo.fullName, sha!, state, description, url)
      .then(() => log(`review ${reviewId}: commit status ${state}`))
      .catch((e) => log(`commit status failed: ${(e as Error).message}`));
  }

  if (report && review.request.postComment && !review.commentUrl) {
    try {
      const body = renderPrComment(report, url, { dismissedIds: dismissed, tests: results });
      const posted = await postPullRequestReview(github, repo.fullName, review.prNumber, body, v === "request_changes", REVIEW_SUPERSEDED[language]);
      await setReviewCommentUrl(db, reviewId, posted.url);
      log(`review ${reviewId}: PR review ${posted.requestedChanges ? "requesting changes" : "comment"} ${posted.url}`);
    } catch (e) {
      log(`PR comment failed: ${(e as Error).message}`);
    }
  }
}
