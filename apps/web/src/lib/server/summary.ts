import { blockingFindings, verdict, withTests, type ReportLike, type ReviewTestResult, type Strictness } from '@claudio/core';
import type { ReviewSummary } from '#lib/types.js';

export type { ReviewSummary };

/** A review row with at least the verdict's view of its report (a full report or a digest). */
export type ReviewLike = {
	id: number;
	repoFullName: string;
	prNumber: number;
	prTitle: string | null;
	status: string;
	report: ReportLike | null;
	costUsd: string | null;
	startedByLogin: string;
	createdAt: Date;
	finishedAt: Date | null;
};

/** List-row view of a review. The verdict honours dismissed findings and the chosen strictness. */
export function summarize(review: ReviewLike, dismissed: string[] = [], strictness?: Strictness, tests: ReviewTestResult[] = []): ReviewSummary {
	const report = review.report;
	const s = strictness ?? report?.request.strictness;
	return {
		id: review.id,
		repo: review.repoFullName,
		prNumber: review.prNumber,
		prTitle: review.prTitle,
		status: review.status,
		verdict: report ? withTests(verdict(report, s, dismissed), tests) : null,
		testsPassed: tests.filter((t) => t.outcome === 'passed').length,
		testsTotal: tests.length,
		acPassed: report?.acceptanceCriteria.filter((a) => a.status === 'passed').length ?? 0,
		acTotal: report?.acceptanceCriteria.length ?? 0,
		findings: report ? report.findings.length - report.findings.filter((f) => dismissed.includes(f.id)).length : 0,
		blocking: report ? blockingFindings(report, s, dismissed).length : 0,
		costUsd: review.costUsd,
		startedBy: review.startedByLogin,
		createdAt: review.createdAt,
		finishedAt: review.finishedAt
	};
}
