import { blockingFindings, verdict, type ReportLike, type Severity } from '@claudio/core';

/** A review as the repository overview counts it, with how people rated its findings. */
export type StatReview = {
	id: number;
	prNumber: number;
	status: string;
	headSha: string | null;
	createdAt: Date | string;
	startedAt: Date | string | null;
	finishedAt: Date | string | null;
	costUsd: string | null;
	report:
		| (ReportLike & {
				findings: { id: string; severity: Severity; category: string }[];
				rechecks: string[];
				followUpOf: number | null;
			})
		| null;
	confirmed: string[];
	dismissed: string[];
};

const FINISHED = new Set(['completed', 'budget_exceeded', 'max_turns']);
const DAY = 86_400_000;
const time = (d: Date | string) => (typeof d === 'string' ? Date.parse(d) : d.getTime());
const finished = (r: StatReview) => FINISHED.has(r.status) && r.report !== null;

/** Monday 00:00 UTC of the week that contains `d`. */
export function weekStart(d: Date): Date {
	const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY);
}

export type WeekBucket = { start: string; reviews: number; findings: number; blocking: number; dismissed: number; fixed: number; approvals: number };

/** The last `weeks` weeks, oldest first: finished reviews, their findings (blocking, dismissed) and what re-reviews found fixed. */
export function weeklyHistory(reviews: StatReview[], weeks: number, now = new Date()): WeekBucket[] {
	const last = weekStart(now).getTime();
	const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, k) => ({
		start: new Date(last - (weeks - 1 - k) * 7 * DAY).toISOString(),
		reviews: 0,
		findings: 0,
		blocking: 0,
		dismissed: 0,
		fixed: 0,
		approvals: 0
	}));
	for (const r of reviews) {
		if (!finished(r)) continue;
		const k = weeks - 1 - Math.floor((last - weekStart(new Date(time(r.createdAt))).getTime()) / (7 * DAY));
		const b = buckets[k];
		if (!b) continue;
		const report = r.report!;
		b.reviews++;
		b.findings += report.findings.length;
		b.dismissed += report.findings.filter((f) => r.dismissed.includes(f.id)).length;
		b.blocking += blockingFindings(report, report.request.strictness, r.dismissed).length;
		b.fixed += report.rechecks.filter((s) => s === 'fixed').length;
		if (verdict(report, report.request.strictness, r.dismissed) === 'approve') b.approvals++;
	}
	return buckets;
}

