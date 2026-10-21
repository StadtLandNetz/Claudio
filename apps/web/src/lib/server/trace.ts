import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { TraceAction, TraceConsole, TraceFrame, TraceIndex, TraceNavigation, TraceToolCall, ToolKind } from '#lib/trace-types.js';
import { runsRoot } from './env.js';
import { resolveRunFile } from './files.js';
import { readZipDirectory, readZipEntry, streamZipEntry, type ZipDirectory } from './zip.js';

export type { TraceIndex } from '#lib/trace-types.js';

/** Browser calls worth showing. Everything else (live-view screenshots, text polling, routing) is noise. */
const ACTIONS = new Set([
	'goto',
	'reload',
	'goBack',
	'goForward',
	'click',
	'dblclick',
	'fill',
	'type',
	'press',
	'selectOption',
	'check',
	'uncheck',
	'hover',
	'tap',
	'focus',
	'setInputFiles',
	'dragAndDrop',
	'waitForSelector',
	'waitForNavigation',
	'newPage',
	'close',
	'evaluateExpression'
]);

const short = (s: string, n: number): string => {
	const t = s.replace(/\s+/g, ' ').trim();
	return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** A JSON string's raw contents (between the quotes) decoded, as far as possible. */
function unquote(raw: string): string {
	try {
		return JSON.parse(`"${raw}"`) as string;
	} catch {
		return raw;
	}
}

/** The last match in `tail`, else the first in `head`: keys after the DOM sit at the end of a snapshot line. */
function pick(head: string, tail: string, re: RegExp): string | undefined {
	let last: RegExpExecArray | null = null;
	const g = new RegExp(re.source, 'g');
	for (let m = g.exec(tail); m; m = g.exec(tail)) last = m;
	return last?.[1] ?? head.match(re)?.[1];
}

/**
 * Builds the index from the lines of a `trace.trace` file (Playwright trace format,
 * one JSON event per line). Snapshot lines carry the whole DOM and are never parsed;
 * a few regular expressions pull the frame URL and time out of their ends.
 */
export async function parseTrace(lines: AsyncIterable<string> | Iterable<string>): Promise<Omit<TraceIndex, 'toolCalls'>> {
	let t0 = 0;
	let startWall = 0;
	let first = true;
	const frames: TraceFrame[] = [];
	const actions: TraceAction[] = [];
	const navigations: TraceNavigation[] = [];
	const console: TraceConsole[] = [];
	const pending = new Map<string, TraceAction>();
	const lastUrl = new Map<string, string>();

	for await (const line of lines) {
		if (!line) continue;
		if (first) {
			first = false;
			let opts: { type?: string; wallTime?: number; monotonicTime?: number };
			try {
				opts = JSON.parse(line);
			} catch {
				throw new Error('unreadable trace');
			}
			if (opts.type !== 'context-options' || typeof opts.wallTime !== 'number' || typeof opts.monotonicTime !== 'number') throw new Error('unsupported trace format');
			t0 = opts.monotonicTime;
			startWall = opts.wallTime;
			continue;
		}
		if (line.startsWith('{"type":"frame-snapshot"')) {
			const head = line.slice(0, 1500);
			const tail = line.slice(-2000);
			if (pick(head, tail, /"isMainFrame":(true|false)/) !== 'true') continue;
			const url = pick(head, tail, /"frameUrl":"((?:[^"\\]|\\.)*)"/);
			const ts = pick(head, tail, /"timestamp":(\d+(?:\.\d+)?)/);
			const page = pick(head, tail, /"pageId":"([^"]+)"/) ?? '';
			if (url === undefined || ts === undefined) continue;
			const u = unquote(url);
			if (!u || u === 'about:blank' || lastUrl.get(page) === u) continue;
			lastUrl.set(page, u);
			navigations.push({ t: Number(ts) - t0, url: u });
			continue;
		}
		if (line.startsWith('{"type":"before"')) {
			const m = line.slice(0, 400).match(/"method":"(\w+)"/);
			if (!m || !ACTIONS.has(m[1]!)) continue;
			let ev: { callId?: string; startTime?: number; method?: string; title?: string; params?: Record<string, unknown> };
			try {
				ev = JSON.parse(line);
			} catch {
				continue;
			}
			if (typeof ev.callId !== 'string' || typeof ev.startTime !== 'number' || typeof ev.method !== 'string') continue;
			const t = ev.startTime - t0;
			const a: TraceAction = { t, end: t, method: ev.method, title: ev.title ?? ev.method };
			const p = ev.params ?? {};
			const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
			if (ev.method === 'goto') {
				a.detail = str('url');
				if (a.detail && a.detail !== 'about:blank') navigations.push({ t, url: a.detail });
			} else if (ev.method === 'fill' || ev.method === 'type') {
				const value = str('value') ?? str('text');
				a.detail = `${str('selector') ?? ''}${value !== undefined ? ` = ${short(value, 80)}` : ''}`.trim();
			} else if (ev.method === 'press') {
				a.detail = str('key');
			} else if (ev.method === 'evaluateExpression') {
				a.detail = short(str('expression') ?? '', 80);
			} else if (str('selector')) {
				a.detail = str('selector');
			}
			pending.set(ev.callId, a);
			continue;
		}
		if (line.startsWith('{"type":"after"')) {
			const m = line.slice(0, 120).match(/"callId":"([^"]+)"/);
			const a = m && pending.get(m[1]!);
			if (!a) continue;
			pending.delete(m[1]!);
			let ev: { endTime?: number; error?: { error?: { message?: unknown }; message?: unknown } };
			try {
				ev = JSON.parse(line);
			} catch {
				actions.push(a);
				continue;
			}
			a.end = typeof ev.endTime === 'number' ? ev.endTime - t0 : a.t;
			const err = ev.error?.error?.message ?? ev.error?.message;
			if (typeof err === 'string') a.error = short(err, 200);
			actions.push(a);
			continue;
		}
		if (line.startsWith('{"type":"screencast-frame"')) {
			let ev: { file?: string; timestamp?: number; width?: number; height?: number; pageId?: string };
			try {
				ev = JSON.parse(line);
			} catch {
				continue;
			}
			if (typeof ev.file !== 'string' || typeof ev.timestamp !== 'number') continue;
			frames.push({ t: ev.timestamp - t0, file: ev.file.replace(/^screencast\//, ''), w: ev.width ?? 0, h: ev.height ?? 0, page: ev.pageId ?? '' });
			continue;
		}
		if (line.startsWith('{"type":"console"')) {
			if (console.length >= 500) continue;
			if (!line.includes('"messageType":"error"') && !line.includes('"messageType":"warning"')) continue;
			let ev: { messageType?: string; text?: unknown; time?: number };
			try {
				ev = JSON.parse(line);
			} catch {
				continue;
			}
			if ((ev.messageType !== 'error' && ev.messageType !== 'warning') || typeof ev.time !== 'number') continue;
			console.push({ t: ev.time - t0, level: ev.messageType, text: short(String(ev.text ?? ''), 300) });
		}
	}
	// Calls without an end (the trace stopped while they ran) still count.
	for (const a of pending.values()) actions.push(a);

	const byTime = <T extends { t: number }>(list: T[]) => list.sort((x, y) => x.t - y.t);
	byTime(frames);
	byTime(actions);
	byTime(console);
	// A goto and the snapshot that follows it name the same URL: one navigation.
	const navs: TraceNavigation[] = [];
	for (const n of byTime(navigations)) if (navs.at(-1)?.url !== n.url) navs.push(n);
	const durationMs = Math.max(0, frames.at(-1)?.t ?? 0, ...actions.map((a) => a.end), navs.at(-1)?.t ?? 0, console.at(-1)?.t ?? 0);
	return { startWall, durationMs, frames, actions, navigations: navs, console };
}

const pathOf = (url: string): string => {
	try {
		const u = new URL(url);
		return `${u.pathname}${u.search}` || url;
	} catch {
		return url;
	}
};

/** What one tool call means on the timeline; null for tools that are not about the browser or the report. */
function describeTool(name: string, input: Record<string, unknown>): { tool: ToolKind; label: string } | null {
	const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
	switch (name) {
		case 'mcp__playwright__browser_navigate':
			return { tool: 'navigate', label: short(pathOf(str('url')), 80) };
		case 'mcp__playwright__browser_navigate_back':
			return { tool: 'navigate', label: '←' };
		case 'mcp__playwright__browser_click':
			return { tool: 'click', label: short(str('element') || str('ref'), 80) };
		case 'mcp__playwright__browser_hover':
		case 'mcp__playwright__browser_select_option':
		case 'mcp__playwright__browser_drag':
		case 'mcp__playwright__browser_press_key':
			return { tool: 'click', label: short(str('element') || str('startElement') || str('key'), 80) };
		case 'mcp__playwright__browser_type':
			return { tool: 'fill', label: short(`${str('element')}: ${str('text')}`, 80) };
		case 'mcp__playwright__browser_fill_form': {
			const fields = Array.isArray(input.fields) ? (input.fields as { name?: unknown }[]) : [];
			return { tool: 'fill', label: short(fields.map((f) => (typeof f?.name === 'string' ? f.name : '')).filter(Boolean).join(', '), 80) };
		}
		case 'mcp__claudio__login_as':
			return { tool: 'login', label: str('role') };
		case 'mcp__claudio__capture_evidence':
			return { tool: 'evidence', label: short(str('label'), 80) };
		case 'mcp__claudio__report_finding':
			return { tool: 'finding', label: short(str('title'), 80) };
		case 'mcp__claudio__record_ac_result':
			return { tool: 'ac', label: short(`${str('status')}: ${str('criterion')}`, 80) };
		case 'mcp__claudio__note':
			return { tool: 'note', label: short(str('text'), 80) };
		default: {
			if (!/^mcp__(playwright|claudio)__/.test(name)) return null;
			const base = name.replace(/^mcp__\w+?__(browser_)?/, '');
			return { tool: 'other', label: name.endsWith('browser_evaluate') ? short(`${base} ${str('function')}`, 80) : base };
		}
	}
}

/**
 * The agent's tool calls from `log.jsonl` (Agent SDK messages, one per line) with
 * their time on the trace. Only assistant messages carry a timestamp.
 */
export async function parseToolCalls(lines: AsyncIterable<string> | Iterable<string>, startWall: number): Promise<TraceToolCall[]> {
	const out: TraceToolCall[] = [];
	for await (const line of lines) {
		if (!line.startsWith('{"type":"assistant"') || !line.includes('"tool_use"')) continue;
		let msg: { timestamp?: string; subagent_type?: unknown; message?: { content?: unknown } };
		try {
			msg = JSON.parse(line);
		} catch {
			continue;
		}
		const ts = Date.parse(msg.timestamp ?? '');
		if (Number.isNaN(ts)) continue;
		const content = msg.message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content as { type?: string; name?: unknown; input?: unknown }[]) {
			if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue;
			const input = block.input && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : {};
			const call = describeTool(block.name, input);
			if (!call) continue;
			out.push({ t: ts - startWall, ...call, ...(typeof msg.subagent_type === 'string' ? { agent: msg.subagent_type } : {}) });
			if (out.length >= 2000) return out;
		}
	}
	return out;
}

