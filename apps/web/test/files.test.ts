import { describe, expect, it } from 'vitest';
import { contentType, resolveRunFile } from '../src/lib/server/files.js';

const root = '/srv/claudio/runs';

describe('resolveRunFile', () => {
	it('resolves files inside the run directory', () => {
		expect(resolveRunFile(root, 'review-pr17-20261010-210308-clh8', 'evidence/E1-Fahrtenliste.png')).toBe(
			'/srv/claudio/runs/review-pr17-20261010-210308-clh8/evidence/E1-Fahrtenliste.png'
		);
	});
	it.each([
		['review-1', '../review-2/report.json'],
		['review-1', 'evidence/../../review-2/x.png'],
		['review-1', '/etc/passwd'],
		['review-1', ''],
		['review-1', 'a\0b'],
		['..', 'runs/report.json'],
		['review/1', 'report.json'],
		['.', 'report.json']
	])('rejects run %s file %s', (runId, file) => {
		expect(resolveRunFile(root, runId, file)).toBeNull();
	});
});

describe('contentType', () => {
	it('maps known extensions and falls back to octet-stream', () => {
		expect(contentType('x/E1.png')).toBe('image/png');
		expect(contentType('trace.zip')).toBe('application/zip');
		expect(contentType('x.html')).toBe('application/octet-stream');
	});
});
