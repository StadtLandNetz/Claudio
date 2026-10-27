import { getContext, setContext } from 'svelte';
import { changeTerms, type Provider } from '@claudio/core';
import { LABELS, type Labels } from './labels.js';
import * as analysis from './messages/analysis.js';
import * as common from './messages/common.js';
import * as landing from './messages/landing.js';
import * as repo from './messages/repo.js';
import * as review from './messages/review.js';
import * as system from './messages/system.js';
import * as test from './messages/test.js';

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';
export const LOCALE_COOKIE = 'claudio_lang';
export const LOCALE_NAME: Record<Locale, string> = { de: 'Deutsch', en: 'English' };

export type Params = Record<string, string | number>;
/** A message is a text with `{name}` placeholders, or a function for plurals and other cases a template cannot express. */
export type Message = string | ((p: any) => string);
export type Messages = Record<string, Message>;
/** The English messages must have every German key, with the same kind of value. */
export type Translation<T extends Messages> = { [K in keyof T]: T[K] extends string ? string : T[K] };

// One namespace per area of the UI, so the message files stay small enough to edit.
const NAMESPACES = { analysis, common, landing, repo, review, system, test };
type Namespaces = typeof NAMESPACES;
export type MessageKey = { [N in keyof Namespaces]: `${N & string}.${keyof Namespaces[N]['de'] & string}` }[keyof Namespaces];

export function isLocale(value: unknown): value is Locale {
	return LOCALES.includes(value as Locale);
}

/** The cookie wins; otherwise the browser's preferred language, falling back to German. */
export function pickLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
	if (isLocale(cookie)) return cookie;
	for (const part of (acceptLanguage ?? '').split(',')) {
		const lang = part.split(';')[0]!.trim().slice(0, 2).toLowerCase();
		if (isLocale(lang)) return lang;
	}
	return DEFAULT_LOCALE;
}

/**
 * Words that depend on where the repository lives, filled into every message:
 * {forge} GitHub/GitLab, {prName} pull/merge request (capitalised in German),
 * {PrName} at the start of a sentence, {prsName}/{PrsName} plural, {prTitle}/{prsTitle}
 * in title case (tabs, headings), {prAbbr} PR/MR,
 * {prSign} the reference sign (#12, !12).
 */
export function forgeWords(locale: Locale, provider: Provider = 'github'): Params {
	const t = changeTerms(provider);
	const one = locale === 'de' ? t.Title : t.change;
	const One = locale === 'de' ? t.Title : t.Change;
	return { forge: t.forge, prName: one, PrName: One, prsName: `${one}s`, PrsName: `${One}s`, prTitle: t.Title, prsTitle: `${t.Title}s`, prAbbr: t.short, prSign: t.prefix };
}

export function translate(locale: Locale, key: MessageKey, params?: Params, provider?: Provider): string {
	const dot = key.indexOf('.');
	const ns = NAMESPACES[key.slice(0, dot) as keyof Namespaces] as unknown as Record<Locale, Messages>;
	const name = key.slice(dot + 1);
	const message = ns[locale][name] ?? ns[DEFAULT_LOCALE][name];
	if (message === undefined) return key;
	const all = { ...forgeWords(locale, provider), ...params };
	if (typeof message === 'function') return message(all);
	return message.replace(/\{(\w+)\}/g, (whole, p: string) => (p in all ? String(all[p]) : whole));
}

const BCP47: Record<Locale, string> = { de: 'de-DE', en: 'en-GB' };

export type I18n = {
	readonly locale: Locale;
	/** Where the repository on screen lives (or the signed-in account, elsewhere); decides "GitHub" or "GitLab" in texts. */
	readonly provider: Provider;
	readonly labels: Labels;
	t(key: MessageKey, params?: Params): string;
	formatDate(d: Date | string | null | undefined): string;
	/** A calendar day without time, e.g. a token's expiry date ("2026-11-01"). */
	formatDay(d: string | null | undefined): string;
	formatUsd(v: string | number | null | undefined): string;
	formatDuration(ms: number): string;
	formatNumber(n: number): string;
};

/** Reads the locale and provider on every call, so texts follow a change of the layout data. */
export function createI18n(getLocale: () => Locale, getProvider: () => Provider = () => 'github'): I18n {
	return {
		get locale() {
			return getLocale();
		},
		get provider() {
			return getProvider();
		},
		get labels() {
			return LABELS[getLocale()];
		},
		t: (key, params) => translate(getLocale(), key, params, getProvider()),
		formatDate(d) {
			if (!d) return '–';
			return new Intl.DateTimeFormat(BCP47[getLocale()], { dateStyle: 'medium', timeStyle: 'short' }).format(typeof d === 'string' ? new Date(d) : d);
		},
		formatDay(d) {
			if (!d) return '–';
			// Date-only strings are calendar days; shown in UTC so no time zone shifts them to the day before.
			return new Intl.DateTimeFormat(BCP47[getLocale()], { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(d));
		},
		formatUsd(v) {
			if (v === null || v === undefined || v === '') return '–';
			return `${new Intl.NumberFormat(BCP47[getLocale()], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))} USD`;
		},
		formatDuration(ms) {
			const s = Math.round(ms / 1000);
			return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
		},
		formatNumber: (n) => new Intl.NumberFormat(BCP47[getLocale()]).format(n)
	};
}

/** For server code: `const { t } = serverI18n(locals.locale, repo.provider)`. */
export const serverI18n = (locale: Locale, provider: Provider = 'github'): I18n => createI18n(() => locale, () => provider);

const KEY = Symbol('i18n');
/** Called once in the root layout. */
export const provideI18n = (getLocale: () => Locale, getProvider?: () => Provider) => setContext(KEY, createI18n(getLocale, getProvider));
/** In components: `const i = i18n();` then `i.t('common.save')`. */
export const i18n = (): I18n => getContext<I18n>(KEY);
