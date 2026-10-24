import { blockingFindings } from '@claudio/core';
import { findingStatuses, listReviewStats, type Repo, type ReviewStatItem } from '@claudio/db';
import { heatmap, pullState, reviewStats, weeklyHistory, type StatReview } from '#lib/overview.js';
import { swr } from './cache.js';
import { db } from './db.js';
import { DEMO_URL, demoPullRequest } from './demo.js';
import { StatsPending, type ChangeSummary, type ContributorWeeks, type Forge, type ForgeBranch } from '@claudio/forge';
import { forgeErrorMessage } from './forge.js';

const DAY = 86_400_000;
/** The chart and the tiles look back this far. */
export const HISTORY_WEEKS = 26;
export const STATS_DAYS = 90;
/** A branch without a pull request counts as active when its last commit is this recent. */
const ACTIVE_BRANCH_DAYS = 60;

async function withRatings(items: ReviewStatItem[]): Promise<StatReview[]> {
	const statuses = await findingStatuses(db(), items.map((r) => r.id));
	return items.map((r) => {
		const st = statuses.get(r.id) ?? new Map<string, string>();
		const ids = (status: string) => [...st].filter(([, s]) => s === status).map(([id]) => id);
		return { ...r, confirmed: ids('confirmed'), dismissed: ids('dismissed') };
	});
}

const errorOf = (e: unknown) => (e instanceof StatsPending ? null : forgeErrorMessage(e));

/**
 * Everything the repository's start page shows: open pull requests with the state
 * of their reviews, active branches without one, commits per contributor, the
 * review history and the numbers. GitHub or GitLab is asked through the short-lived
 * cache; the demo repository gets made-up data, marked as such.
 */
