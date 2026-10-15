import type { Messages, Translation } from '../index.js';

// Messages produced by shared server code (lib/server, hooks) that reach the UI.
export const de = {
	notSignedIn: 'Nicht angemeldet',
	notFound: 'Nicht gefunden.',
	needAccess: 'Dafür brauchst du {need} am Repository {repo} auf GitHub.',
	needNone: 'keine Rechte',
	needRead: 'Lesezugriff',
	needWrite: 'Schreibrechte',
	needAdmin: 'Admin-Rechte',
	keyMalformed: 'Das sieht nicht wie ein Anthropic-API-Key aus (beginnt mit sk-ant-).',
	keyIsAdmin: 'Das ist ein Admin-Key. Claudio braucht einen normalen API-Key (console.anthropic.com → API Keys, beginnt mit sk-ant-api).',
	keyIsSubscription: 'Das ist ein Token eines Claude-Abos (claude setup-token). Claudio braucht einen API-Key aus der Anthropic Console (beginnt mit sk-ant-api).',
	keyRejected: 'Anthropic hat den Key abgelehnt{detail}. Prüfe, ob er vollständig kopiert und nicht widerrufen ist.',
	keyCheckHttp: 'Anthropic antwortete mit HTTP {status}{detail}; der Key konnte nicht geprüft werden.',
	keyCheckUnreachable: 'Anthropic war nicht erreichbar; der Key konnte nicht geprüft werden.',
	noKey: 'Für dieses Repository ist kein Anthropic-API-Key hinterlegt. Ein Admin kann ihn in den Einstellungen eintragen.',
	githubExpired: 'Dein GitHub-Zugang ist abgelaufen. Melde dich ab und wieder an.',
	githubForbidden: 'GitHub verweigert den Zugriff (fehlende Rechte oder Rate-Limit).',
	githubNotFound: 'GitHub kennt dieses Repository nicht oder du hast keinen Zugriff.',
	githubError: 'GitHub-Fehler: {message}',
	cannotReview: 'Claudio kann diesen PR nicht prüfen: {reason}',
	instanceOtherEnvironment: 'Im Environment „{env}“ gibt es für diesen PR keine Bereitstellung; genutzt wird die aus „{found}“. Prüfe die Einstellung in den Repo-Einstellungen.',
	instanceEarlierCommit: 'Für den neuesten Commit gibt es noch keine Instanz; geprüft wird die von {sha}.',
	instanceNoDeployment: 'Für diesen PR gibt es noch keine erfolgreiche Bereitstellung im Environment „{env}“.',
	instanceNoTemplate: 'In den Repo-Einstellungen fehlt die URL-Vorlage für die PR-Instanzen.'
} satisfies Messages;

export const en: Translation<typeof de> = {
	notSignedIn: 'Not signed in',
	notFound: 'Not found.',
	needAccess: 'You need {need} to the repository {repo} on GitHub for this.',
	needNone: 'no access',
	needRead: 'read access',
	needWrite: 'write access',
	needAdmin: 'admin access',
	keyMalformed: 'This does not look like an Anthropic API key (it starts with sk-ant-).',
	keyIsAdmin: 'This is an admin key. Claudio needs a regular API key (console.anthropic.com → API Keys, starts with sk-ant-api).',
	keyIsSubscription: 'This is a Claude subscription token (claude setup-token). Claudio needs an API key from the Anthropic Console (starts with sk-ant-api).',
	keyRejected: 'Anthropic rejected the key{detail}. Check that it was copied completely and has not been revoked.',
	keyCheckHttp: 'Anthropic answered with HTTP {status}{detail}; the key could not be checked.',
	keyCheckUnreachable: 'Anthropic could not be reached; the key could not be checked.',
	noKey: 'No Anthropic API key is stored for this repository. An admin can add it in the settings.',
	githubExpired: 'Your GitHub access has expired. Sign out and in again.',
	githubForbidden: 'GitHub denies access (missing permissions or rate limit).',
	githubNotFound: 'GitHub does not know this repository, or you have no access to it.',
	githubError: 'GitHub error: {message}',
	cannotReview: 'Claudio cannot review this PR: {reason}',
	instanceOtherEnvironment: 'The environment "{env}" has no deployment for this PR; the one from "{found}" is used. Check the setting in the repository settings.',
	instanceEarlierCommit: 'The latest commit has no instance yet; the one from {sha} is checked.',
	instanceNoDeployment: 'This PR has no successful deployment in the environment "{env}" yet.',
	instanceNoTemplate: 'The URL template for PR instances is missing in the repository settings.'
};
