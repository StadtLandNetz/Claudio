import { error, fail } from '@sveltejs/kit';
import { REVIEW_SUPERSEDED, StrictnessSchema, blockingFindings, renderPrComment, sortBySeverity, verdict, withTests, type FindingNote, type ReviewTestResult, type Strictness, type Verdict, repoPath } from '@claudio/core';
import {
	addFindingActivity,
	addLesson,
	countEvents,
	deleteFindingComment,
	findingStatuses,
	getReview,
	listPrHistory,
	listFindingActivity,
	listFindings,
	listTestRuns,
	openHumanRequest,
	rateFinding,
	removeLesson,
	setFindingIssue,
	requestAbort,
	setReviewCommentUrl,
	FINDING_ACTIVITY_KINDS,
	type FindingActivityItem,
	type FindingActivityKind
} from '@claudio/db';
import type { AccessLevel } from '@claudio/db';
import { forgeAs } from '#lib/server/forge.js';
import { publicEvidenceUrl } from '#lib/server/signed.js';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { publicBaseUrl } from '#lib/server/env.js';
import { fileAvailability, runFileUrl, withAvailability } from '#lib/server/run-files.js';
import { TRACE_INDEX_PATH, viewerAvailable } from '#lib/server/trace.js';
import { renderMarkdown } from '#lib/markdown.js';
import type { HistReview } from '#lib/finding-history.js';
import { serverI18n } from '#lib/i18n/index.js';
import type { Actions, PageServerLoad } from './$types';

async function loadReview(idParam: string, locals: App.Locals, min: AccessLevel = 'read') {
	const { user } = locals;
	const id = Number(idParam);
	const review = Number.isInteger(id) ? await getReview(db(), id) : undefined;
	if (!review) error(404, serverI18n(locals.locale, locals.user?.provider).t('review.reviewNotFound'));
	// Visible only with access to its repository on GitHub or GitLab.
	const { repo, level } = await requireRepo(user, review.repoId, min);
	return Object.assign(review, { level, repo });
}

const dismissedOf = (rows: Awaited<ReturnType<typeof listFindings>>) =>
	rows.filter((r) => r.finding.status === 'dismissed').map((r) => r.finding.findingId);
const commentsOf = (activity: FindingActivityItem[], findingId: string) =>
	activity.filter((a) => a.findingId === findingId && a.kind === 'comment' && a.body).map((a) => ({ by: a.login, body: a.body! }));
// The current ratings with their reasons, and the comments of each thread (which need no rating).
const notesOf = (rows: Awaited<ReturnType<typeof listFindings>>, activity: FindingActivityItem[]): FindingNote[] =>
	rows.flatMap((r) => {
		const comments = commentsOf(activity, r.finding.findingId);
		return r.finding.status === 'proposed' && !comments.length
			? []
			: [{ findingId: r.finding.findingId, status: r.finding.status, comment: r.finding.comment, by: r.ratedByLogin, comments }];
	});

/**
 * Every review of the pull request with its findings, for the comparison in the
 * findings section; all judged with the same strictness. Empty with only one review.
 */
