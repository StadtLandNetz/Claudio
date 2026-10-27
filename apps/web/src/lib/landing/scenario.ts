import {
	blockingFindings,
	isGlobalChange,
	isInertFile,
	renderCommitStatus,
	selectReviewTests,
	sveltekitRouteOf,
	verdict,
	type Impact,
	type ImpactRoute,
	type SelectableTest,
	type Severity,
	type Strictness
} from '@claudio/core';
import type { Locale } from '#lib/i18n/index.js';

/**
 * Example data for the demos on the public page, modelled on the demo app
 * (apps/demo-target, PR #17 "Neue Fahrt anlegen und Suche"). The demos run
 * Claudio's own rules from @claudio/core on it: route detection, test
 * selection, verdict and commit status.
 */
export type Text = Record<Locale, string>;

export type Tier = 'lib' | 'components' | 'routes' | 'special';
export type DemoFile = { path: string; tier: Tier; imports: string[] };

/**
 * A small SvelteKit app: two helpers, three components and a server module,
 * five route files, plus a hook and the README. Every import goes one column
 * to the right, so the graph draws without crossings.
 */
export const FILES: DemoFile[] = [
	{ path: 'src/lib/format.ts', tier: 'lib', imports: [] },
	{ path: 'src/lib/search.ts', tier: 'lib', imports: [] },
	{ path: 'src/lib/components/Nav.svelte', tier: 'components', imports: [] },
	{ path: 'src/lib/components/TripForm.svelte', tier: 'components', imports: ['src/lib/format.ts'] },
	{ path: 'src/lib/components/TripTable.svelte', tier: 'components', imports: ['src/lib/format.ts', 'src/lib/search.ts'] },
	{ path: 'src/lib/server/trips.ts', tier: 'components', imports: ['src/lib/search.ts'] },
	{ path: 'src/routes/+layout.svelte', tier: 'routes', imports: ['src/lib/components/Nav.svelte'] },
	{ path: 'src/routes/trips/new/+page.svelte', tier: 'routes', imports: ['src/lib/components/TripForm.svelte'] },
	{ path: 'src/routes/trips/+page.svelte', tier: 'routes', imports: ['src/lib/components/TripTable.svelte'] },
	{ path: 'src/routes/vehicles/[id]/+page.svelte', tier: 'routes', imports: ['src/lib/components/TripTable.svelte'] },
	{ path: 'src/routes/api/trips/+server.ts', tier: 'routes', imports: ['src/lib/server/trips.ts'] },
	{ path: 'src/hooks.server.ts', tier: 'special', imports: [] },
	{ path: 'README.md', tier: 'special', imports: [] }
];

/** The name shown on a file: its path below src/routes or src/lib (components by their file name). */
export function fileLabel(path: string): string {
	const below = /(?:^|\/)src\/(?:routes|lib(?:\/components)?)\/(.*)$/.exec(path);
	return below ? below[1]! : path.split('/').pop()!;
}

const importersOf = (file: string) => FILES.filter((f) => f.imports.includes(file)).map((f) => f.path);

/**
 * The impact of changing some of the example files, by the same rules as
 * computeImpact in packages/agent/src/impact.ts: breadth-first over the
 * importers up to the first route file, hooks and config count for every
 * route, docs for none. That one reads a checkout from disk, so it cannot run here.
 */
