import type { Messages, Translation } from '../index.js';

export const de = {
	// analyses/[id]/+page.server.ts, events, live
	notFound: 'Diese Analyse gibt es nicht.',

	// analyses/[id]/+page.svelte
	pageTitle: 'Analyse {repo} · Claudio',
	crumbKnowledge: 'Wissen',
	titleUpdate: 'Wissensbasis aktualisieren',
	titleAnalyse: 'Repository analysieren',
	commit: 'Commit',
	onBranch: ' auf {branch}',
	buildingOn: ', aufbauend auf',
	instance: 'Instanz {url}',
	aborting: 'Wird abgebrochen …',
	abort: 'Analyse abbrechen',
	queuedNotice: 'Wartet auf den Worker. Läuft kein Worker, starte ihn mit pnpm worker.',
	runningNotice: 'Claudio liest den Code und geht die App Bildschirm für Bildschirm durch. Die Dokumente erscheinen, sobald die Analyse fertig ist.',
	summary: 'Zusammenfassung',
	docsFromRun: 'Wissensbasis aus diesem Lauf',
	noDocs: 'Diese Analyse hat keine Dokumente geschrieben.',
	findings: 'Nebenbei gefundene Fehler',
	findingsHint: 'Bei der Analyse aufgefallen. Sie sind kein Ergebnis eines Reviews und blockieren nichts.',
	screenshots: 'Screenshots',
	screenshotExpiredTitle: 'Screenshots werden nach 14 Tagen gelöscht',
	screenshotDeleted: 'Screenshot gelöscht',
	runProblems: 'Probleme während des Runs',
	metaStatus: 'Status',
	metaInstance: 'Instanz',
	metaRoles: 'Rollen',
	allRoles: 'alle konfigurierten',
	metaBudget: 'Budget',
	metaCost: 'Kosten',
	costDetail: '{turns} Züge, {steps} Browser-Schritte, {duration}',
	metaStarted: 'Gestartet',
	startedBy: 'von {login}',
	metaFinished: 'Beendet',
	metaSource: 'Quelle',
	sourceFixture: 'Demo-Checkout statt GitHub',

	// KnowledgeView.svelte
	documents: 'Dokumente'
} satisfies Messages;

export const en: Translation<typeof de> = {
	notFound: 'This analysis does not exist.',

	pageTitle: 'Analysis {repo} · Claudio',
	crumbKnowledge: 'Knowledge',
	titleUpdate: 'Update knowledge base',
	titleAnalyse: 'Analyse repository',
	commit: 'Commit',
	onBranch: ' on {branch}',
	buildingOn: ', building on',
	instance: 'Instance {url}',
	aborting: 'Cancelling …',
	abort: 'Cancel analysis',
	queuedNotice: 'Waiting for the worker. If no worker is running, start it with pnpm worker.',
	runningNotice: 'Claudio is reading the code and going through the app screen by screen. The documents appear once the analysis is finished.',
	summary: 'Summary',
	docsFromRun: 'Knowledge base from this run',
	noDocs: 'This analysis did not write any documents.',
	findings: 'Bugs found along the way',
	findingsHint: 'Noticed during the analysis. They are not the result of a review and do not block anything.',
	screenshots: 'Screenshots',
	screenshotExpiredTitle: 'Screenshots are deleted after 14 days',
	screenshotDeleted: 'Screenshot deleted',
	runProblems: 'Problems during the run',
	metaStatus: 'Status',
	metaInstance: 'Instance',
	metaRoles: 'Roles',
	allRoles: 'all configured',
	metaBudget: 'Budget',
	metaCost: 'Costs',
	costDetail: '{turns} turns, {steps} browser steps, {duration}',
	metaStarted: 'Started',
	startedBy: 'by {login}',
	metaFinished: 'Finished',
	metaSource: 'Source',
	sourceFixture: 'Demo checkout instead of GitHub',

	documents: 'Documents'
};
