import { describe, expect, it } from 'vitest';
import { CRITERIA, FILES, FIRST_RUN_FINDINGS, PR, RECHECK_FINDINGS, impactOf, outcome, selectTests } from '../src/lib/landing/scenario.js';

const picked = (changed: string[]) => selectTests(changed).selection.selected.map((t) => t.name);

describe('landing demo: impact and test selection', () => {
	it('follows a shared component to every page that uses it', () => {
		const impact = impactOf(['src/lib/format.ts']);
		expect(impact.routes.map((r) => r.pattern)).toEqual(['/trips', '/trips/new', '/vehicles/[id]']);
		expect(impact.routes.find((r) => r.pattern === '/trips')?.via).toEqual(['src/lib/format.ts', 'src/lib/components/TripTable.svelte', 'src/routes/trips/+page.svelte']);
		expect(picked(['src/lib/format.ts'])).toEqual(['trip-create', 'trip-search', 'vehicle-trips']);
	});

	it('marks a changed route file as direct', () => {
		const impact = impactOf(['src/routes/api/trips/+server.ts']);
		expect(impact.routes).toEqual([{ pattern: '/api/trips', kind: 'endpoint', direct: true, via: ['src/routes/api/trips/+server.ts'] }]);
		expect(picked(['src/routes/api/trips/+server.ts'])).toEqual(['api-export']);
	});

	it('runs every test for a layout and for a global change', () => {
		expect(picked(['src/lib/components/Nav.svelte'])).toHaveLength(6);
		const hooks = selectTests(['src/hooks.server.ts']).selection;
		expect(hooks.all).toBe('global_change');
		expect(hooks.selected).toHaveLength(6);
	});

	it('runs no test for documentation', () => {
		const { impact, selection } = selectTests(['README.md']);
		expect(impact.routes).toEqual([]);
		expect(impact.unmapped).toEqual([]);
		expect(selection.selected).toEqual([]);
	});

	it('picks four of six tests for the pull request of the flow demo', () => {
		expect(picked(PR.files.map((f) => f.path))).toEqual(['trip-create', 'trip-search', 'vehicle-trips', 'api-export']);
	});

	it('draws every import between neighbouring columns', () => {
		const column = { lib: 0, components: 1, routes: 2, special: -1 };
		for (const f of FILES) for (const dep of f.imports) expect(column[f.tier] - column[FILES.find((g) => g.path === dep)!.tier], `${dep} → ${f.path}`).toBe(1);
	});
});

describe('landing demo: verdict', () => {
	it('blocks the first run with five findings and three unmet criteria', () => {
		const o = outcome('de', CRITERIA.map((c) => c.status), FIRST_RUN_FINDINGS, 'normal');
		expect(o.verdict).toBe('request_changes');
		expect(o.blocking).toHaveLength(5);
		expect(o.acPassed).toBe(3);
	});

	it('lets strictness and dismissals decide the re-review', () => {
		const passed = CRITERIA.map(() => 'passed' as const);
		expect(outcome('de', passed, RECHECK_FINDINGS, 'lenient').verdict).toBe('approve');
		expect(outcome('de', passed, RECHECK_FINDINGS, 'normal').verdict).toBe('request_changes');
		expect(outcome('de', passed, RECHECK_FINDINGS, 'normal', ['r1']).verdict).toBe('approve');
		expect(outcome('de', passed, RECHECK_FINDINGS, 'strict', ['r1']).blocking).toEqual(['r2', 'r3', 'r4']);
	});
});
