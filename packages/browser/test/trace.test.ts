import { describe, expect, it } from 'vitest';
import { parseToolCalls, parseTrace, thinFrames } from '../src/trace/parse.js';

const W = 1_700_000_000_000; // wall clock at context start (epoch ms)
const M = 500_000; // monotonic clock at context start
const j = (o: unknown) => JSON.stringify(o);
const head = j({ type: 'context-options', version: 10, wallTime: W, monotonicTime: M, browserName: 'chromium' });

function snapshot(url: string, timestamp: number, opts: { main?: boolean; page?: string; htmlLen?: number } = {}) {
	const html = ['HTML', {}, ['BODY', {}, 'x'.repeat(opts.htmlLen ?? 10)]];
	return j({
		type: 'frame-snapshot',
		snapshot: { callId: 'c@1', phase: 'after', pageId: opts.page ?? 'page@1', frameId: 'f@1', frameUrl: url, html, viewport: { width: 1280, height: 800 }, timestamp, wallTime: W + (timestamp - M), collectionTime: 0.1, resourceOverrides: [], isMainFrame: opts.main ?? true }
	});
}
const before = (callId: string, method: string, startTime: number, params: Record<string, unknown> = {}, title?: string) =>
	j({ type: 'before', callId, startTime, ...(title ? { title } : {}), class: 'Frame', method, params });
const after = (callId: string, endTime: number, extra: Record<string, unknown> = {}) => j({ type: 'after', callId, endTime, ...extra });

describe('parseTrace', () => {
	it('maps monotonic times onto the wall clock anchor', async () => {
		const index = await parseTrace([head, j({ type: 'screencast-frame', pageId: 'page@1', file: 'screencast/page@1-1.jpeg', width: 800, height: 600, timestamp: M + 1500 })]);
		expect(index.startWall).toBe(W);
		expect(index.frames).toEqual([{ t: 1500, file: 'page@1-1.jpeg', w: 800, h: 600, page: 'page@1' }]);
		// A report timestamp at the same moment lands on the same point of the timeline.
		expect(Date.parse(new Date(W + 1500).toISOString()) - index.startWall).toBe(1500);
		expect(index.durationMs).toBe(1500);
	});

	it('keeps real actions and drops the polling noise', async () => {
		const lines = [
			head,
			before('a', 'screenshot', M + 10, { type: 'jpeg', quality: 60 }),
			after('a', M + 20),
			before('b', 'innerText', M + 30, { selector: 'body' }),
			after('b', M + 35),
			before('c', 'setNetworkInterceptionPatterns', M + 40),
			after('c', M + 41),
			before('d', 'goto', M + 100, { url: 'http://x.test/login', waitUntil: 'domcontentloaded' }, 'Navigate to /login'),
			after('d', M + 400, { result: { response: '<Response>' } }),
			before('e', 'fill', M + 500, { selector: 'input[name=email]', value: 'a@b.c' }),
			after('e', M + 520),
			before('f', 'click', M + 600, { selector: 'button[type=submit]' }),
			after('f', M + 5600, { error: { error: { message: 'Timeout 5000ms exceeded.' } } }),
			before('g', 'press', M + 6000, { selector: 'body', key: 'Enter' })
		];
		const index = await parseTrace(lines);
		expect(index.actions.map((a) => a.method)).toEqual(['goto', 'fill', 'click', 'press']);
		expect(index.actions[0]).toEqual({ t: 100, end: 400, method: 'goto', title: 'Navigate to /login', detail: 'http://x.test/login' });
		expect(index.actions[1]!.detail).toBe('input[name=email] = a@b.c');
		expect(index.actions[2]!.error).toBe('Timeout 5000ms exceeded.');
		// never ended: the trace stopped while it ran
		expect(index.actions[3]).toMatchObject({ t: 6000, end: 6000, detail: 'Enter' });
		expect(index.navigations).toEqual([{ t: 100, url: 'http://x.test/login' }]);
		expect(index.durationMs).toBe(6000);
	});

	it('finds navigations in huge snapshot lines without parsing them', async () => {
		const lines = [
			head,
			before('d', 'goto', M + 100, { url: 'http://x.test/login' }),
			after('d', M + 300),
			snapshot('http://x.test/login', M + 320, { htmlLen: 2_000_000 }),
			snapshot('http://x.test/login', M + 900, { htmlLen: 50 }),
			snapshot('http://x.test/iframe', M + 950, { main: false }),
			snapshot('about:blank', M + 960, { page: 'page@2' }),
			snapshot('http://x.test/trips?created=1', M + 2000, { htmlLen: 2_000_000 }),
			snapshot('http://x.test/trips?created=1', M + 2500)
		];
		const index = await parseTrace(lines);
		expect(index.navigations).toEqual([
			{ t: 100, url: 'http://x.test/login' },
			{ t: 2000, url: 'http://x.test/trips?created=1' }
		]);
	});

	it('keeps console errors and warnings, truncated', async () => {
		const lines = [
			head,
			j({ type: 'console', messageType: 'log', text: 'stats', time: M + 10, pageId: 'page@1' }),
			j({ type: 'console', messageType: 'error', text: 'boom '.repeat(100), time: M + 20, pageId: 'page@1' }),
			j({ type: 'console', messageType: 'warning', text: 'careful', time: M + 30, pageId: 'page@1' })
		];
		const index = await parseTrace(lines);
		expect(index.console.map((c) => [c.t, c.level])).toEqual([
			[20, 'error'],
			[30, 'warning']
		]);
		expect(index.console[0]!.text.length).toBe(300);
		expect(index.console[0]!.text.endsWith('…')).toBe(true);
	});

	it('rejects traces without the anchor', async () => {
		await expect(parseTrace([j({ type: 'before' })])).rejects.toThrow(/unsupported/);
		await expect(parseTrace(['nope'])).rejects.toThrow(/unreadable/);
	});
});

