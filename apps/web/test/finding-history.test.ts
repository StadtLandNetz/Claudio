import { describe, expect, it } from 'vitest';
import { buildHistory, similarity, SIMILAR_ENOUGH, type HistFinding, type HistReview } from '../src/lib/finding-history.js';

const f = (id: string, title: string, extra: Partial<HistFinding> = {}): HistFinding => ({
	id,
	title,
	severity: 'major',
	category: 'acceptance',
	rating: 'proposed',
	blocking: true,
	...extra
});
const r = (id: number, findings: HistFinding[], extra: Partial<HistReview> = {}): HistReview => ({
	id,
	at: `2026-10-${10 + id}T10:00:00Z`,
	verdict: 'request_changes',
	followUpOf: null,
	fixed: [],
	findings,
	...extra
});

describe('similarity of findings', () => {
	it('matches the same problem in other words', () => {
		expect(similarity(f('a', 'Fahrzeug-Feld fehlt im Formular (Pflichtfeld laut AC)'), f('b', 'Fahrzeug-Feld (Pflicht) fehlt im Formular'))).toBeGreaterThan(SIMILAR_ENOUGH);
		expect(similarity(f('a', 'Suche in der Fahrtenliste liefert HTTP 500'), f('b', 'Suche in der Fahrtenliste: jede Suche endet mit HTTP 500 "Interner Fehler"'))).toBeGreaterThan(SIMILAR_ENOUGH);
	});
	it('keeps different problems apart', () => {
		expect(similarity(f('a', 'Suche liefert HTTP 500'), f('b', 'Vergangenes Datum wird ohne Fehlermeldung gespeichert'))).toBeLessThan(SIMILAR_ENOUGH);
	});
});

describe('findings across the reviews of a pull request', () => {
	it('marks new, again, gone and back, and keeps one key per problem', () => {
		const steps = buildHistory([
			r(1, [f('F1', 'Suche liefert HTTP 500'), f('F2', 'Datum in der Vergangenheit wird akzeptiert')]),
			r(2, [f('F1', 'Suche in der Fahrtenliste liefert HTTP 500'), f('F2', 'Button heißt Senden statt Speichern', { category: 'ux' })]),
			r(3, [f('F1', 'Datum in der Vergangenheit wird akzeptiert (keine Validierung)')])
		]);
		expect(steps[0]!.rows.map((x) => x.rel)).toEqual(['new', 'new']);
		expect(steps[0]!.gone).toEqual([]);

		const two = steps[1]!;
		expect(two.rows.map((x) => [x.f.id, x.rel])).toEqual([
			['F1', 'again'],
			['F2', 'new']
		]);
		expect(two.rows[0]!.was).toEqual({ reviewId: 1, findingId: 'F1' });
		expect(two.gone.map((g) => g.f.title)).toEqual(['Datum in der Vergangenheit wird akzeptiert']);

		const three = steps[2]!;
		expect(three.rows[0]!.rel).toBe('back');
		expect(three.rows[0]!.key).toBe(two.gone[0]!.key);
		expect(three.rows[0]!.seen).toEqual([true, false, true]);
		expect(three.gone.map((g) => g.f.id).sort()).toEqual(['F1', 'F2']);
	});

	it('follows the links of a re-review and its fixes', () => {
		const steps = buildHistory([
			r(16, [f('F1', 'Formular hat kein Pflichtfeld Fahrzeug'), f('F2', 'XSS in der Liste')]),
			r(17, [f('F1', 'Ganz anders formuliert', { previous: { reviewId: 16, findingId: 'F1', status: 'still_open' } })], { followUpOf: 16, fixed: ['F2'] })
		]);
		const fu = steps[1]!;
		expect(fu.rows[0]).toMatchObject({ rel: 'still_open', was: { reviewId: 16, findingId: 'F1' } });
		expect(fu.gone).toEqual([expect.objectContaining({ fixed: true, f: expect.objectContaining({ id: 'F2' }) })]);
	});
});

describe('the comparison table', () => {
	it('has a row per problem with its state in every review', async () => {
		const { buildMatrix } = await import('../src/lib/finding-history.js');
		const { rows } = buildMatrix([
			r(16, [f('F1', 'Formular hat kein Pflichtfeld Fahrzeug'), f('F2', 'XSS in der Liste'), f('F3', 'Suche liefert HTTP 500')]),
			r(17, [f('F1', 'Anders formuliert', { previous: { reviewId: 16, findingId: 'F1', status: 'still_open' }, rating: 'dismissed' })], { followUpOf: 16, fixed: ['F2'] }),
			r(18, [f('F1', 'Formular hat kein Pflichtfeld Fahrzeug')])
		]);
		const states = rows.map((row) => row.cells.map((c) => c.state));
		expect(states).toEqual([
			['open', 'dismissed', 'open'],
			['open', 'fixed', 'none'],
			['open', 'gone', 'none']
		]);
	});
});
