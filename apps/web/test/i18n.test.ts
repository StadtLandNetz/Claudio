import { describe, expect, it } from 'vitest';
import { pickLocale, serverI18n, translate } from '../src/lib/i18n/index.js';
import { LABELS } from '../src/lib/i18n/labels.js';
import * as analysis from '../src/lib/i18n/messages/analysis.js';
import * as common from '../src/lib/i18n/messages/common.js';
import * as repo from '../src/lib/i18n/messages/repo.js';
import * as review from '../src/lib/i18n/messages/review.js';
import * as system from '../src/lib/i18n/messages/system.js';
import * as test from '../src/lib/i18n/messages/test.js';

describe('pickLocale', () => {
	it('prefers the cookie', () => {
		expect(pickLocale('en', 'de-DE,de;q=0.9')).toBe('en');
	});
	it('falls back to the browser language', () => {
		expect(pickLocale(undefined, 'en-US,en;q=0.9,de;q=0.8')).toBe('en');
		expect(pickLocale('fr', 'fr-FR,de;q=0.5')).toBe('de');
	});
	it('defaults to German', () => {
		expect(pickLocale(undefined, null)).toBe('de');
		expect(pickLocale(undefined, 'ja')).toBe('de');
	});
});

describe('translate', () => {
	it('fills placeholders', () => {
		expect(translate('en', 'system.githubError', { message: 'boom' })).toBe('GitHub error: boom');
		expect(translate('de', 'system.githubError', { message: 'boom' })).toBe('GitHub-Fehler: boom');
	});
	it('formats numbers per language', () => {
		expect(serverI18n('de').formatUsd(1.5)).toBe('1,50 USD');
		expect(serverI18n('en').formatUsd(1.5)).toBe('1.50 USD');
	});
});

describe('message files', () => {
	const namespaces = { analysis, common, repo, review, system, test };
	const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

	for (const [name, ns] of Object.entries(namespaces)) {
		it(`${name}: English has the same keys and placeholders as German`, () => {
			const de = ns.de as Record<string, unknown>;
			const en = ns.en as Record<string, unknown>;
			expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
			for (const key of Object.keys(de)) {
				expect(typeof en[key], `${name}.${key}`).toBe(typeof de[key]);
				if (typeof de[key] === 'string') expect(placeholders(en[key] as string), `${name}.${key}`).toEqual(placeholders(de[key] as string));
			}
		});
	}

	it('labels exist in both languages', () => {
		for (const group of Object.keys(LABELS.de) as (keyof typeof LABELS.de)[]) {
			expect(Object.keys(LABELS.en[group]).sort(), group).toEqual(Object.keys(LABELS.de[group]).sort());
		}
	});
});