async function prHistory(review: { id: number; repoId: number; prNumber: number }, strictness: Strictness, currentVerdict: Verdict | null): Promise<HistReview[]> {
	const items = await listPrHistory(db(), review.repoId, review.prNumber);
	if (items.length < 2) return [];
	const statuses = await findingStatuses(db(), items.map((x) => x.id));
	return items.map((it) => {
		const st = statuses.get(it.id) ?? new Map();
		const dismissed = it.report.findings.filter((f) => st.get(f.id) === 'dismissed').map((f) => f.id);
		const blocking = new Set(blockingFindings(it.report, strictness, dismissed).map((f) => f.id));
		return {
			id: it.id,
			at: new Date(it.createdAt).toISOString(),
			verdict: it.id === review.id && currentVerdict ? currentVerdict : verdict(it.report, strictness, dismissed),
			followUpOf: it.report.followUp?.reviewId ?? null,
			fixed: (it.report.followUp?.rechecks ?? []).filter((r) => r.status === 'fixed').map((r) => r.findingId),
			findings: sortBySeverity(it.report.findings).map((f) => ({ ...f, rating: st.get(f.id) ?? 'proposed', blocking: blocking.has(f.id) }))
		};
	});
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const review = await loadReview(params.id, locals, 'read');
	const [rows, activity, eventCount, testRuns] = await Promise.all([
		listFindings(db(), review.id),
		listFindingActivity(db(), review.id),
		countEvents(db(), { reviewId: review.id }),
		listTestRuns(db(), { reviewId: review.id }, 100)
	]);
	const tests: ReviewTestResult[] = testRuns.map((t) => ({ name: t.scriptName, outcome: t.outcome }));
	const report = review.report;

	const ratings = new Map(
		rows.map((r) => [
			r.finding.findingId,
			{
				status: r.finding.status,
				comment: r.finding.comment ?? '',
				by: r.ratedByLogin,
				at: r.finding.ratedAt,
				issueUrl: r.finding.issueUrl ?? null
			}
		])
	);
	const dismissed = dismissedOf(rows);
	const notes = notesOf(rows, activity);
	const threadOf = (findingId: string) =>
		activity
			.filter((a) => a.findingId === findingId)
			.map((a) => ({ id: a.id, kind: a.kind, body: a.body ?? '', by: a.login, avatarUrl: a.avatarUrl, at: a.createdAt, mine: a.userId === locals.user?.id }));
	const requested = StrictnessSchema.safeParse(url.searchParams.get('strictness'));
	const strictness = requested.success ? requested.data : (report?.request.strictness ?? review.request.strictness);
	const blocking = report ? new Set(blockingFindings(report, strictness, dismissed).map((f) => f.id)) : new Set<string>();

	const available = await fileAvailability(review.runId);
	const evidence = report ? await withAvailability(review.runId, report.evidence) : [];
	// The whole trace stays only in the (ephemeral) run directory: offered for download while it is there.
	// The timeline also works from the worker's copy in the database, kept like the screenshots.
	const traceUrl = review.runId && available('trace.zip') ? runFileUrl(review.runId, 'trace.zip') : null;
	const timeline = Boolean(review.runId && (traceUrl || available(TRACE_INDEX_PATH)));
	const currentVerdict = report ? withTests(verdict(report, strictness, dismissed), tests) : null;
	const history = report ? await prHistory(review, strictness, currentVerdict) : [];

	return {
		review: {
			id: review.id,
			runId: review.runId,
			repo: review.repoFullName,
			repoPath: repoPath(review.repo),
			prNumber: review.prNumber,
			prTitle: review.prTitle,
			status: review.status,
			instanceUrl: review.instanceUrl,
			request: review.request,
			startedBy: review.startedByLogin,
			createdAt: review.createdAt,
			startedAt: review.startedAt,
			finishedAt: review.finishedAt,
			error: review.error,
			abortRequested: review.abortRequested,
			fixture: review.fixture,
			commentUrl: review.commentUrl,
			trigger: review.trigger
		},
		commentPreview: report
			? renderMarkdown(renderPrComment(report, `${publicBaseUrl(url)}/reviews/${review.id}`, { strictness, dismissedIds: dismissed, tests }))
			: null,
		commentPreviewWithNotes:
			report && notes.length
				? renderMarkdown(renderPrComment(report, `${publicBaseUrl(url)}/reviews/${review.id}`, { strictness, dismissedIds: dismissed, tests, notes }))
				: null,
		noteCount: notes.length,
		strictness,
		viewerAvailable: viewerAvailable(),
		canWrite: review.level === 'write' || review.level === 'admin',
		report: report
			? {
					pr: report.pr,
					issues: report.issues,
					summaryHtml: report.summary ? renderMarkdown(report.summary) : '',
					verdict: currentVerdict!,
					acceptanceCriteria: report.acceptanceCriteria,
					findings: sortBySeverity(report.findings).map((f) => ({
						...f,
						blocking: blocking.has(f.id),
						rating: ratings.get(f.id) ?? { status: 'proposed' as const, comment: '', by: null, at: null, issueUrl: null },
						activity: threadOf(f.id)
					})),
					evidence: Object.fromEntries(evidence.map((e) => [e.id, e])),
					notes: report.notes,
					followUp: report.followUp ?? null,
					cost: report.cost,
					errors: report.errors,
					files: { trace: traceUrl, timeline }
				}
			: null,
		history,
		eventCount,
		human: await openHumanRequest(db(), 'review', review.id).then((h) => (h ? { id: h.id, reason: h.reason, kind: h.kind, context: h.context, options: h.options ?? [] } : null)),
		tests: testRuns
			.map((t) => ({ id: t.id, scriptId: t.scriptId, name: t.scriptName, status: t.status, outcome: t.outcome, healed: t.healed, mode: t.mode, summary: t.report?.summary ?? '' }))
			.reverse()
	};
};

