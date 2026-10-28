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
 * Example data for the demos on the public page: a task tracker, which every
 * team knows, told along the lines of PR #17 of the bundled demo app
 * (apps/demo-target) and its review, whose figures it keeps. The demos run
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
	{ path: 'src/lib/components/TaskForm.svelte', tier: 'components', imports: ['src/lib/format.ts'] },
	{ path: 'src/lib/components/TaskTable.svelte', tier: 'components', imports: ['src/lib/format.ts', 'src/lib/search.ts'] },
	{ path: 'src/lib/server/tasks.ts', tier: 'components', imports: ['src/lib/search.ts'] },
	{ path: 'src/routes/+layout.svelte', tier: 'routes', imports: ['src/lib/components/Nav.svelte'] },
	{ path: 'src/routes/tasks/new/+page.svelte', tier: 'routes', imports: ['src/lib/components/TaskForm.svelte'] },
	{ path: 'src/routes/tasks/+page.svelte', tier: 'routes', imports: ['src/lib/components/TaskTable.svelte'] },
	{ path: 'src/routes/projects/[id]/+page.svelte', tier: 'routes', imports: ['src/lib/components/TaskTable.svelte'] },
	{ path: 'src/routes/api/tasks/+server.ts', tier: 'routes', imports: ['src/lib/server/tasks.ts'] },
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
	{ id: 1, name: 'task-create', title: { de: 'Aufgabe anlegen', en: 'Create a task' }, touchedPaths: ['/tasks', '/tasks/new'], steps: null },
	{ id: 2, name: 'task-search', title: { de: 'Aufgaben suchen', en: 'Search tasks' }, touchedPaths: ['/tasks'], steps: null },
	{ id: 3, name: 'project-tasks', title: { de: 'Aufgaben eines Projekts', en: 'Tasks of a project' }, touchedPaths: ['/projects/7'], steps: null },
	{ id: 4, name: 'api-export', title: { de: 'Export über die API', en: 'Export via the API' }, touchedPaths: ['/api/tasks'], steps: null },
	{ id: 5, name: 'login', title: { de: 'Anmelden', en: 'Sign in' }, touchedPaths: ['/login'], steps: null },
	{ id: 6, name: 'profile', title: { de: 'Profil ändern', en: 'Edit the profile' }, touchedPaths: ['/profile'], steps: null }
];

export function selectTests(changed: readonly string[]) {
	const impact = impactOf(changed);
	return { impact, selection: selectReviewTests('affected', impact, TESTS) };
}

// ---- The pull request of the flow demo ----

export const PR = {
	number: 17,
	title: { de: 'Aufgaben: Neue Aufgabe anlegen und Suche in der Aufgabenliste', en: 'Tasks: create a task and search the task list' } as Text,
	branch: 'feature/16-new-task',
	files: [
		{ path: 'src/lib/components/TaskForm.svelte', additions: 64, deletions: 0 },
		{ path: 'src/lib/search.ts', additions: 18, deletions: 2 },
		{ path: 'src/routes/tasks/+page.svelte', additions: 12, deletions: 3 }
	],
	issue: {
		number: 16,
		title: { de: 'Teammitglied kann eine Aufgabe anlegen', en: 'A team member can create a task' } as Text,
		body: {
			de: 'Als Teammitglied möchte ich eine neue Aufgabe anlegen, damit sie in der Aufgabenliste erscheint. Die Liste soll sich nach Titel oder zuständiger Person durchsuchen lassen.',
			en: 'As a team member I want to create a new task so that it shows up in the task list. The list should be searchable by title or assignee.'
		} as Text
	}
};

type AcStatus = 'passed' | 'failed';

