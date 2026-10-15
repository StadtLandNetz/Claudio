import { error, fail } from '@sveltejs/kit';
import { StrictnessSchema, blockingFindings, renderPrComment, sortBySeverity, verdict, withTests, type ReviewTestResult } from '@claudio/core';
import {
	addLesson,
	eventsSince,
	getReview,
	listFindings,
	listTestRuns,
	openHumanRequest,
	rateFinding,
	removeLesson,
	requestAbort,
	setReviewCommentUrl,
	FINDING_STATUSES
} from '@claudio/db';
import type { AccessLevel } from '@claudio/db';
import { createGithubClient, postPullRequestComment } from '@claudio/github';
import { userToken } from '#lib/server/auth.js';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { publicBaseUrl } from '#lib/server/env.js';
import { fileAvailability, runFileUrl, withAvailability } from '#lib/server/run-files.js';
import { renderMarkdown } from '#lib/markdown.js';
import { serverI18n } from '#lib/i18n/index.js';
import type { Actions, PageServerLoad } from './$types';

async function loadReview(idParam: string, locals: App.Locals, min: AccessLevel = 'read') {
	const { user } = locals;
	const id = Number(idParam);
	const review = Number.isInteger(id) ? await getReview(db(), id) : undefined;
	if (!review) error(404, serverI18n(locals.locale).t('review.reviewNotFound'));
	// Visible only with access to its repository on GitHub.
	await requireRepo(user, review.repoId, min);
	return review;
}

const dismissedOf = (rows: Awaited<ReturnType<typeof listFindings>>) =>
	rows.filter((r) => r.finding.status === 'dismissed').map((r) => r.finding.findingId);

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const review = await loadReview(params.id, locals, 'read');
	const [rows, events, testRuns] = await Promise.all([
		listFindings(db(), review.id),
		eventsSince(db(), { reviewId: review.id }, 0, 5000),
		listTestRuns(db(), { reviewId: review.id }, 100)
	]);
	const tests: ReviewTestResult[] = testRuns.map((t) => ({ name: t.scriptName, outcome: t.outcome }));
	const report = review.report;

	const ratings = new Map(rows.map((r) => [r.finding.findingId, { status: r.finding.status, comment: r.finding.comment ?? '', by: r.ratedByLogin, at: r.finding.ratedAt }]));
	const dismissed = dismissedOf(rows);
	const requested = StrictnessSchema.safeParse(url.searchParams.get('strictness'));
	const strictness = requested.success ? requested.data : (report?.request.strictness ?? review.request.strictness);
	const blocking = report ? new Set(blockingFindings(report, strictness, dismissed).map((f) => f.id)) : new Set<string>();

	const available = await fileAvailability(review.runId);
	const evidence = report ? await withAvailability(review.runId, report.evidence) : [];
	// The trace stays only in the (ephemeral) run directory: offered while it is there.
	const traceUrl = review.runId && available('trace.zip') ? runFileUrl(review.runId, 'trace.zip') : null;

	return {
		review: {
			id: review.id,
			repo: review.repoFullName,
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
		strictness,
		report: report
			? {
					pr: report.pr,
					issues: report.issues,
					summaryHtml: report.summary ? renderMarkdown(report.summary) : '',
					verdict: withTests(verdict(report, strictness, dismissed), tests),
					acceptanceCriteria: report.acceptanceCriteria,
					findings: sortBySeverity(report.findings).map((f) => ({
						...f,
						blocking: blocking.has(f.id),
						rating: ratings.get(f.id) ?? { status: 'proposed' as const, comment: '', by: null, at: null }
					})),
					evidence: Object.fromEntries(evidence.map((e) => [e.id, e])),
					cost: report.cost,
					errors: report.errors,
					files: { trace: traceUrl }
				}
			: null,
		events: events.map((e) => ({ seq: e.seq, line: e.line })),
		human: await openHumanRequest(db(), 'review', review.id).then((h) => (h ? { id: h.id, reason: h.reason } : null)),
		tests: testRuns
			.map((t) => ({ id: t.id, scriptId: t.scriptId, name: t.scriptName, status: t.status, outcome: t.outcome, healed: t.healed, mode: t.mode, summary: t.report?.summary ?? '' }))
			.reverse()
	};
};

export const actions: Actions = {
	rate: async ({ params, request, locals }) => {
		const review = await loadReview(params.id, locals, 'write');
		const { t } = serverI18n(locals.locale);
		const f = await request.formData();
		const findingId = String(f.get('findingId') ?? '');
		const status = String(f.get('status') ?? '');
		if (!(FINDING_STATUSES as readonly string[]).includes(status)) return fail(400, { error: t('review.unknownRating') });
		const finding = review.report?.findings.find((x) => x.id === findingId);
		if (!finding) return fail(400, { error: t('review.unknownFinding') });
		const comment = String(f.get('comment') ?? '').trim().slice(0, 2000) || null;
		await rateFinding(db(), review.id, findingId, { status: status as (typeof FINDING_STATUSES)[number], comment, userId: locals.user!.id });
		// A dismissal with a reason teaches later reviews of this repo; undoing it forgets the lesson.
		if (status === 'dismissed' && comment) {
			await addLesson(db(), review.repoId, { text: `${finding.title}: ${comment}`, reviewId: review.id, findingId, by: locals.user!.login, at: new Date().toISOString() });
		} else {
			await removeLesson(db(), review.repoId, { reviewId: review.id, findingId });
		}
		return { rated: findingId };
	},
	comment: async ({ params, request, locals, url }) => {
		const review = await loadReview(params.id, locals, 'write');
		const { t } = serverI18n(locals.locale);
		if (!review.report) return fail(400, { error: t('review.noReport'), form: 'comment' });
		if (review.fixture) return fail(400, { error: t('review.demoNoComment'), form: 'comment' });
		const token = await userToken(locals.user!);
		if (!token) return fail(400, { error: t('review.commentNeedsGithub'), form: 'comment' });
		const requested = StrictnessSchema.safeParse((await request.formData()).get('strictness'));
		const strictness = requested.success ? requested.data : review.report.request.strictness;
		const dismissed = dismissedOf(await listFindings(db(), review.id));
		const tests = (await listTestRuns(db(), { reviewId: review.id }, 100)).map((t) => ({ name: t.scriptName, outcome: t.outcome }));
		const body = renderPrComment(review.report, `${publicBaseUrl(url)}/reviews/${review.id}`, { strictness, dismissedIds: dismissed, tests });
		try {
			const commentUrl = await postPullRequestComment(createGithubClient(token), review.repoFullName, review.prNumber, body);
			await setReviewCommentUrl(db(), review.id, commentUrl);
			return { commented: commentUrl };
		} catch (e) {
			return fail(400, { error: t('review.commentRejected', { message: (e as Error).message }), form: 'comment' });
		}
	},
	abort: async ({ params, locals }) => {
		const review = await loadReview(params.id, locals, 'write');
		await requestAbort(db(), review.id);
		return { aborted: true };
	}
};
