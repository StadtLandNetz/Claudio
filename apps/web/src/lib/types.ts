import type { Provider, Verdict } from '@claudio/core';

export type ReviewSummary = {
	id: number;
	repo: string;
	/** Where the repository lives: #12 on GitHub, !12 on GitLab. */
	provider: Provider;
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