export function impactOf(changed: readonly string[]): Impact {
	const routes = new Map<string, ImpactRoute>();
	const global: Impact['global'] = [];
	const unmapped: string[] = [];
	let ignored = 0;

	const addRoute = (file: string, via: string[], direct: boolean) => {
		const r = sveltekitRouteOf(file)!;
		const key = `${r.kind} ${r.pattern}`;
		const known = routes.get(key);
		if (!known || (direct && !known.direct) || (direct === known.direct && via.length < known.via.length)) routes.set(key, { ...r, direct: direct || Boolean(known?.direct), via });
	};

	for (const source of changed) {
		if (isGlobalChange(source)) {
			global.push({ file: source, via: [source] });
			continue;
		}
		const isRoute = sveltekitRouteOf(source) !== null;
		if (isRoute) addRoute(source, [source], true);
		else if (isInertFile(source)) {
			ignored++;
			continue;
		}
		let reached = isRoute;
		const seen = new Set([source]);
		const queue: string[][] = [[source]];
		while (queue.length) {
			const chain = queue.shift()!;
			for (const importer of importersOf(chain.at(-1)!)) {
				if (seen.has(importer)) continue;
				seen.add(importer);
				const via = [...chain, importer];
				if (isGlobalChange(importer)) {
					global.push({ file: source, via });
					reached = true;
				} else if (sveltekitRouteOf(importer)) {
					addRoute(importer, via, false);
					reached = true;
				} else if (!isInertFile(importer)) queue.push(via);
			}
		}
		if (!reached) unmapped.push(source);
	}

	return {
		framework: 'sveltekit',
		routes: [...routes.values()].sort((a, b) => Number(b.direct) - Number(a.direct) || a.pattern.localeCompare(b.pattern)),
		global,
		unmapped,
		stats: { files: FILES.length, imports: FILES.reduce((n, f) => n + f.imports.length, 0), ignored, ms: 0 }
	};
}

/** The example's regression tests with the paths their earlier runs opened. */
export const TESTS: (SelectableTest & { title: Text })[] = [
	{ id: 1, name: 'trip-create', title: { de: 'Fahrt anlegen', en: 'Create a trip' }, touchedPaths: ['/trips', '/trips/new'], steps: null },
	{ id: 2, name: 'trip-search', title: { de: 'Fahrten suchen', en: 'Search trips' }, touchedPaths: ['/trips'], steps: null },
	{ id: 3, name: 'vehicle-trips', title: { de: 'Fahrten eines Fahrzeugs', en: 'Trips of a vehicle' }, touchedPaths: ['/vehicles/7'], steps: null },
	{ id: 4, name: 'api-export', title: { de: 'Export über die API', en: 'Export via the API' }, touchedPaths: ['/api/trips'], steps: null },
	{ id: 5, name: 'login', title: { de: 'Anmelden als Disponent', en: 'Sign in as dispatcher' }, touchedPaths: ['/login'], steps: null },
	{ id: 6, name: 'profile', title: { de: 'Profil ändern', en: 'Edit the profile' }, touchedPaths: ['/profile'], steps: null }
];

export function selectTests(changed: readonly string[]) {
	const impact = impactOf(changed);
	return { impact, selection: selectReviewTests('affected', impact, TESTS) };
}

// ---- The pull request of the flow demo ----

export const PR = {
	number: 17,
	title: { de: 'Fahrten: Neue Fahrt anlegen und Suche in der Fahrtenliste', en: 'Trips: create a new trip and search the trip list' } as Text,
	branch: 'feature/16-new-trip',
	files: [
		{ path: 'src/lib/components/TripForm.svelte', additions: 64, deletions: 0 },
		{ path: 'src/lib/search.ts', additions: 18, deletions: 2 },
		{ path: 'src/routes/trips/+page.svelte', additions: 12, deletions: 3 }
	],
	issue: {
		number: 16,
		title: { de: 'Disponent kann eine neue Fahrt anlegen', en: 'A dispatcher can create a new trip' } as Text,
		body: {
			de: 'Als Disponent möchte ich eine neue Fahrt anlegen, damit sie in der Fahrtenliste erscheint. Die Liste soll sich nach Fahrgast oder Fahrzeug durchsuchen lassen.',
			en: 'As a dispatcher I want to create a new trip so that it shows up in the trip list. The list should be searchable by passenger or vehicle.'
		} as Text
	}
};

type AcStatus = 'passed' | 'failed';

