import { error, fail } from '@sveltejs/kit';
import {
	REVIEW_SUPERSEDED,
	StrictnessSchema,
	blockingFindings,
	renderPrComment,
	sortBySeverity,
	verdict,
	withTests,
	type FindingNote,
	type ReviewTestResult
} from '@claudio/core';
import {
	addLesson,
	countEvents,
	getReview,
	listFindings,
	listTestRuns,
	openHumanRequest,
	rateFinding,
	removeLesson,
	setFindingIssue,
	setFindingNote,
	requestAbort,
	setReviewCommentUrl,
	FINDING_STATUSES
} from '@claudio/db';
import type { AccessLevel } from '@claudio/db';
import { postPullRequestReview } from '@claudio/github';
import { githubAs } from '#lib/server/runs.js';
import { publicEvidenceUrl } from '#lib/server/signed.js';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { publicBaseUrl } from '#lib/server/env.js';
import { fileAvailability, runFileUrl, withAvailability } from '#lib/server/run-files.js';
import { TRACE_INDEX_PATH, viewerAvailable } from '#lib/server/trace.js';
import { renderMarkdown } from '#lib/markdown.js';
import { serverI18n } from '#lib/i18n/index.js';
import type { Actions, PageServerLoad } from './$types';

async function loadReview(idParam: string, locals: App.Locals, min: AccessLevel = 'read') {
	const { user } = locals;
	const id = Number(idParam);
	const review = Number.isInteger(id) ? await getReview(db(), id) : undefined;
	if (!review) error(404, serverI18n(locals.locale).t('review.reviewNotFound'));
	// Visible only with access to its repository on GitHub.
	const { level } = await requireRepo(user, review.repoId, min);
	return Object.assign(review, { level });
}

const dismissedOf = (rows: Awaited<ReturnType<typeof listFindings>>) =>
	rows.filter((r) => r.finding.status === 'dismissed').map((r) => r.finding.findingId);