/** The six criteria Claudio derived from issue #16, with their result in the first run. */
export const CRITERIA: { text: Text; status: AcStatus }[] = [
	{ text: { de: 'In der Aufgabenliste öffnet ein Button „Neue Aufgabe“ ein Formular.', en: 'A “New task” button in the task list opens a form.' }, status: 'passed' },
	{ text: { de: 'Das Formular hat die Felder Titel, Beschreibung, Fälligkeit, Priorität und Zuständig.', en: 'The form has the fields title, description, due date, priority and assignee.' }, status: 'failed' },
	{ text: { de: 'Eine Fälligkeit in der Vergangenheit zeigt eine Fehlermeldung am Feld.', en: 'A due date in the past shows an error at the field.' }, status: 'failed' },
	{ text: { de: 'Nach dem Speichern steht die Aufgabe in der Liste, mit Erfolgsmeldung.', en: 'After saving, the task is in the list, with a success message.' }, status: 'passed' },
	{ text: { de: 'Die Aufgabenliste lässt sich nach Titel oder zuständiger Person durchsuchen.', en: 'The task list can be searched by title or assignee.' }, status: 'failed' },
	{ text: { de: 'Nur Mitglieder des Projekts dürfen Aufgaben anlegen.', en: 'Only members of the project may create tasks.' }, status: 'passed' }
];

/** The blocker the flow demo finds, shown with its evidence. */
export const BLOCKER = {
	title: { de: 'Suche liefert HTTP 500, sobald eine Aufgabe ohne zuständige Person existiert', en: 'Search returns HTTP 500 as soon as a task has no assignee' } as Text,
	steps: [
		{ de: 'Als Teammitglied anmelden', en: 'Sign in as a team member' },
		{ de: 'Neue Aufgabe anlegen und speichern', en: 'Create a new task and save it' },
		{ de: 'In der Aufgabenliste nach „login“ suchen', en: 'Search the task list for “login”' }
	] as Text[],
	expected: { de: 'Die Liste zeigt die passenden Aufgaben.', en: 'The list shows the matching tasks.' } as Text,
	observed: { de: 'Interner Fehler: Cannot read properties of null', en: 'Internal error: Cannot read properties of null' } as Text
};

/** All ten findings of the first run, by severity: under normal strictness the blocker and the four majors block. */
const FIRST_RUN_SEVERITIES: Severity[] = ['blocker', 'major', 'major', 'major', 'major', 'minor', 'minor', 'minor', 'minor', 'suggestion'];
export const FIRST_RUN_FINDINGS = FIRST_RUN_SEVERITIES.map((severity, k) => ({ id: `f${k + 1}`, severity }));

/**
 * The example app's own screens, as the mini browser of the flow demo shows
 * them. The new task has no assignee, and that is what breaks the search.
 */
type AppText = {
	app: string;
	user: string;
	email: string;
	overview: string;
	tasks: string;
	signIn: string;
	newTask: string;
	send: string;
	date: string;
	priority: string;
	created: string;
	error: string;
	newTitle: string;
	search: string;
	rows: { title: string; who: string }[];
};
export const APP_TEXT: Record<Locale, AppText> = {
	de: {
		app: 'Acme Tasks',
		user: 'Dana Dev',
		email: 'dana@acme.test',
		overview: 'Übersicht',
		tasks: 'Aufgaben',
		signIn: 'Anmelden',
		newTask: 'Neue Aufgabe',
		send: 'Senden',
		date: 'Fällig am TT.MM.JJJJ',
		priority: 'Priorität',
		created: 'Aufgabe #3 angelegt.',
		error: 'Interner Fehler',
		newTitle: 'claudio-r17-Testaufgabe',
		search: 'login',
		rows: [
			{ title: 'Login-Seite überarbeiten', who: 'Mia' },
			{ title: 'CSV-Export reparieren', who: 'Ben' }
		]
	},
	en: {
		app: 'Acme Tasks',
		user: 'Dana Dev',
		email: 'dana@acme.test',
		overview: 'Overview',
		tasks: 'Tasks',
		signIn: 'Sign in',
		newTask: 'New task',
		send: 'Send',
		date: 'Due DD/MM/YYYY',
		priority: 'Priority',
		created: 'Task #3 created.',
		error: 'Internal error',
		newTitle: 'claudio-r17-test-task',
		search: 'login',
		rows: [
			{ title: 'Rework the login page', who: 'Mia' },
			{ title: 'Fix the CSV export', who: 'Ben' }
		]
	}
};

