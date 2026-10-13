import { blockingFindings, renderPrComment, verdict, withTests, type Verdict } from "@claudio/core";
import {
  dismissedFindingIds,
  getRepoById,
  getReview,
  getUser,
  setReviewCommentUrl,
  testResultsByReview,
  userAccessToken,
  type Db,
} from "@claudio/db";
import { createGithubClient, postPullRequestComment, setCommitStatus, type CommitState } from "@claudio/github";

const ACTIVE = new Set(["queued", "running"]);

const STATE: Record<Verdict, CommitState> = { approve: "success", request_changes: "failure", inconclusive: "error" };
const LABEL: Record<Verdict, string> = { approve: "Abnahme empfohlen", request_changes: "Änderungen nötig", inconclusive: "Review unvollständig" };

/**
 * Reports a review back to GitHub once it and its regression tests are done:
 * the commit status, and the PR comment if the review asked for one. Called
 * after the review and after each of its test runs; does nothing until all
 * are finished, and posts the comment only once.
 */
export async function finalizeReview(db: Db, reviewId: number, publicBaseUrl: string, log: (msg: string) => void): Promise<void> {
  const review = await getReview(db, reviewId);
  if (!review || ACTIVE.has(review.status) || review.fixture) return;
  const repo = await getRepoById(db, review.repoId);
  if (!repo) return;

  const tests = (await testResultsByReview(db, [reviewId])).get(reviewId) ?? [];
  const pendingTests = tests.filter((t) => ACTIVE.has(t.status)).length;
  const user = await getUser(db, repo.automationUserId ?? review.startedBy);
  const token = user ? userAccessToken(user) || null : null;
  if (!token) return;
  const github = createGithubClient(token);
  const url = publicBaseUrl ? `${publicBaseUrl}/reviews/${reviewId}` : undefined;
  const sha = review.headSha ?? review.report?.pr.headSha ?? null;
  const wantsStatus = Boolean(repo.automation?.commitStatus && sha);

  if (pendingTests > 0) {
    if (wantsStatus) {
      await setCommitStatus(github, repo.fullName, sha!, "pending", `Review fertig, ${pendingTests} Regressionstest(s) laufen noch`, url).catch((e) => log(`commit status failed: ${(e as Error).message}`));
    }
    return;
  }

  const report = review.report;
  const dismissed = (await dismissedFindingIds(db, [reviewId])).get(reviewId) ?? [];
  const results = tests.map((t) => ({ name: t.name, outcome: t.outcome }));
  const v: Verdict = report ? withTests(verdict(report, report.request.strictness, dismissed), results) : "inconclusive";

  if (wantsStatus) {
    const parts = report
      ? [
          `${report.acceptanceCriteria.filter((a) => a.status === "passed").length}/${report.acceptanceCriteria.length} Kriterien`,
          `${blockingFindings(report, report.request.strictness, dismissed).length} blockierend`,
          ...(tests.length ? [`Tests ${tests.filter((t) => t.outcome === "passed").length}/${tests.length}`] : []),
        ]
      : [review.error ?? review.status];
    await setCommitStatus(github, repo.fullName, sha!, STATE[v], `${LABEL[v]}: ${parts.join(", ")}`, url)
      .then(() => log(`review ${reviewId}: commit status ${STATE[v]}`))
      .catch((e) => log(`commit status failed: ${(e as Error).message}`));
  }

  if (report && review.request.postComment && !review.commentUrl) {
    try {
      const body = renderPrComment(report, url, { dismissedIds: dismissed, tests: results });
      const commentUrl = await postPullRequestComment(github, repo.fullName, review.prNumber, body);
      await setReviewCommentUrl(db, reviewId, commentUrl);
      log(`review ${reviewId}: PR comment ${commentUrl}`);
    } catch (e) {
      log(`PR comment failed: ${(e as Error).message}`);
    }
  }
}