export type RepoStats = {
	reviews: number;
	pulls: number;
	findingsPerReview: number | null;
	approvalRate: number | null;
	fixed: number;
	rechecked: number;
	fixRate: number | null;
	rated: number;
	dismissed: number;
	dismissRate: number | null;
	avgCostUsd: number | null;
	totalCostUsd: number;
	avgDurationMs: number | null;
	topCategory: { category: string; share: number } | null;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** The numbers of the overview tiles, over the finished reviews since `since`. */
export function reviewStats(all: StatReview[], since: Date): RepoStats {
	const reviews = all.filter((r) => finished(r) && time(r.createdAt) >= since.getTime());
	const reports = reviews.map((r) => ({ r, report: r.report! }));
	const findings = reports.reduce((n, { report }) => n + report.findings.length, 0);
	const approvals = reports.filter(({ r, report }) => verdict(report, report.request.strictness, r.dismissed) === 'approve').length;
	const rechecks = reports.flatMap(({ report }) => report.rechecks);
	const fixed = rechecks.filter((s) => s === 'fixed').length;
	const dismissed = reviews.reduce((n, r) => n + r.dismissed.length, 0);
	const rated = dismissed + reviews.reduce((n, r) => n + r.confirmed.length, 0);
	const costs = reviews.map((r) => Number(r.costUsd)).filter((v) => Number.isFinite(v) && v > 0);
	const durations = reviews.flatMap((r) => (r.startedAt && r.finishedAt ? [time(r.finishedAt) - time(r.startedAt)] : [])).filter((ms) => ms > 0);
	const categories = new Map<string, number>();
	for (const { report } of reports) for (const f of report.findings) categories.set(f.category, (categories.get(f.category) ?? 0) + 1);
	const top = [...categories].sort((a, b) => b[1] - a[1])[0];
	return {
		reviews: reviews.length,
		pulls: new Set(reviews.map((r) => r.prNumber)).size,
		findingsPerReview: ratio(findings, reviews.length),
		approvalRate: ratio(approvals, reviews.length),
		fixed,
		rechecked: rechecks.filter((s) => s !== 'not_rechecked').length,
		fixRate: ratio(fixed, rechecks.filter((s) => s !== 'not_rechecked').length),
		rated,
		dismissed,
		dismissRate: ratio(dismissed, rated),
		avgCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
		totalCostUsd: costs.reduce((a, b) => a + b, 0),
		avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
		topCategory: top ? { category: top[0], share: top[1] / findings } : null
	};
}

/** Where a pull request stands: never reviewed, being reviewed, reviewed on an older commit, or the verdict of its latest review. */
export type PullState = 'unreviewed' | 'running' | 'outdated' | 'approve' | 'request_changes' | 'inconclusive';

export function pullState(pr: { headSha?: string | null }, reviewsOfPr: StatReview[]): { state: PullState; review: StatReview | null } {
	const latest = reviewsOfPr[0] ?? null;
	if (!latest) return { state: 'unreviewed', review: null };
	if (latest.status === 'queued' || latest.status === 'running') return { state: 'running', review: latest };
	const done = reviewsOfPr.find(finished);
	if (!done) return { state: 'unreviewed', review: latest };
	if (pr.headSha && done.headSha && pr.headSha !== done.headSha) return { state: 'outdated', review: done };
	return { state: verdict(done.report!, done.report!.request.strictness, done.dismissed), review: done };
}

/** One row of the commit heatmap: commits (and lines) per week. */
export type HeatRow = { login: string; avatarUrl: string | null; total: number; counts: number[]; additions: number; deletions: number };
type Contributor = { login: string; avatarUrl: string | null; weeks: { w: number; c: number; a: number; d: number }[] };

/**
 * The last `weeks` weeks of every contributor, the `top` most active as rows and
 * everyone together as the first row. Weeks start on Sunday, as GitHub counts them.
 */
export function heatmap(contributors: Contributor[], weeks = 52, top = 8): { weekStarts: number[]; all: HeatRow; rows: HeatRow[]; hidden: number } {
	const latest = Math.max(0, ...contributors.flatMap((c) => c.weeks.map((w) => w.w)));
	const weekStarts = Array.from({ length: weeks }, (_, k) => latest - (weeks - 1 - k) * 7 * 86_400);
	const index = new Map(weekStarts.map((w, k) => [w, k]));
	const rows = contributors
		.map((c) => {
			const counts = weekStarts.map(() => 0);
			let additions = 0;
			let deletions = 0;
			for (const w of c.weeks) {
				const k = index.get(w.w);
				if (k === undefined) continue;
				counts[k] += w.c;
				additions += w.a;
				deletions += w.d;
			}
			return { login: c.login, avatarUrl: c.avatarUrl, total: counts.reduce((a, b) => a + b, 0), counts, additions, deletions };
		})
		.filter((r) => r.total > 0)
		.sort((a, b) => b.total - a.total);
	const all: HeatRow = {
		login: '',
		avatarUrl: null,
		total: rows.reduce((n, r) => n + r.total, 0),
		counts: weekStarts.map((_, k) => rows.reduce((n, r) => n + r.counts[k]!, 0)),
		additions: rows.reduce((n, r) => n + r.additions, 0),
		deletions: rows.reduce((n, r) => n + r.deletions, 0)
	};
	return { weekStarts, all, rows: rows.slice(0, top), hidden: Math.max(0, rows.length - top) };
}