/** The six criteria Claudio derived from issue #16, with their result in the first run. */
export const CRITERIA: { text: Text; status: AcStatus }[] = [
	{ text: { de: 'In der Fahrtenliste öffnet ein Button „Neue Fahrt“ ein Formular.', en: 'A “New trip” button in the trip list opens a form.' }, status: 'passed' },
	{ text: { de: 'Das Formular hat die Felder Fahrgast, Datum, Uhrzeit, Von, Nach und Fahrzeug.', en: 'The form has the fields passenger, date, time, from, to and vehicle.' }, status: 'failed' },
	{ text: { de: 'Ein Datum in der Vergangenheit zeigt eine Fehlermeldung am Feld.', en: 'A date in the past shows an error at the field.' }, status: 'failed' },
	{ text: { de: 'Nach dem Speichern steht die Fahrt in der Liste, mit Erfolgsmeldung.', en: 'After saving, the trip is in the list, with a success message.' }, status: 'passed' },
	{ text: { de: 'Die Fahrtenliste lässt sich nach Fahrgast oder Fahrzeug durchsuchen.', en: 'The trip list can be searched by passenger or vehicle.' }, status: 'failed' },
	{ text: { de: 'Nur Disponenten und Admins dürfen Fahrten anlegen.', en: 'Only dispatchers and admins may create trips.' }, status: 'passed' }
];

/** The blocker the flow demo finds, shown with its evidence. */
export const BLOCKER = {
	title: { de: 'Suche liefert HTTP 500, sobald eine Fahrt ohne Fahrzeug existiert', en: 'Search returns HTTP 500 as soon as a trip without a vehicle exists' } as Text,
	steps: [
		{ de: 'Als Disponent anmelden', en: 'Sign in as dispatcher' },
		{ de: 'Neue Fahrt anlegen und speichern', en: 'Create a new trip and save it' },
		{ de: 'In der Fahrtenliste nach „mia“ suchen', en: 'Search the trip list for “mia”' }
	] as Text[],
	expected: { de: 'Die Liste zeigt die Fahrten von Mia.', en: 'The list shows Mia’s trips.' } as Text,
	observed: { de: 'Interner Fehler: Cannot read properties of null', en: 'Internal error: Cannot read properties of null' } as Text
};

/** All ten findings of the first run, by severity: under normal strictness the blocker and the four majors block. */
const FIRST_RUN_SEVERITIES: Severity[] = ['blocker', 'major', 'major', 'major', 'major', 'minor', 'minor', 'minor', 'minor', 'suggestion'];
export const FIRST_RUN_FINDINGS = FIRST_RUN_SEVERITIES.map((severity, k) => ({ id: `f${k + 1}`, severity }));

/** The words on the demo app's own screens, as the mini browser of the flow demo shows them. */
export const APP_TEXT = {
	de: { overview: 'Übersicht', trips: 'Fahrten', signIn: 'Anmelden', newTrip: 'Neue Fahrt', send: 'Senden', date: 'TT.MM.JJJJ', created: 'Fahrt #3 angelegt.', error: 'Interner Fehler' },
	en: { overview: 'Overview', trips: 'Trips', signIn: 'Sign in', newTrip: 'New trip', send: 'Send', date: 'DD/MM/YYYY', created: 'Trip #3 created.', error: 'Internal error' }
} satisfies Record<Locale, Record<string, string>>;

