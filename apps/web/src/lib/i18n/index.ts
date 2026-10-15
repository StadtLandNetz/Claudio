import { getContext, setContext } from 'svelte';
import { LABELS, type Labels } from './labels.js';
import * as analysis from './messages/analysis.js';
import * as common from './messages/common.js';
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
const NAMESPACES = { analysis, common, repo, review, system, test };
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

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
	const dot = key.indexOf('.');
	const ns = NAMESPACES[key.slice(0, dot) as keyof Namespaces] as unknown as Record<Locale, Messages>;
	const name = key.slice(dot + 1);
	const message = ns[locale][name] ?? ns[DEFAULT_LOCALE][name];
	if (message === undefined) return key;
	if (typeof message === 'function') return message(params ?? {});
	return params ? message.replace(/\{(\w+)\}/g, (all, p: string) => (p in params ? String(params[p]) : all)) : message;
}

const BCP47: Record<Locale, string> = { de: 'de-DE', en: 'en-GB' };

export type I18n = {
	readonly locale: Locale;
	readonly labels: Labels;
	t(key: MessageKey, params?: Params): string;
	formatDate(d: Date | string | null | undefined): string;
	formatUsd(v: string | number | null | undefined): string;
	formatDuration(ms: number): string;
	formatNumber(n: number): string;
};

/** Reads the locale on every call, so texts follow a change of the layout data. */
export function createI18n(getLocale: () => Locale): I18n {
	return {
		get locale() {
			return getLocale();
		},
		get labels() {
			return LABELS[getLocale()];
		},
		t: (key, params) => translate(getLocale(), key, params),
		formatDate(d) {
			if (!d) return '–';
			return new Intl.DateTimeFormat(BCP47[getLocale()], { dateStyle: 'medium', timeStyle: 'short' }).format(typeof d === 'string' ? new Date(d) : d);
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

/** For server code: `const { t } = serverI18n(locals.locale)`. */
export const serverI18n = (locale: Locale): I18n => createI18n(() => locale);

const KEY = Symbol('i18n');
/** Called once in the root layout. */
export const provideI18n = (getLocale: () => Locale) => setContext(KEY, createI18n(getLocale));
/** In components: `const i = i18n();` then `i.t('common.save')`. */
export const i18n = (): I18n => getContext<I18n>(KEY);
