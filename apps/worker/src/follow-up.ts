import { criterionText, type FollowUpContext } from "@claudio/core";
import { getReview, listFindings, type Db, type Review } from "@claudio/db";
import type { Forge } from "@claudio/forge";

/**
 * What a re-review builds on: the earlier review's open findings with the people's
 * rating, its criteria, and the files changed since the commit it checked. Null when
 * the earlier review is gone, belongs to another pull request or has no report.
 */
export async function followUpContext(db: Db, review: Review, forge: Forge | null, log: (msg: string) => void): Promise<FollowUpContext | null> {
  const prevId = review.request.followUpOf;
  if (!prevId) return null;
  const prev = await getReview(db, prevId);
  if (!prev || prev.repoId !== review.repoId || prev.prNumber !== review.prNumber || !prev.report) {
    log(`re-review: review #${prevId} cannot be used (missing, other pull request or no report); reviewing in full`);
    return null;
  }
  const report = prev.report;
  const ratings = new Map((await listFindings(db, prev.id)).map((r) => [r.finding.findingId, r.finding]));
  const dismissed = report.findings.filter((f) => ratings.get(f.id)?.status === "dismissed");
  const open = report.findings
    .filter((f) => ratings.get(f.id)?.status !== "dismissed")
    .map((f) => ({ ...f, rating: ratings.get(f.id)?.status === "confirmed" ? ("confirmed" as const) : ("proposed" as const), comment: ratings.get(f.id)?.comment ?? null }));

  const headSha = prev.headSha ?? report.pr.headSha ?? undefined;
  let changedFiles: string[] | null = null;
  if (headSha && forge && !review.fixture) {
    try {
      const diff = await forge.changedFilesBetween({ fullName: review.request.repo }, headSha, review.headSha ?? report.pr.headRef);
      changedFiles = diff.truncated ? null : diff.files.map((f) => f.filename);
    } catch (e) {
      log(`re-review: could not compare ${headSha.slice(0, 7)} with the branch: ${(e as Error).message}`);
    }
  }
  return {
    reviewId: prev.id,
    headSha,
    changedFiles,
    summary: report.summary,
    criteria: report.acceptanceCriteria.map((a) => ({ criterion: criterionText(a.criterion), status: a.status, notes: a.notes })),
    findings: open,
    dismissed: dismissed.map((f) => f.title),
  };
}