/** What the browser step does, one entry per beat of the animation. `screen` is the page the mini browser shows. */
export type Screen = 'login' | 'list' | 'form' | 'saved' | 'search' | 'error';
export const BROWSER_BEATS: { screen: Screen; url: string; tool: string; text: Text; cursor: [number, number]; outcome?: 'ok' | 'fail' }[] = [
	{ screen: 'login', url: '/login', tool: 'login_as', text: { de: 'Anmelden als Disponent', en: 'Sign in as dispatcher' }, cursor: [14, 61] },
	{ screen: 'list', url: '/trips', tool: 'click', text: { de: 'Klick auf „Neue Fahrt“', en: 'Click “New trip”' }, cursor: [86, 20] },
	{ screen: 'form', url: '/trips/new', tool: 'fill', text: { de: 'Fahrgast „claudio-r17-Mia“', en: 'Passenger “claudio-r17-Mia”' }, cursor: [22, 34] },
	{ screen: 'form', url: '/trips/new', tool: 'click', text: { de: 'Klick auf „Senden“', en: 'Click “Send”' }, cursor: [12, 74] },
	{ screen: 'saved', url: '/trips?created=3', tool: 'check', text: { de: 'Erfolgsmeldung sichtbar', en: 'Success message visible' }, cursor: [22, 32], outcome: 'ok' },
	{ screen: 'search', url: '/trips', tool: 'fill', text: { de: 'Suche nach „mia“', en: 'Search for “mia”' }, cursor: [22, 34] },
	{ screen: 'error', url: '/trips?q=mia', tool: 'check', text: { de: 'HTTP 500 statt Ergebnisliste', en: 'HTTP 500 instead of results' }, cursor: [50, 45], outcome: 'fail' },
	{ screen: 'error', url: '/trips?q=mia', tool: 'report_finding', text: { de: 'Blocker mit Screenshot gemeldet', en: 'Blocker reported with screenshot' }, cursor: [50, 45] }
];

// ---- The re-review of the verdict demo ----

/** The second run after the fixes: every criterion met, five findings left. */
export const RECHECK_FINDINGS: { id: string; severity: Severity; title: Text; detail: Text }[] = [
	{
		id: 'r1',
		severity: 'major',
		title: { de: 'Der Server prüft Pflichtfelder nicht', en: 'The server does not check required fields' },
		detail: { de: 'Ein Formular ohne Fahrgast und Uhrzeit wird gespeichert, sobald jemand die Prüfung im Browser umgeht.', en: 'A form without passenger and time is saved as soon as someone bypasses the check in the browser.' }
	},
	{
		id: 'r2',
		severity: 'minor',
		title: { de: 'Beschriftungen sind nicht mit ihren Feldern verknüpft', en: 'Labels are not linked to their fields' },
		detail: { de: 'Screenreader lesen „Von“ und „Nach“ ohne Namen vor.', en: 'Screen readers announce “From” and “To” without a name.' }
	},
	{
		id: 'r3',
		severity: 'minor',
		title: { de: 'Der Suchbegriff kommt kleingeschrieben zurück', en: 'The search term comes back in lower case' },
		detail: { de: 'Wer „Mia“ sucht, sieht danach „mia“ im Feld.', en: 'Searching for “Mia” leaves “mia” in the field.' }
	},
	{
		id: 'r4',
		severity: 'minor',
		title: { de: 'Konsolenfehler beim Öffnen der Fahrtenliste', en: 'Console error when opening the trip list' },
		detail: { de: 'Bei jedem Aufruf meldet die Konsole einen fehlenden Eintrag.', en: 'Every visit logs a missing entry to the console.' }
	},
	{
		id: 'r5',
		severity: 'suggestion',
		title: { de: 'Button „Senden“ besser „Fahrt speichern“ nennen', en: 'Call the “Send” button “Save trip”' },
		detail: { de: 'Sagt, was beim Klick passiert.', en: 'It says what the click does.' }
	}
];

/** Verdict, blocking count and commit status of a review, worked out by Claudio's own rules. */
export function outcome(
	locale: Locale,
	criteria: readonly AcStatus[],
	findings: readonly { id: string; severity: Severity }[],
	strictness: Strictness,
	dismissed: readonly string[] = []
) {
	const report = { status: 'completed' as const, request: { strictness }, acceptanceCriteria: criteria.map((status) => ({ status })), findings: [...findings] };
	const v = verdict(report, strictness, dismissed);
	const blocking = blockingFindings(report, strictness, dismissed);
	const acPassed = criteria.filter((s) => s === 'passed').length;
	const status = renderCommitStatus(locale, { kind: 'done', verdict: v, acPassed, acTotal: criteria.length, blocking: blocking.length }, 'github');
	return { verdict: v, blocking: blocking.map((f) => f.id), acPassed, acTotal: criteria.length, status };
}
