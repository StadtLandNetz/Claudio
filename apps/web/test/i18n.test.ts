import { describe, expect, it } from 'vitest';
import { forgeWords, pickLocale, serverI18n, translate } from '../src/lib/i18n/index.js';
import { LABELS } from '../src/lib/i18n/labels.js';
import * as analysis from '../src/lib/i18n/messages/analysis.js';
import * as common from '../src/lib/i18n/messages/common.js';
import * as landing from '../src/lib/i18n/messages/landing.js';
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
	const namespaces = { analysis, common, landing, repo, review, system, test };
	// The provider's words ({forge}, {prName}, …) are filled by translate itself; each language picks the form it needs.
	const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((p) => !Object.keys(forgeWords('de')).includes(p)).sort();

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

describe('wording', () => {
	const namespaces = { analysis, common, landing, repo, review, system, test };
	/** Filled from the provider, not passed by callers. */
	const FORGE_KEYS = Object.keys(forgeWords('de'));
	const SAMPLE = { n: 2, total: 3, passed: 1, fixed: 1, open: 2, blocking: 1, dismissed: 1, sha: 'abc', review: 'R', prev: 'P', new: 1, kept: 1, gone: 1, ok: 1, warn: 0, step: 1, saved: 1, kind: 'k' };
	const render = (provider?: 'github' | 'gitlab') => {
		const out: Record<string, string> = {};
		for (const [name, ns] of Object.entries(namespaces)) {
			for (const locale of ['de', 'en'] as const) {
				for (const [key, msg] of Object.entries((ns as Record<string, Record<string, unknown>>)[locale]!)) {
					const params =
						typeof msg === 'string'
							? Object.fromEntries([...msg.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((p) => !FORGE_KEYS.includes(p)).map((p) => [p, 'X']))
							: SAMPLE;
					out[`${locale}:${name}.${key}`] = translate(locale, `${name}.${key}` as Parameters<typeof translate>[1], params, provider);
				}
			}
		}
		return out;
	};

	// Guards the GitHub wording while the texts become provider-aware.
	it('is unchanged for GitHub', () => {
		expect(render()).toMatchSnapshot();
	});

	it('names GitLab and merge requests for GitLab repositories', () => {
		// Texts about GitHub-only things: its sign-in setup, the GitHub App, the demo, and the GitHub settings pages.
		const githubOnly = /^(de|en):(common\.(signInGithub|loginNotConfiguredBefore|loginErrorConfig|devLogin|demoHintAfter|repoNamePlaceholder)|repo\.(app\w+|howWhat|howCheck|howCheckStep\d|ovDemoTip)|review\.demo\w+|analysis\.sourceFixture|landing\.(factForgesBoth|selfRepoGithub))$/;
		const out = render('gitlab');
		const leaks = Object.entries(out).filter(([key, text]) => !githubOnly.test(key) && /GitHub|[Pp]ull [Rr]equest|(?<![\p{L}\d])PRs?(?![\p{L}\d])/u.test(text));
		expect(leaks).toEqual([]);
		expect(out['de:repo.tabPulls']).toBe('Merge Requests');
		expect(out['en:review.prNotFound']).toBe('Merge request !X was not found.');
	});
});