export const actions: Actions = {
	/**
	 * One entry in a finding's thread: a comment, or a rating whose text is its reason.
	 * Confirming and dismissing set the current rating; reset takes it back.
	 */
	activity: async ({ params, request, locals }) => {
		const review = await loadReview(params.id, locals, 'write');
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const f = await request.formData();
		const findingId = String(f.get('findingId') ?? '');
		const form = `activity:${findingId}`;
		const kind = String(f.get('kind') ?? '') as FindingActivityKind;
		if (!FINDING_ACTIVITY_KINDS.includes(kind)) return fail(400, { error: t('review.unknownRating'), form });
		const finding = review.report?.findings.find((x) => x.id === findingId);
		if (!finding) return fail(400, { error: t('review.unknownFinding'), form });
		const body = kind === 'reset' ? null : String(f.get('body') ?? '').trim().slice(0, 4000) || null;
		if (kind === 'comment' && !body) return fail(400, { error: t('review.commentEmpty'), form });
		const userId = locals.user!.id;
		await addFindingActivity(db(), { reviewId: review.id, findingId, userId, kind, body });
		if (kind !== 'comment') {
			const status = kind === 'reset' ? 'proposed' : kind;
			await rateFinding(db(), review.id, findingId, { status, comment: body, userId });
			// A dismissal with a reason teaches later reviews of this repo; any other rating forgets the lesson.
			if (kind === 'dismissed' && body) {
				await addLesson(db(), review.repoId, { text: `${finding.title}: ${body}`, reviewId: review.id, findingId, by: locals.user!.login, at: new Date().toISOString() });
			} else {
				await removeLesson(db(), review.repoId, { reviewId: review.id, findingId });
			}
		}
		return { posted: findingId };
	},
	/** Removes one of your own comments; ratings stay in the thread as a record. */
	deleteComment: async ({ params, request, locals }) => {
		const review = await loadReview(params.id, locals, 'write');
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id) || !(await deleteFindingComment(db(), review.id, id, locals.user!.id))) {
			return fail(400, { error: serverI18n(locals.locale, locals.user?.provider).t('review.commentNotYours'), form: 'deleteComment' });
		}
		return { deleted: id };
	},
	comment: async ({ params, request, locals, url }) => {
		const review = await loadReview(params.id, locals, 'write');
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		if (!review.report) return fail(400, { error: t('review.noReport'), form: 'comment' });
		if (review.fixture) return fail(400, { error: t('review.demoNoComment'), form: 'comment' });
		const writer = await forgeAs(review.repo, locals.user);
		if (!writer) return fail(400, { error: t('review.commentNeedsGithub'), form: 'comment' });
		const f = await request.formData();
		const requested = StrictnessSchema.safeParse(f.get('strictness'));
		const strictness = requested.success ? requested.data : review.report.request.strictness;
		const [rows, activity] = await Promise.all([listFindings(db(), review.id), listFindingActivity(db(), review.id)]);
		const dismissed = dismissedOf(rows);
		const notes = f.get('includeNotes') ? notesOf(rows, activity) : [];
		const tests = (await listTestRuns(db(), { reviewId: review.id }, 100)).map((t) => ({ name: t.scriptName, outcome: t.outcome }));
		const body = renderPrComment(review.report, `${publicBaseUrl(url)}/reviews/${review.id}`, { strictness, dismissedIds: dismissed, tests, notes });
		try {
			// Blocking findings become a "changes requested" review, like after automated runs.
			const requestChanges = withTests(verdict(review.report, strictness, dismissed), tests) === 'request_changes';
			const lang = review.report.request.language;
			const posted = await writer.forge.postReview(review.repo, review.prNumber, body, requestChanges, REVIEW_SUPERSEDED[lang]);
			await setReviewCommentUrl(db(), review.id, posted.url);
			return { commented: posted.url };
		} catch (e) {
			return fail(400, { error: t('review.commentRejected', { message: (e as Error).message }), form: 'comment' });
		}
	},
	/** A confirmed finding becomes a GitHub or GitLab issue: steps, expected and observed behaviour, screenshots, link back. */
	issue: async ({ params, request, locals, url }) => {
		const review = await loadReview(params.id, locals, 'write');
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const findingId = String((await request.formData()).get('findingId') ?? '');
		const report = review.report;
		const finding = report?.findings.find((f) => f.id === findingId);
		if (!report || !finding) return fail(400, { error: t('review.unknownFinding'), form: `issue:${findingId}` });
		const row = (await listFindings(db(), review.id)).find((r) => r.finding.findingId === findingId)?.finding;
		if (row?.status !== 'confirmed') return fail(400, { error: t('review.issueNeedsConfirmed'), form: `issue:${findingId}` });
		if (row.issueUrl) return { issued: findingId, issueUrl: row.issueUrl };
		if (review.fixture) return fail(400, { error: t('review.demoNoIssue'), form: `issue:${findingId}` });
		const writer = await forgeAs(review.repo, locals.user);
		if (!writer) return fail(400, { error: t('review.commentNeedsGithub'), form: `issue:${findingId}` });

		const base = publicBaseUrl(url);
		const comments = commentsOf(await listFindingActivity(db(), review.id), findingId);
		const { t: lt, labels } = serverI18n(report.request.language, review.repo.provider);
		const shots = finding.evidenceIds
			.map((id) => report.evidence.find((e) => e.id === id))
			.flatMap((e) => (e?.path && e.kind === 'screenshot' ? [{ e, src: review.runId ? publicEvidenceUrl(base, review.runId, e.path) : null }] : []));
		const body = [
			finding.description.trim(),
			finding.steps.length ? `\n### ${lt('review.issueSteps')}\n\n${finding.steps.map((s, k) => `${k + 1}. ${s}`).join('\n')}` : '',
			finding.expected ? `\n**${lt('review.expected')}:** ${finding.expected}` : '',
			finding.actual ? `\n**${lt('review.observed')}:** ${finding.actual}` : '',
			finding.url ? `\n**URL:** ${finding.url}` : '',
			shots.length ? `\n### ${lt('review.issueScreenshots')}\n\n${shots.map(({ e, src }) => (src ? `![${e.label}](${src})` : `- ${e.label}`)).join('\n\n')}` : '',
			row.comment?.trim() ? `\n> **${lt('review.reason')}:** ${row.comment.trim().split('\n').join('\n> ')}` : '',
			comments.length ? `\n### ${lt('review.issueComments')}\n\n${comments.map((c) => `**@${c.by}:** ${c.body.trim()}`).join('\n\n')}` : '',
			`\n---\n${lt('review.issueFooter', { severity: labels.severity[finding.severity], pr: review.prNumber, url: `${base}/reviews/${review.id}#finding-${finding.id}` })}`
		]
			.filter(Boolean)
			.join('\n');
		try {
			const issue = await writer.forge.createIssue(review.repo, { title: finding.title, body });
			await setFindingIssue(db(), review.id, findingId, issue.url);
			return { issued: findingId, issueUrl: issue.url };
		} catch (e) {
			return fail(400, { error: t('review.issueRejected', { message: (e as Error).message }), form: `issue:${findingId}` });
		}
	},
	abort: async ({ params, locals }) => {
		const review = await loadReview(params.id, locals, 'write');
		await requestAbort(db(), review.id);
		return { aborted: true };
	}
};
