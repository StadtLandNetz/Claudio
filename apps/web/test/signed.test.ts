import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
	process.env.CLAUDIO_SECRET_KEY ??= 'test-secret-key-for-signed-links';
});

describe('signed evidence links', () => {
	it('open exactly the signed screenshot', async () => {
		const { publicEvidenceUrl, verifyEvidenceSignature } = await import('../src/lib/server/signed.js');
		const url = publicEvidenceUrl('https://claudio.test', 'review-1', 'evidence/E1-Formular.png')!;
		expect(url).toMatch(/^https:\/\/claudio\.test\/public\/runs\/review-1\/evidence\/E1-Formular\.png\?sig=[\w-]{32}$/);
		const sig = new URL(url).searchParams.get('sig');
		expect(verifyEvidenceSignature('review-1', 'evidence/E1-Formular.png', sig)).toBe(true);
		expect(verifyEvidenceSignature('review-1', 'evidence/E2-Andere.png', sig)).toBe(false);
		expect(verifyEvidenceSignature('review-2', 'evidence/E1-Formular.png', sig)).toBe(false);
		expect(verifyEvidenceSignature('review-1', 'evidence/E1-Formular.png', null)).toBe(false);
	});
	it('never sign anything but evidence images', async () => {
		const { publicEvidenceUrl } = await import('../src/lib/server/signed.js');
		expect(publicEvidenceUrl('https://c.test', 'r', 'report.json')).toBeNull();
		expect(publicEvidenceUrl('https://c.test', 'r', 'trace.zip')).toBeNull();
		expect(publicEvidenceUrl('https://c.test', 'r', 'evidence/../report.json')).toBeNull();
	});
});