export async function loadOverview(repo: Repo, forge: Forge | null, isDemo: boolean, noToken: string) {
	const now = new Date();
	const pullsP = (async (): Promise<{ pulls: ChangeSummary[]; error: string | null }> => {
		if (isDemo) {
			const pr = demoPullRequest();
			return { pulls: [{ number: pr.number, title: pr.title, author: pr.author ?? null, headRef: pr.headRef, headSha: pr.headSha, draft: false, updatedAt: now.toISOString(), url: pr.url }], error: null };
		}
		if (!forge) return { pulls: [], error: noToken };
		return swr(`pulls:${repo.id}`, 30_000, 10 * 60_000, () => forge.listOpenChanges(repo)).then(
			(pulls) => ({ pulls, error: null }),
			(e) => ({ pulls: [], error: forgeErrorMessage(e) })
		);
	})();
	const branchesP = (async (): Promise<{ branches: ForgeBranch[]; defaultBranch: string | null; error: string | null }> => {
		if (isDemo) return { ...demoBranches(now), error: null };
		if (!forge) return { branches: [], defaultBranch: null, error: noToken };
		return swr(`branches:${repo.id}`, 60_000, 10 * 60_000, () => forge.recentBranches(repo)).then(
			(b) => ({ ...b, error: null }),
			(e) => ({ branches: [], defaultBranch: null, error: forgeErrorMessage(e) })
		);
	})();
	// GitHub computes these statistics in the background; until then it answers "come back later" (StatsPending).
	const contributorsP = (async (): Promise<{ contributors: ContributorWeeks[]; pending: boolean; error: string | null }> => {
		if (isDemo) return { contributors: demoContributors(now), pending: false, error: null };
		if (!forge) return { contributors: [], pending: false, error: noToken };
		return swr(`contributors:${repo.id}`, 30 * 60_000, 6 * 3_600_000, () => forge.contributorWeeks(repo)).then(
			(contributors) => ({ contributors, pending: false, error: null }),
			(e) => ({ contributors: [], pending: e instanceof StatsPending, error: errorOf(e) })
		);
	})();
	const historyP = listReviewStats(db(), repo.id, { since: new Date(now.getTime() - HISTORY_WEEKS * 7 * DAY) }).then(withRatings);

	const [{ pulls, error: pullsError }, branchData, contributorData, history] = await Promise.all([pullsP, branchesP, contributorsP, historyP]);
	const ofPulls = await listReviewStats(db(), repo.id, { prNumbers: pulls.map((p) => p.number) }).then(withRatings);

	const open = pulls.map((p) => {
		const { state, review } = pullState(p, ofPulls.filter((r) => r.prNumber === p.number));
		const dismissed = review?.dismissed ?? [];
		return {
			number: p.number,
			title: p.title,
			url: p.url,
			author: p.author,
			headRef: p.headRef,
			draft: p.draft,
			updatedAt: p.updatedAt,
			state,
			review: review
				? {
						id: review.id,
						at: new Date(review.createdAt).toISOString(),
						findings: review.report ? review.report.findings.length - dismissed.length : 0,
						blocking: review.report ? blockingFindings(review.report, review.report.request.strictness, dismissed).length : 0
					}
				: null
		};
	});
	const withPull = new Set(pulls.map((p) => p.headRef));
	const branches = branchData.branches
		.filter((b) => b.name !== branchData.defaultBranch && b.openPulls === 0 && !withPull.has(b.name))
		.filter((b) => b.committedAt && now.getTime() - Date.parse(b.committedAt) < ACTIVE_BRANCH_DAYS * DAY)
		.slice(0, 8);

	const heat = heatmap(contributorData.contributors);
	const recent = heat.all.counts.slice(-4).reduce((a, b) => a + b, 0);
	const activeContributors = heat.rows.filter((r) => r.counts.slice(-4).some((c) => c > 0)).length;

	return {
		demo: isDemo,
		demoUrl: isDemo ? DEMO_URL : null,
		pulls: open,
		pullsError,
		branches,
		branchesError: branchData.error,
		heatmap: { ...heat, pending: contributorData.pending, error: contributorData.error },
		history: weeklyHistory(history, HISTORY_WEEKS, now),
		stats: {
			...reviewStats(history, new Date(now.getTime() - STATS_DAYS * DAY)),
			openPulls: open.length,
			unreviewed: open.filter((p) => p.state === 'unreviewed').length,
			outdated: open.filter((p) => p.state === 'outdated').length,
			commits4w: contributorData.contributors.length ? recent : null,
			activeContributors4w: contributorData.contributors.length ? activeContributors : null,
			commitsYear: contributorData.contributors.length ? heat.all.total : null
		}
	};
}
export type OverviewData = Awaited<ReturnType<typeof loadOverview>>;

// ---- demo data for the offline demo repository (not on GitHub)

function random(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function demoContributors(now: Date): ContributorWeeks[] {
	const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
	const last = Math.floor(sunday.getTime() / 1000);
	const people: [string, number, number][] = [
		['demo-dev', 1, 6],
		['demo-qa', 2, 3],
		['demo-ux', 3, 2]
	];
	return people.map(([login, seed, rate]) => {
		const rnd = random(seed);
		return {
			login,
			avatarUrl: null,
			weeks: Array.from({ length: 60 }, (_, k) => {
				const busy = rnd() < 0.7;
				const c = busy ? Math.round(rnd() * rate * (k > 40 ? 1.6 : 1)) : 0;
				return { w: last - (59 - k) * 7 * 86_400, c, a: c * Math.round(20 + rnd() * 60), d: c * Math.round(5 + rnd() * 20) };
			})
		};
	});
}

function demoBranches(now: Date): { branches: ForgeBranch[]; defaultBranch: string } {
	const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
	return {
		defaultBranch: 'main',
		branches: [
			{ name: 'feature/fahrtenliste-export', sha: 'demo1', committedAt: ago(2), author: 'demo-dev', openPulls: 0 },
			{ name: 'fix/datum-zeitzone', sha: 'demo2', committedAt: ago(9), author: 'demo-qa', openPulls: 0 }
		]
	};
}