describe('parseToolCalls', () => {
	const at = (offsetMs: number) => new Date(W + offsetMs).toISOString();
	const assistant = (timestamp: string | undefined, tools: { name: string; input: unknown }[], extra: Record<string, unknown> = {}) =>
		j({ type: 'assistant', ...(timestamp ? { timestamp } : {}), message: { role: 'assistant', content: tools.map((t) => ({ type: 'tool_use', id: 'x', ...t })) }, ...extra });

	it('turns tool calls into labelled moments', async () => {
		const lines = [
			j({ type: 'system', subtype: 'init' }),
			assistant(at(1000), [{ name: 'mcp__playwright__browser_navigate', input: { url: 'http://x.test/trips?created=16' } }], { subagent_type: 'ac-verifier' }),
			assistant(at(2000), [{ name: 'mcp__playwright__browser_click', input: { element: 'Button "Neue Fahrt"', ref: 'e12' } }]),
			assistant(at(3000), [{ name: 'mcp__playwright__browser_fill_form', input: { fields: [{ name: 'Fahrgast', value: 'x' }, { name: 'Datum', value: 'y' }] } }]),
			assistant(at(4000), [{ name: 'mcp__claudio__login_as', input: { role: 'admin' } }]),
			assistant(at(5000), [{ name: 'mcp__claudio__capture_evidence', input: { label: 'Formular', note: 'n' } }]),
			assistant(at(6000), [{ name: 'mcp__claudio__report_finding', input: { title: 'Kein Fahrzeug-Feld' } }]),
			assistant(at(7000), [{ name: 'mcp__claudio__record_ac_result', input: { status: 'failed', criterion: '2. Das Formular …' } }]),
			assistant(at(8000), [{ name: 'mcp__playwright__browser_evaluate', input: { function: '() => document.title' } }, { name: 'Read', input: { file_path: '/x' } }]),
			assistant(undefined, [{ name: 'mcp__playwright__browser_navigate', input: { url: 'http://x.test/' } }]),
			j({ type: 'user', timestamp: at(9000), message: { content: [{ type: 'tool_result', content: 'tool_use ok' }] } }),
			'{broken'
		];
		const calls = await parseToolCalls(lines, W);
		expect(calls).toEqual([
			{ t: 1000, tool: 'navigate', label: '/trips?created=16', agent: 'ac-verifier' },
			{ t: 2000, tool: 'click', label: 'Button "Neue Fahrt"' },
			{ t: 3000, tool: 'fill', label: 'Fahrgast, Datum' },
			{ t: 4000, tool: 'login', label: 'admin' },
			{ t: 5000, tool: 'evidence', label: 'Formular' },
			{ t: 6000, tool: 'finding', label: 'Kein Fahrzeug-Feld' },
			{ t: 7000, tool: 'ac', label: 'failed: 2. Das Formular …' },
			{ t: 8000, tool: 'other', label: 'evaluate () => document.title' }
		]);
	});
});

describe('thinFrames', () => {
	const frames = Array.from({ length: 1000 }, (_, k) => ({ t: k * 100, file: `f${k}.jpeg`, w: 1, h: 1, page: 'p' }));
	it('keeps every frame of a short run', () => {
		expect(thinFrames(frames.slice(0, 50), 600)).toHaveLength(50);
	});
	it('spreads the kept frames and keeps the ones before the anchors', () => {
		const kept = thinFrames(frames, 100, [12_345, 99_900]);
		expect(kept.length).toBeLessThanOrEqual(100);
		expect(kept[0]!.file).toBe('f0.jpeg');
		expect(kept.at(-1)!.file).toBe('f999.jpeg');
		// the last frame at or before each anchor survives
		expect(kept.map((f) => f.file)).toContain('f123.jpeg');
		expect(kept.map((f) => f.file)).toContain('f999.jpeg');
		// still in time order, no duplicates
		const ts = kept.map((f) => f.t);
		expect([...new Set(ts)]).toEqual([...ts].sort((a, b) => a - b));
	});
});
