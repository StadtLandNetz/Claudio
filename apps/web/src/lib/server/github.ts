import { Octokit } from 'octokit';
import { requestI18n } from './i18n.js';

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
	createdAt?: string;
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
		headSha: p.head.sha,
		draft: Boolean(p.draft),
		updatedAt: p.updated_at,
		createdAt: p.created_at,
		url: p.html_url
	}));
}

export type GithubBranch = { name: string; sha: string; committedAt: string | null; author: string | null; openPulls: number };

/** The most recently committed branches (one GraphQL call), with whether an open pull request belongs to each. */
export async function listRecentBranches(token: string, fullName: string, first = 50): Promise<{ defaultBranch: string | null; branches: GithubBranch[] }> {
	const [owner, name] = fullName.split('/') as [string, string];
	type Node = {
		name: string;
		associatedPullRequests: { totalCount: number };
		target: { oid?: string; committedDate?: string; author?: { name: string | null; user: { login: string } | null } | null } | null;
	};
	const data = await octokit(token).graphql<{ repository: { defaultBranchRef: { name: string } | null; refs: { nodes: Node[] } } }>(
		`query($owner: String!, $name: String!, $first: Int!) {
			repository(owner: $owner, name: $name) {
				defaultBranchRef { name }
				refs(refPrefix: "refs/heads/", first: $first, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
					nodes {
						name
						associatedPullRequests(states: OPEN) { totalCount }
						target { ... on Commit { oid committedDate author { name user { login } } } }
					}
				}
			}
		}`,
		{ owner, name, first }
	);
	return {
		defaultBranch: data.repository.defaultBranchRef?.name ?? null,
		branches: data.repository.refs.nodes.map((n) => ({
			name: n.name,
			sha: n.target?.oid ?? '',
			committedAt: n.target?.committedDate ?? null,
			author: n.target?.author?.user?.login ?? n.target?.author?.name ?? null,
			openPulls: n.associatedPullRequests.totalCount
		}))
	};
}

export type ContributorWeeks = { login: string; avatarUrl: string | null; weeks: { w: number; c: number; a: number; d: number }[] };

/** Thrown while GitHub is still computing the statistics (HTTP 202); asking again a little later gets them. */
export class StatsPending extends Error {
	constructor() {
		super('GitHub is computing the statistics');
		this.name = 'StatsPending';
	}
}

/** Commits, additions and deletions per contributor and week (unix seconds of the week's Sunday), from GitHub's statistics. */
export async function contributorWeeks(token: string, fullName: string): Promise<ContributorWeeks[]> {
	const [owner, repo] = fullName.split('/') as [string, string];
	const res = await octokit(token).rest.repos.getContributorsStats({ owner, repo });
	if ((res.status as number) === 202 || !Array.isArray(res.data)) throw new StatsPending();
	return res.data.map((c) => ({
		login: c.author?.login ?? '?',
		avatarUrl: c.author?.avatar_url ?? null,
		weeks: (c.weeks ?? []).map((w) => ({ w: w.w ?? 0, c: w.c ?? 0, a: w.a ?? 0, d: w.d ?? 0 }))
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
	const { t } = requestI18n();
	const status = (e as { status?: number }).status;
	if (status === 401) return t('system.githubExpired');
	if (status === 403) return t('system.githubForbidden');
	if (status === 404) return t('system.githubNotFound');
	return t('system.githubError', { message: (e as Error).message });
}
