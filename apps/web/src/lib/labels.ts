import type { Severity, Strictness, Verdict } from '@claudio/core';

export const STATUS_LABEL: Record<string, string> = {
	queued: 'Wartet',
	running: 'Läuft',
	completed: 'Abgeschlossen',
	budget_exceeded: 'Budget erschöpft',
	max_turns: 'Schrittlimit erreicht',
	failed: 'Fehlgeschlagen',
	aborted: 'Abgebrochen'
};

export const VERDICT_LABEL: Record<Verdict, string> = {
	approve: 'Abnahme empfohlen',
	request_changes: 'Änderungen nötig',
	inconclusive: 'Kein Urteil'
};

export const SEVERITY_LABEL: Record<Severity, string> = {
	blocker: 'Blocker',
	major: 'Major',
	minor: 'Minor',
	suggestion: 'Vorschlag'
};

export const CATEGORY_LABEL: Record<string, string> = {
	acceptance: 'Akzeptanzkriterium',
	regression: 'Regression',
	ux: 'UX',
	ui: 'UI',
	console: 'Konsole',
	network: 'Netzwerk',
	security: 'Sicherheit',
	performance: 'Performance',
	other: 'Sonstiges'
};

export const AC_LABEL: Record<string, string> = {
	passed: 'Erfüllt',
	failed: 'Nicht erfüllt',
	blocked: 'Blockiert',
	not_testable: 'Nicht testbar'
};

export const STRICTNESS_LABEL: Record<Strictness, string> = {
	lenient: 'Nachsichtig (nur Blocker blockieren)',
	normal: 'Normal (ab Major)',
	strict: 'Streng (ab Minor)'
};

export const BUDGET_LABEL: Record<string, string> = {
	quick: 'Schnell (bis 2 USD)',
	standard: 'Standard (bis 8 USD)',
	thorough: 'Gründlich (bis 25 USD)'
};

export const ANALYSIS_BUDGET_LABEL: Record<string, string> = {
	quick: 'Schnell (bis 4 USD)',
	standard: 'Standard (bis 15 USD)',
	thorough: 'Gründlich (bis 40 USD)'
};

export const VERBOSITY_LABEL: Record<string, string> = {
	tldr: 'Nur Kurzfassung',
	normal: 'Normal',
	detailed: 'Ausführlich'
};

const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(d: Date | string | null | undefined): string {
	if (!d) return '–';
	return dateFmt.format(typeof d === 'string' ? new Date(d) : d);
}

export function formatUsd(v: string | number | null | undefined): string {
	if (v === null || v === undefined || v === '') return '–';
	return `${Number(v).toFixed(2).replace('.', ',')} USD`;
}

export function formatDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export const isActive = (status: string) => status === 'queued' || status === 'running';

export const OUTCOME_LABEL: Record<string, string> = {
	passed: 'Bestanden',
	failed: 'Fehlgeschlagen',
	inconclusive: 'Unklar'
};

export const MODE_LABEL: Record<string, string> = {
	record: 'Aufzeichnung',
	replay: 'Wiedergabe',
	explore: 'Erkundung'
};

export const DETERMINISM_LABEL: Record<string, string> = {
	deterministic: 'Deterministisch',
	semi: 'Halb-deterministisch',
	explorative: 'Explorativ'
};

export const DETERMINISM_HELP: Record<string, string> = {
	deterministic: 'Die aufgezeichneten Prüfungen entscheiden allein. Wiederholungen laufen ohne Modell und kosten nichts.',
	semi: 'Die Schritte laufen ohne Modell, das Ergebnis bewertet danach ein Prüf-Agent.',
	explorative: 'Ein Agent führt den Test jedes Mal neu aus, weil sich der Ablauf je nach Daten ändert.'
};

export const TEST_BUDGET_LABEL: Record<string, string> = {
	quick: 'Schnell: Haiku, bis 1 USD',
	standard: 'Standard: Sonnet, bis 3 USD',
	thorough: 'Gründlich: Opus, bis 5 USD',
	extra: 'Extra-Gründlich: Opus mit viel Denkzeit, bis 8 USD'
};

/** Preselected for manual test runs; tests inside PR reviews always run "quick". */
export const DEFAULT_TEST_BUDGET = 'standard';