// Ratings with their reasons, and the comments for the developers (which need no rating).
const notesOf = (rows: Awaited<ReturnType<typeof listFindings>>): FindingNote[] =>
	rows.flatMap((r) =>
		r.finding.status === 'proposed' && !r.finding.note
			? []
			: [{ findingId: r.finding.findingId, status: r.finding.status, comment: r.finding.comment, by: r.ratedByLogin, note: r.finding.note, noteBy: r.noteByLogin }]
	);

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const review = await loadReview(params.id, locals, 'read');
	const [rows, eventCount, testRuns] = await Promise.all([
		listFindings(db(), review.id),
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
				issueUrl: r.finding.issueUrl ?? null,
				note: r.finding.note ?? '',
				noteBy: r.noteByLogin,
				noteAt: r.finding.noteAt
			}
		])
	);
	const dismissed = dismissedOf(rows);
	const notes = notesOf(rows);
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

	return {
		review: {
			id: review.id,
			runId: review.runId,
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
						rating: ratings.get(f.id) ?? { status: 'proposed' as const, comment: '', by: null, at: null, issueUrl: null, note: '', noteBy: null, noteAt: null }
					})),
					evidence: Object.fromEntries(evidence.map((e) => [e.id, e])),
					notes: report.notes,
					followUp: report.followUp ?? null,
					cost: report.cost,
					errors: report.errors,
					files: { trace: traceUrl, timeline }
				}
			: null,
		eventCount,
		human: await openHumanRequest(db(), 'review', review.id).then((h) => (h ? { id: h.id, reason: h.reason, kind: h.kind, context: h.context, options: h.options ?? [] } : null)),
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
		// The reason belongs to the rating: taking the rating back drops it.
		const comment = status === 'proposed' ? null : String(f.get('comment') ?? '').trim().slice(0, 2000) || null;
		await rateFinding(db(), review.id, findingId, { status: status as (typeof FINDING_STATUSES)[number], comment, userId: locals.user!.id });
		// A dismissal with a reason teaches later reviews of this repo; undoing it forgets the lesson.
		if (status === 'dismissed' && comment) {
			await addLesson(db(), review.repoId, { text: `${finding.title}: ${comment}`, reviewId: review.id, findingId, by: locals.user!.login, at: new Date().toISOString() });
		} else {
			await removeLesson(db(), review.repoId, { reviewId: review.id, findingId });
		}
		return { rated: findingId };
	},
	/** The comment for the developers: independent of the rating, it goes into the PR comment and the issue. */
	note: async ({ params, request, locals }) => {
		const review = await loadReview(params.id, locals, 'write');
		const { t } = serverI18n(locals.locale);
		const f = await request.formData();
		const findingId = String(f.get('findingId') ?? '');
		if (!review.report?.findings.some((x) => x.id === findingId)) return fail(400, { error: t('review.unknownFinding'), form: `note:${findingId}` });
		const note = f.get('clearNote') ? null : String(f.get('note') ?? '').trim().slice(0, 4000) || null;
		await setFindingNote(db(), review.id, findingId, { note, userId: locals.user!.id });
		return { noted: findingId };
	},
	comment: async ({ params, request, locals, url }) => {
		const review = await loadReview(params.id, locals, 'write');
		const { t } = serverI18n(locals.locale);
		if (!review.report) return fail(400, { error: t('review.noReport'), form: 'comment' });
		if (review.fixture) return fail(400, { error: t('review.demoNoComment'), form: 'comment' });
		const github = await githubAs(review.repoFullName, locals.user);
		if (!github) return fail(400, { error: t('review.commentNeedsGithub'), form: 'comment' });
		const f = await request.formData();
		const requested = StrictnessSchema.safeParse(f.get('strictness'));
		const strictness = requested.success ? requested.data : review.report.request.strictness;
		const rows = await listFindings(db(), review.id);
		const dismissed = dismissedOf(rows);
		const notes = f.get('includeNotes') ? notesOf(rows) : [];
		const tests = (await listTestRuns(db(), { reviewId: review.id }, 100)).map((t) => ({ name: t.scriptName, outcome: t.outcome }));
		const body = renderPrComment(review.report, `${publicBaseUrl(url)}/reviews/${review.id}`, { strictness, dismissedIds: dismissed, tests, notes });
		try {
			// Blocking findings become a "changes requested" review, like after automated runs.
			const requestChanges = withTests(verdict(review.report, strictness, dismissed), tests) === 'request_changes';
			const lang = review.report.request.language;
			const posted = await postPullRequestReview(github.client, review.repoFullName, review.prNumber, body, requestChanges, REVIEW_SUPERSEDED[lang]);
			await setReviewCommentUrl(db(), review.id, posted.url);
			return { commented: posted.url };
		} catch (e) {
			return fail(400, { error: t('review.commentRejected', { message: (e as Error).message }), form: 'comment' });
		}
	},
	/** A confirmed finding becomes a GitHub issue: steps, expected and observed behaviour, screenshots, link back. */
	issue: async ({ params, request, locals, url }) => {
		const review = await loadReview(params.id, locals, 'write');
		const { t } = serverI18n(locals.locale);
		const findingId = String((await request.formData()).get('findingId') ?? '');
		const report = review.report;
		const finding = report?.findings.find((f) => f.id === findingId);
		if (!report || !finding) return fail(400, { error: t('review.unknownFinding'), form: `issue:${findingId}` });
		const row = (await listFindings(db(), review.id)).find((r) => r.finding.findingId === findingId)?.finding;
		if (row?.status !== 'confirmed') return fail(400, { error: t('review.issueNeedsConfirmed'), form: `issue:${findingId}` });
		if (row.issueUrl) return { issued: findingId, issueUrl: row.issueUrl };
		if (review.fixture) return fail(400, { error: t('review.demoNoIssue'), form: `issue:${findingId}` });
		const github = await githubAs(review.repoFullName, locals.user);
		if (!github) return fail(400, { error: t('review.commentNeedsGithub'), form: `issue:${findingId}` });

		const base = publicBaseUrl(url);
		const { t: lt, labels } = serverI18n(report.request.language);
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
			row.note?.trim() ? `\n### ${lt('review.devNote')}\n\n${row.note.trim()}` : '',
			row.comment?.trim() ? `\n> **${lt('review.reason')}:** ${row.comment.trim().split('\n').join('\n> ')}` : '',
			`\n---\n${lt('review.issueFooter', { severity: labels.severity[finding.severity], pr: review.prNumber, url: `${base}/reviews/${review.id}#finding-${finding.id}` })}`
		]
			.filter(Boolean)
			.join('\n');
		try {
			const [owner, repo] = review.repoFullName.split('/') as [string, string];
			const { data } = await github.client.rest.issues.create({ owner, repo, title: finding.title, body });
			await setFindingIssue(db(), review.id, findingId, data.html_url);
			return { issued: findingId, issueUrl: data.html_url };
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
