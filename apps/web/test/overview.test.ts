import { describe, expect, it } from 'vitest';
import { heatmap, pullState, reviewStats, weekStart, weeklyHistory, type StatReview } from '../src/lib/overview.js';
import { level } from '../src/lib/heat.js';

const review = (id: number, at: string, extra: Partial<StatReview> = {}, findings: StatReview['report'] extends infer R ? (R extends { findings: infer F } ? F : never) : never = []): StatReview => ({
	id,
	prNumber: 10 + (id % 3),
	status: 'completed',
	headSha: 'aaa',
	createdAt: at,
	startedAt: at,
	finishedAt: new Date(Date.parse(at) + 120_000).toISOString(),
	costUsd: '1.50',
	report: { status: 'completed', request: { strictness: 'normal' }, acceptanceCriteria: [{ status: 'passed' }], findings, rechecks: [], followUpOf: null },
	confirmed: [],
	dismissed: [],
	...extra
});

describe('weeks', () => {
	it('start on Monday (UTC)', () => {
		expect(weekStart(new Date('2026-10-22T15:00:00Z')).toISOString()).toBe('2026-10-19T00:00:00.000Z');
		expect(weekStart(new Date('2026-10-19T00:00:00Z')).toISOString()).toBe('2026-10-19T00:00:00.000Z');
		expect(weekStart(new Date('2026-10-25T23:59:00Z')).toISOString()).toBe('2026-10-19T00:00:00.000Z');
	});
	it('collect reviews, findings, dismissals and fixes per week', () => {
		const now = new Date('2026-10-22T12:00:00Z');
		const weeks = weeklyHistory(
			[
				review(1, '2026-10-20T10:00:00Z', { dismissed: ['F2'] }, [
					{ id: 'F1', severity: 'major', category: 'ux' },
					{ id: 'F2', severity: 'blocker', category: 'ux' }
				]),
				review(2, '2026-10-13T10:00:00Z', { report: { status: 'completed', request: { strictness: 'normal' }, acceptanceCriteria: [], findings: [], rechecks: ['fixed', 'still_open'], followUpOf: 1 } }),
				review(3, '2026-10-21T10:00:00Z', { status: 'aborted' })
			],
			3,
			now
		);
		expect(weeks.map((w) => w.start.slice(0, 10))).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
		expect(weeks[2]).toMatchObject({ reviews: 1, findings: 2, dismissed: 1, blocking: 1, approvals: 0 });
		expect(weeks[1]).toMatchObject({ reviews: 1, fixed: 1, approvals: 1 });
	});
});

describe('the tiles', () => {
	it('count rates over the finished reviews of the period', () => {
		const s = reviewStats(
			[
				review(1, '2026-10-20T10:00:00Z', { confirmed: ['F1'], dismissed: ['F2'] }, [
					{ id: 'F1', severity: 'major', category: 'ux' },
					{ id: 'F2', severity: 'minor', category: 'ux' },
					{ id: 'F3', severity: 'minor', category: 'security' }
				]),
				review(2, '2026-10-21T10:00:00Z', { report: { status: 'completed', request: { strictness: 'normal' }, acceptanceCriteria: [], findings: [], rechecks: ['fixed', 'still_open', 'not_rechecked'], followUpOf: 1 } }),
				review(3, '2025-01-01T10:00:00Z')
			],
			new Date('2026-10-01T00:00:00Z')
		);
		expect(s).toMatchObject({ reviews: 2, findingsPerReview: 1.5, fixed: 1, rechecked: 2, fixRate: 0.5, rated: 2, dismissRate: 0.5, avgCostUsd: 1.5, avgDurationMs: 120_000 });
		expect(s.topCategory).toEqual({ category: 'ux', share: 2 / 3 });
		expect(s.approvalRate).toBe(0.5);
	});
});

describe('open pull requests', () => {
	it('tell unreviewed, running, outdated and the verdict apart', () => {
		expect(pullState({ headSha: 'aaa' }, []).state).toBe('unreviewed');
		expect(pullState({ headSha: 'aaa' }, [review(2, '2026-10-21T10:00:00Z', { status: 'running', report: null }), review(1, '2026-10-20T10:00:00Z')]).state).toBe('running');
		expect(pullState({ headSha: 'bbb' }, [review(1, '2026-10-20T10:00:00Z')]).state).toBe('outdated');
		expect(pullState({ headSha: 'aaa' }, [review(1, '2026-10-20T10:00:00Z')]).state).toBe('approve');
	});
});

describe('the commit heatmap', () => {
	it('keeps the last weeks, the busiest contributors and a total row', () => {
		const W = 7 * 86_400;
		const weeks = (counts: number[]) => counts.map((c, k) => ({ w: 1000 * W + k * W, c, a: c * 10, d: c }));
		const h = heatmap(
			[
				{ login: 'anna', avatarUrl: null, weeks: weeks([1, 0, 4, 2]) },
				{ login: 'ben', avatarUrl: null, weeks: weeks([0, 0, 0, 1]) },
				{ login: 'idle', avatarUrl: null, weeks: weeks([0, 0, 0, 0]) }
			],
			3,
			1
		);
		expect(h.rows.map((r) => [r.login, r.counts])).toEqual([['anna', [0, 4, 2]]]);
		expect(h.all.counts).toEqual([0, 4, 3]);
		expect(h.hidden).toBe(1);
		expect([level(0, 4), level(1, 4), level(2, 4), level(3, 4), level(4, 4)]).toEqual([0, 1, 2, 3, 4]);
	});
});
