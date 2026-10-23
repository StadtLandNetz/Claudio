import type { Severity } from '@claudio/core';

/** A finding of one review, as the history compares it. */
export type HistFinding = {
	id: string;
	title: string;
	severity: Severity;
	category: string;
	url?: string;
	acceptanceCriterion?: string;
	previous?: { reviewId: number; findingId: string; status: 'still_open' | 'not_rechecked' };
	rating: 'proposed' | 'confirmed' | 'dismissed';
	blocking: boolean;
};

/** One review of the pull request in the history, oldest first. */
export type HistReview = {
	id: number;
	at: string;
	verdict: 'approve' | 'request_changes' | 'inconclusive';
	/** The review this one re-checked, and which of its findings it found fixed. */
	followUpOf: number | null;
	fixed: string[];
	findings: HistFinding[];
};

/** How a finding relates to the review before: new, again (also there), still open (a re-check said so), back (seen earlier, not in the one before). */
export type Relation = 'new' | 'again' | 'still_open' | 'back';

export type HistoryRow = {
	/** The same problem across reviews keeps its key, so rows stay put while you move along the timeline. */
	key: string;
	f: HistFinding;
	rel: Relation;
	/** Where it was reported before, if anywhere. */
	was: { reviewId: number; findingId: string } | null;
	/** Whether this problem was reported in each review of the history (same order). */
	seen: boolean[];
};

export type GoneRow = { key: string; f: HistFinding; fixed: boolean; seen: boolean[] };

export type HistoryStep = { review: HistReview; prev: HistReview | null; rows: HistoryRow[]; gone: GoneRow[] };

const STOP = new Set(
	'der die das den dem des und oder mit wird werden wurde ist sind ein eine einer eines einem bei beim für zum zur auf aus von vom nach als auch nicht noch nur the and with for are not from that this into when has have was'.split(' ')
);

function tokens(text: string): string[] {
	return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

// Words count as the same when equal or when they share a long stem ("Vergangenheit" / "vergangenes", "Pflicht" / "Pflichtfeld").
function sameWord(a: string, b: string): boolean {
	if (a === b) return true;
	const short = a.length <= b.length ? a : b;
	const long = short === a ? b : a;
	if (short.length >= 5 && long.startsWith(short)) return true;
	let k = 0;
	while (k < short.length && a[k] === b[k]) k++;
	return k >= 6;
}

/** How alike two findings are, 0 to about 1.2: shared title words, plus the same category, page or criterion. */
export function similarity(a: Pick<HistFinding, 'title' | 'category' | 'url' | 'acceptanceCriterion'>, b: typeof a): number {
	const ta = tokens(a.title);
	const tb = tokens(b.title);
	if (!ta.length || !tb.length) return 0;
	const hits = ta.filter((w) => tb.some((v) => sameWord(w, v))).length;
	let score = (2 * hits) / (ta.length + tb.length);
	if (a.category === b.category) score += 0.1;
	const path = (u?: string) => (u ? u.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0] : '');
	if (path(a.url) && path(a.url) === path(b.url)) score += 0.1;
	if (a.acceptanceCriterion && a.acceptanceCriterion === b.acceptanceCriterion) score += 0.1;
	return score;
}

export const SIMILAR_ENOUGH = 0.55;

/**
 * Follows each problem through the reviews of a pull request. A re-review names
 * the findings it continues; otherwise findings are matched by similar titles,
 * first against the review before, then against problems seen earlier.
 */
