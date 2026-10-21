import { budgetState, costSummary } from '@claudio/db';
import { visibleRepos } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import type { PageServerLoad } from './$types';

type Cell = { runs: number; usd: number };
type RepoRow = { repo: string; review: Cell; analysis: Cell; test: Cell; total: number };

export const load: PageServerLoad = async ({ locals }) => {
	const { repos: visibleList } = await visibleRepos(locals.user!);
	const visible = new Set(visibleList.map((r) => r.fullName));
	// Repositories with a monthly cap: how much of it this month has used.
	const budgets = (
		await Promise.all(visibleList.filter((r) => r.monthlyBudgetUsd).map(async (r) => ({ repo: r.fullName, ...(await budgetState(db(), r)) })))
	).filter((b) => b.limit !== null);
	const since = new Date();
	since.setMonth(since.getMonth() - 11, 1);
	since.setHours(0, 0, 0, 0);
	const rows = (await costSummary(db(), since)).filter((r) => visible.has(r.repo));

	const months = new Map<string, Map<string, RepoRow>>();
	for (const r of rows) {
		const repos = months.get(r.month) ?? new Map<string, RepoRow>();
		const empty = (): Cell => ({ runs: 0, usd: 0 });
		const row = repos.get(r.repo) ?? { repo: r.repo, review: empty(), analysis: empty(), test: empty(), total: 0 };
		row[r.kind] = { runs: r.runs, usd: r.usd };
		row.total += r.usd;
		repos.set(r.repo, row);
		months.set(r.month, repos);
	}
	const result = [...months.entries()]
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([month, repos]) => {
			const list = [...repos.values()].sort((a, b) => b.total - a.total);
			return { month, repos: list, total: list.reduce((n, r) => n + r.total, 0), runs: list.reduce((n, r) => n + r.review.runs + r.analysis.runs + r.test.runs, 0) };
		});
	return { months: result, yearTotal: result.reduce((n, m) => n + m.total, 0), budgets };
};