/** What the browser step does, one entry per beat of the animation. `screen` is the page the mini browser shows. */
export type Screen = 'login' | 'list' | 'form' | 'saved' | 'search' | 'error';
export const BROWSER_BEATS: { screen: Screen; url: string; tool: string; text: Text; cursor: [number, number]; outcome?: 'ok' | 'fail' }[] = [
	{ screen: 'login', url: '/login', tool: 'login_as', text: { de: 'Anmelden als Teammitglied', en: 'Sign in as a team member' }, cursor: [14, 61] },
	{ screen: 'list', url: '/tasks', tool: 'click', text: { de: 'Klick auf „Neue Aufgabe“', en: 'Click “New task”' }, cursor: [85, 20] },
	{ screen: 'form', url: '/tasks/new', tool: 'fill', text: { de: 'Titel „claudio-r17-Testaufgabe“', en: 'Title “claudio-r17-test-task”' }, cursor: [22, 34] },
	{ screen: 'form', url: '/tasks/new', tool: 'click', text: { de: 'Klick auf „Senden“', en: 'Click “Send”' }, cursor: [12, 74] },
	{ screen: 'saved', url: '/tasks?created=3', tool: 'check', text: { de: 'Erfolgsmeldung sichtbar', en: 'Success message visible' }, cursor: [22, 32], outcome: 'ok' },
	{ screen: 'search', url: '/tasks', tool: 'fill', text: { de: 'Suche nach „login“', en: 'Search for “login”' }, cursor: [22, 34] },
	{ screen: 'error', url: '/tasks?q=login', tool: 'check', text: { de: 'HTTP 500 statt Ergebnisliste', en: 'HTTP 500 instead of results' }, cursor: [50, 45], outcome: 'fail' },
	{ screen: 'error', url: '/tasks?q=login', tool: 'report_finding', text: { de: 'Blocker mit Screenshot gemeldet', en: 'Blocker reported with screenshot' }, cursor: [50, 45] }
];

// ---- The re-review of the verdict demo ----

/** The second run after the fixes: every criterion met, five findings left. */
export const RECHECK_FINDINGS: { id: string; severity: Severity; title: Text; detail: Text }[] = [
	{
		id: 'r1',
		severity: 'major',
		title: { de: 'Der Server prüft Pflichtfelder nicht', en: 'The server does not check required fields' },
		detail: { de: 'Eine Aufgabe ohne Titel und Fälligkeit wird gespeichert, sobald jemand die Prüfung im Browser umgeht.', en: 'A task without title and due date is saved as soon as someone bypasses the check in the browser.' }
	},
	{
		id: 'r2',
		severity: 'minor',
		title: { de: 'Beschriftungen sind nicht mit ihren Feldern verknüpft', en: 'Labels are not linked to their fields' },
		detail: { de: 'Screenreader lesen die Felder für Fälligkeit und Priorität ohne Namen vor.', en: 'Screen readers announce the due date and priority fields without a name.' }
	},
	{
		id: 'r3',
		severity: 'minor',
		title: { de: 'Der Suchbegriff kommt kleingeschrieben zurück', en: 'The search term comes back in lower case' },
		detail: { de: 'Wer „Login“ sucht, sieht danach „login“ im Feld.', en: 'Searching for “Login” leaves “login” in the field.' }
	},
	{
		id: 'r4',
		severity: 'minor',
		title: { de: 'Konsolenfehler beim Öffnen der Aufgabenliste', en: 'Console error when opening the task list' },
		detail: { de: 'Bei jedem Aufruf meldet die Konsole einen fehlenden Eintrag.', en: 'Every visit logs a missing entry to the console.' }
	},
	{
		id: 'r5',
		severity: 'suggestion',
		title: { de: 'Button „Senden“ besser „Aufgabe speichern“ nennen', en: 'Call the “Send” button “Save task”' },
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
