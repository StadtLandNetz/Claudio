import { redirect } from '@sveltejs/kit';
import { dev } from '$app/env';
import { safeNext } from '#lib/server/auth.js';
import { devFixtures, githubOAuthConfig } from '#lib/server/env.js';
import type { PageServerLoad } from './$types';

const ERRORS: Record<string, string> = {
	config: 'Der GitHub-Login ist noch nicht eingerichtet. Trage GITHUB_CLIENT_ID und GITHUB_CLIENT_SECRET in die .env ein und starte Claudio neu.',
	state: 'Die Anmeldung ist abgelaufen oder wurde unterbrochen. Starte sie bitte noch einmal.',
	denied: 'Du hast den Zugriff bei GitHub abgelehnt. Ohne Freigabe kann Claudio deine Repositories nicht laden.',
	forbidden: 'Dein GitHub-Konto ist für Claudio nicht freigeschaltet. Wende dich an die Person, die Claudio betreibt.',
	github: 'GitHub hat die Anmeldung nicht bestätigt. Versuche es erneut.'
};

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) redirect(303, next);
	const code = url.searchParams.get('error');
	return {
		next,
		error: code ? (ERRORS[code] ?? ERRORS.github) : null,
		configured: githubOAuthConfig() !== null,
		devLogin: dev && devFixtures()
	};
};
