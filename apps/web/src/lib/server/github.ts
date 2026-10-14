import { Octokit } from 'octokit';

export type GithubRepo = {
	fullName: string;
	description: string | null;
	isPrivate: boolean;
	defaultBranch: string;
	pushedAt: string | null;
	owner: string;
};

export type GithubPull = {
	number: number;
	title: string;
	author: string | null;
	headRef: string;
	headSha?: string;
	draft: boolean;
	updatedAt: string;
	url: string;
};

export const octokit = (token: string) => new Octokit({ auth: token });

/** All repos the user can access (own, collaborator, org member), most recently pushed first. */
export async function listUserRepos(token: string, max = 500): Promise<GithubRepo[]> {
	const out: GithubRepo[] = [];
	for await (const { data } of octokit(token).paginate.iterator(octokit(token).rest.repos.listForAuthenticatedUser, {
		per_page: 100,
		sort: 'pushed',
		affiliation: 'owner,collaborator,organization_member'
	})) {
		for (const r of data) {
			out.push({
				fullName: r.full_name,
				description: r.description,
				isPrivate: r.private,
				defaultBranch: r.default_branch,
				pushedAt: r.pushed_at ?? null,
				owner: r.owner.login
			});
		}
		if (out.length >= max) break;
	}
	return out;
}

export async function getRepoInfo(token: string, fullName: string) {
	const [owner, repo] = fullName.split('/') as [string, string];
	const { data } = await octokit(token).rest.repos.get({ owner, repo });
	return {
		fullName: data.full_name,
		isPrivate: data.private,
		defaultBranch: data.default_branch,
		canWrite: Boolean(data.permissions?.push || data.permissions?.maintain || data.permissions?.admin)
	};
}

export async function listOpenPulls(token: string, fullName: string): Promise<GithubPull[]> {
	const [owner, repo] = fullName.split('/') as [string, string];
	const { data } = await octokit(token).rest.pulls.list({ owner, repo, state: 'open', sort: 'updated', direction: 'desc', per_page: 50 });
	return data.map((p) => ({
		number: p.number,
		title: p.title,
		author: p.user?.login ?? null,
		headRef: p.head.ref,
		draft: Boolean(p.draft),
		updatedAt: p.updated_at,
		url: p.html_url
	}));
}

export async function getPull(token: string, fullName: string, number: number): Promise<GithubPull> {
	const [owner, repo] = fullName.split('/') as [string, string];
	const { data: p } = await octokit(token).rest.pulls.get({ owner, repo, pull_number: number });
	return {
		number: p.number,
		title: p.title,
		author: p.user?.login ?? null,
		headRef: p.head.ref,
		headSha: p.head.sha,
		draft: Boolean(p.draft),
		updatedAt: p.updated_at,
		url: p.html_url
	};
}

export async function fetchGithubUser(token: string) {
	const { data } = await octokit(token).rest.users.getAuthenticated();
	return { githubId: data.id, login: data.login, name: data.name ?? null, avatarUrl: data.avatar_url ?? null };
}

export async function fetchUserOrgs(token: string): Promise<string[]> {
	const orgs = await octokit(token).paginate(octokit(token).rest.orgs.listForAuthenticatedUser, { per_page: 100 });
	return orgs.map((o) => o.login.toLowerCase());
}

/** Human-readable message for GitHub API errors (expired token, missing access). */
export function githubErrorMessage(e: unknown): string {
	const status = (e as { status?: number }).status;
	if (status === 401) return 'Dein GitHub-Zugang ist abgelaufen. Melde dich ab und wieder an.';
	if (status === 403) return 'GitHub verweigert den Zugriff (fehlende Rechte oder Rate-Limit).';
	if (status === 404) return 'GitHub kennt dieses Repository nicht oder du hast keinen Zugriff.';
	return `GitHub-Fehler: ${(e as Error).message}`;
}
