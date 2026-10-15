import { redirect } from '@sveltejs/kit';
import { LOCALE_COOKIE, isLocale } from '#lib/i18n/index.js';
import type { RequestHandler } from './$types';

/** Stores the chosen UI language for a year and returns to the page the person came from. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const form = await request.formData();
	const locale = form.get('locale');
	if (isLocale(locale)) cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: false });
	const back = String(form.get('redirectTo') ?? '/');
	// Only same-site paths; "//host" would leave Claudio.
	redirect(303, back.startsWith('/') && !back.startsWith('//') ? back : '/');
};
