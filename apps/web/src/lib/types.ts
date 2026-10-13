import type { Verdict } from '@claudio/core';

export type ReviewSummary = {
	id: number;
	repo: string;
	prNumber: number;
	prTitle: string | null;
	status: string;
	verdict: Verdict | null;
	acPassed: number;
	acTotal: number;
	findings: number;
	testsPassed: number;
	testsTotal: number;
	blocking: number;
	costUsd: string | null;
	startedBy: string;
	createdAt: Date;
	finishedAt: Date | null;
};
