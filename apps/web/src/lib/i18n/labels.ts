import type { Severity, Strictness, Verdict } from '@claudio/core';
import type { Locale } from './index.js';

/** Display names of stored values (statuses, tiers, categories), per language. */
export type Labels = {
	status: Record<string, string>;
	verdict: Record<Verdict, string>;
	severity: Record<Severity, string>;
	category: Record<string, string>;
	ac: Record<string, string>;
	strictness: Record<Strictness, string>;
	budget: Record<string, string>;
	analysisBudget: Record<string, string>;
	verbosity: Record<string, string>;
	outcome: Record<string, string>;
	mode: Record<string, string>;
	determinism: Record<string, string>;
	determinismHelp: Record<string, string>;
	testBudget: Record<string, string>;
	reportLanguage: Record<string, string>;
	knowledgeDoc: Record<string, string>;
};

const de: Labels = {
	status: {
		queued: 'Wartet',
		running: 'Läuft',
		completed: 'Abgeschlossen',
		budget_exceeded: 'Budget erschöpft',
		max_turns: 'Schrittlimit erreicht',
		failed: 'Fehlgeschlagen',
		aborted: 'Abgebrochen'
	},
	verdict: { approve: 'Abnahme empfohlen', request_changes: 'Änderungen nötig', inconclusive: 'Kein Urteil' },
	severity: { blocker: 'Blocker', major: 'Major', minor: 'Minor', suggestion: 'Vorschlag' },
	category: {
		acceptance: 'Akzeptanzkriterium',
		regression: 'Regression',
		ux: 'UX',
		ui: 'UI',
		console: 'Konsole',
		network: 'Netzwerk',
		security: 'Sicherheit',
		performance: 'Performance',
		other: 'Sonstiges'
	},
	ac: { passed: 'Erfüllt', failed: 'Nicht erfüllt', blocked: 'Blockiert', not_testable: 'Nicht testbar' },
	strictness: { lenient: 'Nachsichtig (nur Blocker blockieren)', normal: 'Normal (ab Major)', strict: 'Streng (ab Minor)' },
	budget: { quick: 'Schnell (bis 2 USD)', standard: 'Standard (bis 8 USD)', thorough: 'Gründlich (bis 25 USD)' },
	analysisBudget: { quick: 'Schnell (bis 4 USD)', standard: 'Standard (bis 15 USD)', thorough: 'Gründlich (bis 40 USD)' },
	verbosity: { tldr: 'Nur Kurzfassung', normal: 'Normal', detailed: 'Ausführlich' },
	outcome: { passed: 'Bestanden', failed: 'Fehlgeschlagen', inconclusive: 'Unklar' },
	mode: { record: 'Aufzeichnung', replay: 'Wiedergabe', explore: 'Erkundung' },
	determinism: { deterministic: 'Deterministisch', semi: 'Halb-deterministisch', explorative: 'Explorativ' },
	determinismHelp: {
		deterministic: 'Die aufgezeichneten Prüfungen entscheiden allein. Wiederholungen laufen ohne Modell und kosten nichts.',
		semi: 'Die Schritte laufen ohne Modell, das Ergebnis bewertet danach ein Prüf-Agent.',
		explorative: 'Ein Agent führt den Test jedes Mal neu aus, weil sich der Ablauf je nach Daten ändert.'
	},
	testBudget: {
		quick: 'Schnell: Haiku, bis 1 USD',
		standard: 'Standard: Sonnet, bis 3 USD',
		thorough: 'Gründlich: Opus, bis 5 USD',
		extra: 'Extra-Gründlich: Opus mit viel Denkzeit, bis 8 USD'
	},
	reportLanguage: { de: 'Deutsch', en: 'Englisch' },
	knowledgeDoc: { overview: 'Überblick', modules: 'Module', routes: 'Routen', 'app-map': 'App-Karte', notes: 'Notizen' }
};

const en: Labels = {
	status: {
		queued: 'Queued',
		running: 'Running',
		completed: 'Completed',
		budget_exceeded: 'Budget used up',
		max_turns: 'Step limit reached',
		failed: 'Failed',
		aborted: 'Cancelled'
	},
	verdict: { approve: 'Approval recommended', request_changes: 'Changes needed', inconclusive: 'No verdict' },
	severity: { blocker: 'Blocker', major: 'Major', minor: 'Minor', suggestion: 'Suggestion' },
	category: {
		acceptance: 'Acceptance criterion',
		regression: 'Regression',
		ux: 'UX',
		ui: 'UI',
		console: 'Console',
		network: 'Network',
		security: 'Security',
		performance: 'Performance',
		other: 'Other'
	},
	ac: { passed: 'Met', failed: 'Not met', blocked: 'Blocked', not_testable: 'Not testable' },
	strictness: { lenient: 'Lenient (only blockers block)', normal: 'Normal (major and above)', strict: 'Strict (minor and above)' },
	budget: { quick: 'Quick (up to 2 USD)', standard: 'Standard (up to 8 USD)', thorough: 'Thorough (up to 25 USD)' },
	analysisBudget: { quick: 'Quick (up to 4 USD)', standard: 'Standard (up to 15 USD)', thorough: 'Thorough (up to 40 USD)' },
	verbosity: { tldr: 'Summary only', normal: 'Normal', detailed: 'Detailed' },
	outcome: { passed: 'Passed', failed: 'Failed', inconclusive: 'Unclear' },
	mode: { record: 'Recording', replay: 'Replay', explore: 'Exploration' },
	determinism: { deterministic: 'Deterministic', semi: 'Semi-deterministic', explorative: 'Explorative' },
	determinismHelp: {
		deterministic: 'The recorded checks decide on their own. Repeat runs need no model and cost nothing.',
		semi: 'The steps run without a model; a judging agent assesses the result afterwards.',
		explorative: 'An agent performs the test anew every time, because the flow depends on the data.'
	},
	testBudget: {
		quick: 'Quick: Haiku, up to 1 USD',
		standard: 'Standard: Sonnet, up to 3 USD',
		thorough: 'Thorough: Opus, up to 5 USD',
		extra: 'Extra thorough: Opus with extended thinking, up to 8 USD'
	},
	reportLanguage: { de: 'German', en: 'English' },
	knowledgeDoc: { overview: 'Overview', modules: 'Modules', routes: 'Routes', 'app-map': 'App map', notes: 'Notes' }
};

export const LABELS: Record<Locale, Labels> = { de, en };