export function buildHistory(reviews: HistReview[]): HistoryStep[] {
	// Every wording a problem had so far counts when matching, not only the latest.
	type Lineage = { key: string; versions: HistFinding[]; lastReview: number; lastFindingId: string; seen: boolean[] };
	const lineages: Lineage[] = [];
	const byFinding = new Map<string, Lineage>();
	const at = (rid: number, fid: string) => `${rid}:${fid}`;
	const perReview: { lin: Lineage; f: HistFinding }[][] = [];

	reviews.forEach((r, idx) => {
		const prev = idx > 0 ? reviews[idx - 1]! : null;
		const taken = new Set<Lineage>();
		const assigned: { lin: Lineage; f: HistFinding }[] = [];
		const open: HistFinding[] = [];
		// 1. Explicit links from a re-review.
		for (const f of r.findings) {
			const lin = f.previous ? byFinding.get(at(f.previous.reviewId, f.previous.findingId)) : undefined;
			if (lin && !taken.has(lin)) {
				taken.add(lin);
				assigned.push({ lin, f });
			} else open.push(f);
		}
		// 2. Similar titles: the review before first, then anything seen earlier; best pairs first.
		const pool = (onlyPrev: boolean) => lineages.filter((l) => !taken.has(l) && (onlyPrev ? prev && l.lastReview === prev.id : true));
		for (const onlyPrev of [true, false]) {
			const pairs = open
				.flatMap((f) => pool(onlyPrev).map((lin) => ({ f, lin, score: Math.max(...lin.versions.map((v) => similarity(f, v))) })))
				.filter((p) => p.score >= SIMILAR_ENOUGH)
				.sort((a, b) => b.score - a.score);
			for (const p of pairs) {
				if (taken.has(p.lin) || !open.includes(p.f)) continue;
				taken.add(p.lin);
				open.splice(open.indexOf(p.f), 1);
				assigned.push({ lin: p.lin, f: p.f });
			}
		}
		// 3. Whatever is left is new.
		for (const f of open) {
			const lin: Lineage = { key: `L${lineages.length + 1}`, versions: [], lastReview: r.id, lastFindingId: f.id, seen: reviews.map(() => false) };
			lineages.push(lin);
			assigned.push({ lin, f });
		}
		for (const a of assigned) {
			a.lin.seen[idx] = true;
			byFinding.set(at(r.id, a.f.id), a.lin);
		}
		perReview.push(assigned);
		// Remember this wording of each problem for the next reviews.
		for (const a of assigned) {
			a.lin.versions.push(a.f);
			a.lin.lastReview = r.id;
			a.lin.lastFindingId = a.f.id;
		}
	});

	// Second pass: with every lineage complete, describe each review against the one before.
	const findingOf = new Map<string, { reviewIdx: number; f: HistFinding }>();
	perReview.forEach((list, idx) => list.forEach(({ lin, f }) => findingOf.set(`${lin.key}@${idx}`, { reviewIdx: idx, f })));
	return reviews.map((review, idx) => {
		const prev = idx > 0 ? reviews[idx - 1]! : null;
		const rows: HistoryRow[] = perReview[idx]!.map(({ lin, f }) => {
			const before = prev ? findingOf.get(`${lin.key}@${idx - 1}`) : undefined;
			let earlier: { reviewIdx: number; f: HistFinding } | undefined;
			for (let k = idx - 1; k >= 0 && !earlier; k--) earlier = findingOf.get(`${lin.key}@${k}`);
			const rel: Relation = before ? (f.previous?.status === 'still_open' ? 'still_open' : 'again') : earlier ? 'back' : 'new';
			const was = earlier ? { reviewId: reviews[earlier.reviewIdx]!.id, findingId: earlier.f.id } : null;
			return { key: lin.key, f, rel, was, seen: lin.seen };
		});
		const here = new Set(perReview[idx]!.map((a) => a.lin.key));
		const gone: GoneRow[] = prev
			? perReview[idx - 1]!
					.filter((a) => !here.has(a.lin.key))
					.map(({ lin, f }) => ({ key: lin.key, f, fixed: review.followUpOf === prev.id && review.fixed.includes(f.id), seen: lin.seen }))
			: [];
		return { review, prev, rows, gone };
	});
}

/** What a review says about a problem: reported (and not dismissed), dismissed, fixed by a re-review, gone (no longer reported), or nothing. */
export type CellState = 'open' | 'dismissed' | 'fixed' | 'gone' | 'none';
export type MatrixCell = { state: CellState; f: HistFinding | null };
/** One problem through all reviews; `first` is the review it first appeared in. */
export type MatrixRow = { key: string; first: number; cells: MatrixCell[] };

const RANK: Record<Severity, number> = { blocker: 3, major: 2, minor: 1, suggestion: 0 };

/**
 * The comparison as a table: a row per problem, a column per review. A problem
 * shows where it was reported, and in the review after its last report whether
 * that review fixed it or simply did not report it any more.
 */
export function buildMatrix(reviews: HistReview[]): { rows: MatrixRow[]; steps: HistoryStep[] } {
	const steps = buildHistory(reviews);
	const rows = new Map<string, MatrixRow>();
	const rowOf = (key: string, idx: number) => {
		let row = rows.get(key);
		if (!row) {
			row = { key, first: idx, cells: reviews.map(() => ({ state: 'none' as CellState, f: null })) };
			rows.set(key, row);
		}
		return row;
	};
	steps.forEach((st, idx) => {
		for (const r of st.rows) rowOf(r.key, idx).cells[idx] = { state: r.f.rating === 'dismissed' ? 'dismissed' : 'open', f: r.f };
		for (const g of st.gone) rowOf(g.key, idx).cells[idx] = { state: g.fixed ? 'fixed' : 'gone', f: g.f };
	});
	const firstFinding = (row: MatrixRow) => row.cells.find((c) => c.f)!.f!;
	return {
		steps,
		rows: [...rows.values()].sort((a, b) => a.first - b.first || RANK[firstFinding(b).severity] - RANK[firstFinding(a).severity])
	};
}