// ---------------------------------------------------------------- per-run access with a small cache

export type RunTrace = {
	index(): Promise<TraceIndex>;
	/** One screencast frame (JPEG) by its file name under screencast/. */
	frame(file: string): Promise<Buffer | null>;
};

type Cached = { key: string; dir: ZipDirectory; index: Promise<TraceIndex> | null };
const CACHE_MAX = 8;
/** runId → entry; insertion order doubles as least-recently-used order. */
const cache = new Map<string, Cached>();

async function buildIndex(dir: ZipDirectory, logPath: string | null): Promise<TraceIndex> {
	const traceFile = [...dir.entries.keys()].filter((n) => n.endsWith('.trace')).sort()[0];
	const stream = traceFile ? await streamZipEntry(dir, traceFile) : null;
	if (!stream) throw new Error('no trace file in the archive');
	const base = await parseTrace(createInterface({ input: stream, crlfDelay: Infinity }));
	const toolCalls =
		logPath && existsSync(logPath) ? await parseToolCalls(createInterface({ input: createReadStream(logPath), crlfDelay: Infinity }), base.startWall) : [];
	return { ...base, toolCalls };
}

/** The trace of a run, or null while there is none (still running, purged, unknown id). */
export async function openRunTrace(runId: string): Promise<RunTrace | null> {
	const path = resolveRunFile(runsRoot, runId, 'trace.zip');
	if (!path) return null;
	let st: { size: number; mtimeMs: number };
	try {
		st = await stat(path);
	} catch {
		return null;
	}
	const key = `${st.size}:${st.mtimeMs}`;
	let entry = cache.get(runId);
	if (entry?.key === key) {
		cache.delete(runId);
		cache.set(runId, entry);
	} else {
		entry = { key, dir: await readZipDirectory(path), index: null };
		cache.delete(runId);
		cache.set(runId, entry);
		while (cache.size > CACHE_MAX) {
			const oldest = cache.keys().next().value;
			if (oldest === undefined) break;
			cache.delete(oldest);
		}
	}
	const e = entry;
	const logPath = resolveRunFile(runsRoot, runId, 'log.jsonl');
	return {
		index() {
			if (!e.index) {
				e.index = buildIndex(e.dir, logPath).catch((err) => {
					e.index = null;
					throw err;
				});
			}
			return e.index;
		},
		frame: (file) => readZipEntry(e.dir, `screencast/${file}`)
	};
}

// ---------------------------------------------------------------- the official viewer

let viewerDir: string | null | undefined;

/** Playwright's own trace viewer, bundled with playwright-core; null when the package is not installed. */
export function traceViewerDir(): string | null {
	if (viewerDir !== undefined) return viewerDir;
	try {
		const require = createRequire(import.meta.url);
		const dir = resolve(dirname(require.resolve('playwright-core/package.json')), 'lib/vite/traceViewer');
		viewerDir = existsSync(resolve(dir, 'index.html')) ? dir : null;
	} catch {
		viewerDir = null;
	}
	return viewerDir;
}

export const viewerAvailable = (): boolean => traceViewerDir() !== null;
